require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const app = express();

// CORS — allow GitHub Pages and any browser to call the API
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '20mb' })); // increase limit for base64 images
app.use(express.static(path.join(__dirname, 'public')));

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Anthropic — created lazily so env var is read at request time
function getAnthropic() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Twilio
let twilioClient = null;
const TWILIO_READY = process.env.TWILIO_ACCOUNT_SID !== 'placeholder' &&
                     process.env.TWILIO_AUTH_TOKEN !== 'placeholder' &&
                     !!process.env.TWILIO_ACCOUNT_SID &&
                     !!process.env.TWILIO_AUTH_TOKEN;
if (TWILIO_READY) {
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  console.log('✅ Twilio initialized');
} else {
  console.log('⚠️  Twilio not configured yet');
}

// ─── HELPERS ────────────────────────────────────────────────────────────────


function generateShareToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = '';
  for (let i = 0; i < 16; i++) token += chars[Math.floor(Math.random() * chars.length)];
  return token;
}

function generateBillId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 5; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

function parseMentions(text) {
  const matches = text.match(/@[\w]+/g) || [];
  return matches.map(m => m.replace('@', '').trim());
}

function formatMoney(amount) {
  return `$${parseFloat(amount).toFixed(2)}`;
}

async function sendSMS(to, body) {
  if (!twilioClient) {
    console.log(`[SMS DISABLED] To: ${to} | Body: ${body}`);
    return;
  }
  try {
    await twilioClient.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to
    });
  } catch (err) {
    console.error(`Failed to send SMS to ${to}:`, err.message);
  }
}

async function lookupContact(ownerPhone, name) {
  const { data } = await supabase
    .from('contacts')
    .select('*')
    .eq('owner_phone', ownerPhone)
    .ilike('name', name)
    .single();
  return data;
}

async function getAllContacts(ownerPhone) {
  const { data } = await supabase
    .from('contacts')
    .select('*')
    .eq('owner_phone', ownerPhone)
    .order('name', { ascending: true });
  return data || [];
}

// ─── RECEIPT PARSING ─────────────────────────────────────────────────────────

async function parseReceiptWithClaude(imageUrl) {
  try {
    const response = await fetch(imageUrl, {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`
      }
    });
    const buffer = await response.buffer();
    const base64 = buffer.toString('base64');
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    const message = await getAnthropic().messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: contentType, data: base64 }
          },
          {
            type: 'text',
            text: `Parse this receipt and return ONLY a JSON object with this exact structure, no other text:
{
  "restaurant_name": "Restaurant or store name from the receipt",
  "items": [{"name": "Item Name", "price": 0.00}],
  "subtotal": 0.00,
  "tax": 0.00,
  "tip": 0.00,
  "total": 0.00
}
Rules:
- restaurant_name: extract the business/restaurant name from the top of the receipt. If unclear, use a short descriptive name.
- Include every ordered item with its price
- If tip is not shown, set to 0
- Return ONLY the JSON, no other text`
          }
        ]
      }]
    });
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error('Claude receipt parse error:', err);
    return null;
  }
}

// ─── RECEIPT HANDLER ─────────────────────────────────────────────────────────

async function handleReceiptImage(fromPhone, mediaUrl, billName) {
  try {
    await sendSMS(fromPhone, `🪶 RAVEN\n\nGot your receipt! Scanning it now... 🔍`);

    const parsed = await parseReceiptWithClaude(mediaUrl);
    if (!parsed || !parsed.items || parsed.items.length === 0) {
      return `🪶 RAVEN\n\nCouldn't read the receipt. Try a clearer photo with good lighting.`;
    }

    const billId = generateBillId();
    const name = billName || 'Receipt Bill';

    const shareToken = generateShareToken();
    const { error: billError } = await supabase.from('bills').insert({
      id: billId,
      creator_phone: fromPhone,
      name,
      total: parsed.total || 0,
      per_person: 0,
      status: 'selecting',
      share_token: shareToken
    });
    if (billError) throw billError;

    const itemRows = parsed.items.map(item => ({
      bill_id: billId,
      name: item.name,
      price: item.price
    }));
    await supabase.from('receipt_items').insert(itemRows);

    await supabase.from('bills').update({
      tax: parsed.tax || 0,
      tip: parsed.tip || 0,
      subtotal: parsed.subtotal || 0
    }).eq('id', billId);

    const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : `https://raven-backend-production-fb1f.up.railway.app`;

    const billUrl = `${baseUrl}/bill/${billId}?t=${shareToken}`;

    await sendSMS(fromPhone, `🪶 RAVEN — Receipt Scanned!\n\n📋 ${name}\n💰 Total: ${formatMoney(parsed.total)}\n🧾 ${parsed.items.length} items found\n\nShare this link so everyone can pick what they ordered:\n${billUrl}\n\n🆔 Bill ID: ${billId}`);

    return null;
  } catch (err) {
    console.error('Receipt handler error:', err);
    return `🪶 RAVEN\n\nSomething went wrong scanning the receipt. Try again.`;
  }
}

// ─── COMMAND HANDLERS ────────────────────────────────────────────────────────

async function handleAdd(fromPhone, text) {
  try {
    const parts = text.trim().split(/\s+/);
    if (parts.length < 3) return `🪶 RAVEN\n\nUsage: ADD [Name] [PhoneNumber]\nExample: ADD Jake 3477887944`;
    const name = parts[1];
    const phone = normalizePhone(parts[2]);
    if (phone.length < 10) return `🪶 RAVEN\n\nInvalid phone number. Try: ADD Jake 3477887944`;
    const { error } = await supabase.from('contacts').upsert({
      owner_phone: fromPhone, name: name.toLowerCase(), phone
    }, { onConflict: 'owner_phone,name' });
    if (error) throw error;
    return `🪶 RAVEN — Contact Saved!\n\n✅ ${name} → ${phone}\n\nNow use @${name.toLowerCase()} in any SPLIT command.`;
  } catch (err) {
    console.error('ADD error:', err);
    return `🪶 RAVEN\n\nSomething went wrong. Try again.`;
  }
}

async function handleRemoveContact(fromPhone, text) {
  try {
    const parts = text.trim().split(/\s+/);
    if (parts.length < 2) return `🪶 RAVEN\n\nUsage: REMOVE [Name]`;
    const name = parts[1].toLowerCase();
    await supabase.from('contacts').delete().eq('owner_phone', fromPhone).ilike('name', name);
    return `🪶 RAVEN\n\n✅ ${name} removed from your contacts.`;
  } catch (err) {
    return `🪶 RAVEN\n\nSomething went wrong. Try again.`;
  }
}

async function handleContacts(fromPhone) {
  try {
    const contacts = await getAllContacts(fromPhone);
    if (contacts.length === 0) return `🪶 RAVEN\n\nNo contacts saved yet.\n\nAdd one: ADD Jake 3477887944`;
    let response = `🪶 RAVEN — Your Contacts\n\n`;
    contacts.forEach(c => { response += `👤 ${c.name} → ${c.phone}\n`; });
    response += `\nTo add: ADD [Name] [Phone]\nTo remove: REMOVE [Name]`;
    return response;
  } catch (err) {
    return `🪶 RAVEN\n\nSomething went wrong. Try again.`;
  }
}

async function handleSplit(fromPhone, text) {
  try {
    const match = text.match(/SPLIT\s+\$?([\d.]+)\s+(.*?)(\s+@\w+.*)?$/i);
    if (!match) return `🪶 RAVEN\n\nUsage: SPLIT $120 Dinner @Jake @Mia`;
    const total = parseFloat(match[1]);
    const mentions = parseMentions(text);
    const afterAmount = text.replace(/split\s+\$?[\d.]+\s*/i, '').trim();
    const billName = afterAmount.replace(/@\w+/g, '').trim() || 'Bill';

    if (isNaN(total) || total <= 0) return `🪶 RAVEN\n\nInvalid amount.`;
    if (mentions.length === 0) return `🪶 RAVEN\n\nNo one tagged.`;

    const resolvedContacts = [];
    const unknownContacts = [];
    for (const name of mentions) {
      const contact = await lookupContact(fromPhone, name);
      if (contact) resolvedContacts.push({ name, phone: contact.phone });
      else unknownContacts.push(name);
    }

    if (unknownContacts.length > 0) {
      return `🪶 RAVEN\n\nCouldn't find contacts: ${unknownContacts.join(', ')}\n\nAdd them first:\nADD [Name] [Phone]`;
    }

    const perPerson = total / mentions.length;
    const billId = generateBillId();

    const splitToken = generateShareToken();
    const { error: billError } = await supabase.from('bills').insert({
      id: billId, creator_phone: fromPhone, name: billName, total, per_person: perPerson, share_token: splitToken
    });
    if (billError) throw billError;

    const participantRows = resolvedContacts.map(({ name, phone }) => ({
      bill_id: billId, phone, name, amount: perPerson, paid: false
    }));
    await supabase.from('participants').insert(participantRows);

    for (const { name, phone } of resolvedContacts) {
      await sendSMS(phone, `🪶 RAVEN — You've been added to a bill!\n\n📋 ${billName}\n💰 You owe: ${formatMoney(perPerson)}\n🆔 Bill ID: ${billId}\n\nReply: PAID ${billId} ${name}`);
    }

    let response = `🪶 RAVEN — Bill Created!\n\n📋 ${billName}\n💰 Total: ${formatMoney(total)}\n👤 Each owes: ${formatMoney(perPerson)}\n🆔 Bill ID: ${billId}\n\n`;
    resolvedContacts.forEach(({ name }) => { response += `⏳ ${name} — ${formatMoney(perPerson)}\n`; });
    response += `\nEveryone has been notified!`;
    return response;
  } catch (err) {
    console.error('SPLIT error:', err);
    return `🪶 RAVEN\n\nSomething went wrong. Try again.`;
  }
}

async function handlePaid(fromPhone, text) {
  try {
    const parts = text.trim().split(/\s+/);
    const billId = parts[1]?.toUpperCase();
    if (!billId) return `🪶 RAVEN\n\nUsage: PAID [Bill ID] [YourName]`;
    const { data: bill } = await supabase.from('bills').select('*').eq('id', billId).single();
    if (!bill) return `🪶 RAVEN\n\nBill ${billId} not found.`;
    if (parts.length >= 3) return await handlePaidByName(fromPhone, billId, parts.slice(2).join(' '), bill);
    const { data: participant } = await supabase.from('participants').select('*').eq('bill_id', billId).eq('phone', fromPhone).single();
    if (!participant) return `🪶 RAVEN\n\nReply: PAID ${billId} [YourName]`;
    if (participant.paid) return `🪶 RAVEN\n\nYou already paid ${billId} ✅`;
    await supabase.from('participants').update({ paid: true, paid_at: new Date().toISOString() }).eq('id', participant.id);
    return await buildPaidResponse(bill, billId, participant, fromPhone);
  } catch (err) {
    console.error('PAID error:', err);
    return `🪶 RAVEN\n\nSomething went wrong. Try again.`;
  }
}

async function handlePaidByName(fromPhone, billId, name, bill) {
  try {
    const { data: participant } = await supabase.from('participants').select('*').eq('bill_id', billId).ilike('name', name).single();
    if (!participant) return `🪶 RAVEN\n\n"${name}" not found on bill ${billId}.`;
    if (participant.paid) return `🪶 RAVEN\n\n${name} already paid ✅`;
    await supabase.from('participants').update({ paid: true, paid_at: new Date().toISOString(), phone: fromPhone }).eq('id', participant.id);
    return await buildPaidResponse(bill, billId, participant, fromPhone);
  } catch (err) {
    console.error('PAID BY NAME error:', err);
    return `🪶 RAVEN\n\nSomething went wrong. Try again.`;
  }
}

async function buildPaidResponse(bill, billId, participant, fromPhone) {
  const { data: allParts } = await supabase.from('participants').select('*').eq('bill_id', billId);
  const paidCount = allParts.filter(p => p.paid).length;
  const totalCount = allParts.length;
  let response = `🪶 RAVEN — Payment Confirmed!\n\n✅ ${participant.name} paid ${formatMoney(participant.amount)} for ${bill.name}\n\n`;
  allParts.forEach(p => { response += p.paid ? `✅ ${p.name} — Paid\n` : `⏳ ${p.name} — ${formatMoney(p.amount)} owed\n`; });
  if (paidCount === totalCount) {
    response += `\n🎉 Everyone's settled up!`;
    await supabase.from('bills').update({ status: 'completed' }).eq('id', billId);
  } else {
    response += `\n${paidCount}/${totalCount} paid`;
  }
  if (bill.creator_phone !== fromPhone) {
    await sendSMS(bill.creator_phone, `🪶 RAVEN — ${participant.name} paid ${formatMoney(participant.amount)} for ${bill.name} (${billId})\n${paidCount}/${totalCount} paid`);
  }
  return response;
}

async function handleRemind(fromPhone, text) {
  try {
    const parts = text.trim().split(/\s+/);
    const billId = parts[1]?.toUpperCase();
    if (!billId) return `🪶 RAVEN\n\nUsage: REMIND [Bill ID]`;
    const { data: bill } = await supabase.from('bills').select('*').eq('id', billId).single();
    if (!bill) return `🪶 RAVEN\n\nBill ${billId} not found.`;
    if (bill.creator_phone !== fromPhone) return `🪶 RAVEN\n\nOnly the bill creator can send reminders.`;
    const { data: unpaid } = await supabase.from('participants').select('*').eq('bill_id', billId).eq('paid', false);
    if (!unpaid || unpaid.length === 0) return `🪶 RAVEN\n\nEveryone paid ${bill.name} already! 🎉`;
    let reminded = 0;
    for (const p of unpaid) {
      if (p.phone && !p.phone.startsWith('unknown_')) {
        await sendSMS(p.phone, `🪶 RAVEN — Reminder!\n\nHey ${p.name}, you still owe ${formatMoney(p.amount)} for ${bill.name}.\n\nReply: PAID ${billId} ${p.name}`);
        reminded++;
      }
    }
    const names = unpaid.map(p => p.name).join(', ');
    let response = `🪶 RAVEN — Reminders Sent!\n\n📋 ${bill.name} (${billId})\n⏳ Still owe: ${names}`;
    if (reminded > 0) response += `\n✅ Auto-pinged ${reminded} people`;
    return response;
  } catch (err) {
    console.error('REMIND error:', err);
    return `🪶 RAVEN\n\nSomething went wrong. Try again.`;
  }
}

async function handleStatus(fromPhone, text) {
  try {
    const parts = text.trim().split(/\s+/);
    const billId = parts[1]?.toUpperCase();
    if (!billId) return `🪶 RAVEN\n\nUsage: STATUS [Bill ID]`;
    const { data: bill } = await supabase.from('bills').select('*').eq('id', billId).single();
    if (!bill) return `🪶 RAVEN\n\nBill ${billId} not found.`;
    const { data: participants } = await supabase.from('participants').select('*').eq('bill_id', billId);
    const paidCount = participants.filter(p => p.paid).length;
    const totalCollected = participants.filter(p => p.paid).reduce((sum, p) => sum + parseFloat(p.amount), 0);
    let response = `🪶 RAVEN — Bill Status\n\n📋 ${bill.name}\n💰 Total: ${formatMoney(bill.total)}\n📊 ${paidCount}/${participants.length} paid\n\n`;
    participants.forEach(p => { response += p.paid ? `✅ ${p.name} — Paid\n` : `⏳ ${p.name} — ${formatMoney(p.amount)} owed\n`; });
    response += `\n💵 Collected: ${formatMoney(totalCollected)} / ${formatMoney(bill.total)}`;
    return response;
  } catch (err) {
    console.error('STATUS error:', err);
    return `🪶 RAVEN\n\nSomething went wrong. Try again.`;
  }
}

async function handleBills(fromPhone) {
  try {
    const { data: bills } = await supabase.from('bills').select('*, participants(*)').eq('creator_phone', fromPhone).eq('status', 'active').order('created_at', { ascending: false }).limit(5);
    if (!bills || bills.length === 0) return `🪶 RAVEN\n\nNo active bills.\n\nCreate one: SPLIT $120 Dinner @Jake @Mia`;
    let response = `🪶 RAVEN — Your Bills\n\n`;
    bills.forEach(b => {
      const paidCount = b.participants.filter(p => p.paid).length;
      response += `📋 ${b.name} (${b.id})\n   ${formatMoney(b.total)} · ${paidCount}/${b.participants.length} paid\n\n`;
    });
    return response + `Reply STATUS [ID] for details`;
  } catch (err) {
    console.error('BILLS error:', err);
    return `🪶 RAVEN\n\nSomething went wrong. Try again.`;
  }
}

function handleHelp() {
  return `🪶 RAVEN Commands\n\nADD Jake 3477887944\nCONTACTS\nREMOVE Jake\n\nSPLIT $120 Dinner @Jake @Mia\nPAID B7K2 Jake\nREMIND B7K2\nSTATUS B7K2\nBILLS\n\n📸 Send a receipt photo to split by item!\n\nRequest Automatically Via Every Network 🪶`;
}

// ─── WEBHOOK ─────────────────────────────────────────────────────────────────

app.post('/sms', async (req, res) => {
  const fromPhone = normalizePhone(req.body.From || '');
  const rawBody = (req.body.Body || '').trim();
  const body = rawBody.toUpperCase();
  const numMedia = parseInt(req.body.NumMedia || '0');
  const mediaUrl = req.body.MediaUrl0;
  const mediaType = req.body.MediaContentType0 || '';

  console.log(`📨 SMS from ${fromPhone}: ${rawBody} | media: ${numMedia}`);
  try { await supabase.from('message_log').insert({ from_phone: fromPhone, body: rawBody }); } catch (_) {}

  let reply = '';

  if (numMedia > 0 && mediaType.startsWith('image/')) {
    const billName = rawBody || 'Receipt Bill';
    const result = await handleReceiptImage(fromPhone, mediaUrl, billName);
    if (result) reply = result;
    else {
      const twiml = new twilio.twiml.MessagingResponse();
      res.type('text/xml').send(twiml.toString());
      return;
    }
  } else if (body.startsWith('ADD')) reply = await handleAdd(fromPhone, rawBody);
  else if (body.startsWith('REMOVE')) reply = await handleRemoveContact(fromPhone, rawBody);
  else if (body.startsWith('CONTACTS')) reply = await handleContacts(fromPhone);
  else if (body.startsWith('SPLIT')) reply = await handleSplit(fromPhone, rawBody);
  else if (body.startsWith('PAID')) reply = await handlePaid(fromPhone, rawBody);
  else if (body.startsWith('REMIND')) reply = await handleRemind(fromPhone, rawBody);
  else if (body.startsWith('STATUS')) reply = await handleStatus(fromPhone, rawBody);
  else if (body.startsWith('BILLS')) reply = await handleBills(fromPhone);
  else if (body.startsWith('HELP') || body === '?') reply = handleHelp();
  else reply = `🪶 RAVEN\n\nHey! I split bills over text.\n\nTry: SPLIT $60 Dinner @Jake @Mia\nOr send a 📸 receipt photo!\n\nReply HELP for all commands.`;

  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(reply);
  res.type('text/xml').send(twiml.toString());
});

// ─── BILL UI ─────────────────────────────────────────────────────────────────

app.get('/bill/:billId', async (req, res) => {
  const { billId } = req.params;
  const token = req.query.t || req.query.token;
  const { data: bill } = await supabase.from('bills').select('*').eq('id', billId).single();
  if (!bill) return res.status(404).send('Bill not found');

  if (bill.share_token && token !== bill.share_token) {
    return res.status(403).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RAVEN — Private Bill</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Helvetica Neue',sans-serif;background:#06060A;color:#F0EEF8;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px}.wrap{max-width:360px}.icon{font-size:48px;margin-bottom:20px}.title{font-size:28px;font-weight:700;margin-bottom:10px}.sub{color:#6E6B80;font-size:15px;line-height:1.6}</style></head><body><div class="wrap"><div class="icon">🔒</div><div class="title">Private Bill</div><div class="sub">This link is invalid or expired. Ask the bill creator to share the correct link.</div></div></body></html>`);
  }

  const { data: items } = await supabase.from('receipt_items').select('*').eq('bill_id', billId);
  const { data: selections } = await supabase.from('item_selections').select('*').eq('bill_id', billId);
  const { data: participants } = await supabase.from('participants').select('*').eq('bill_id', billId).order('name');
  // Creator phone is actually their email for dashboard-created bills
  // Try email match first, then fall back to searching by phone
  let creatorProfile = null;
  try {
    const emailMatch = await supabase.from('profiles')
      .select('first_name,venmo,cashapp,zelle,applepay')
      .eq('email', bill.creator_phone)
      .maybeSingle();
    creatorProfile = emailMatch.data;
    if (!creatorProfile) {
      // Try phone match as fallback
      const phoneMatch = await supabase.from('profiles')
        .select('first_name,venmo,cashapp,zelle,applepay')
        .eq('phone', bill.creator_phone)
        .maybeSingle();
      creatorProfile = phoneMatch.data;
    }
  } catch(e) { console.log('Profile fetch error:', e.message); }

  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `https://raven-backend-production-fb1f.up.railway.app`;

  const receiptHTML = bill.receipt_image
    ? `<div style="padding:16px 20px 0;max-width:500px;margin:0 auto"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6E6B80;font-weight:600;margin-bottom:8px">Receipt</div><img src="data:image/jpeg;base64,${bill.receipt_image}" style="width:100%;border-radius:14px;display:block;border:1px solid rgba(255,255,255,0.07)"></div>` : '';

  const participantsHTML = (participants || []).length > 0 ? `
    <div style="max-width:500px;margin:20px auto 0;padding:0 20px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6E6B80;font-weight:600;margin-bottom:10px">Who owes what</div>
      <div style="background:#0C0C12;border:1px solid rgba(255,255,255,0.07);border-radius:16px;overflow:hidden">
        ${(participants || []).map(p => `
          <div id="prow-${p.id}" style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.05)">
            <div>
              <div style="font-size:15px;font-weight:600;color:#F0EEF8">${p.name}</div>
              <div id="pstatus-${p.id}" style="font-size:12px;color:${p.paid ? '#30D158' : '#6E6B80'};margin-top:2px">${p.paid ? '✅ Paid' : '⏳ Owes $' + parseFloat(p.amount).toFixed(2)}</div>
            </div>
            ${!p.paid ? `<button onclick="showPayOptions('${p.id}','${p.name}',${parseFloat(p.amount).toFixed(2)})" id="paybtn-${p.id}" style="padding:9px 18px;background:#30D158;border:none;border-radius:10px;color:#000;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;flex-shrink:0">💳 Pay</button>` : ''}
          </div>`).join('')}
      </div>
    </div>` : '';

  const itemsHTML = (items || []).length > 0 ? `
    <div style="max-width:500px;margin:20px auto 0;padding:0 20px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6E6B80;font-weight:600;margin-bottom:10px">Items</div>
      <div style="background:#0C0C12;border:1px solid rgba(255,255,255,0.07);border-radius:16px;overflow:hidden">
        ${(items || []).map(item => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.05)">
            <span style="font-size:14px;color:#F0EEF8">${item.name}</span>
            <span style="font-size:14px;font-weight:600;color:#9896A8">$${parseFloat(item.price).toFixed(2)}</span>
          </div>`).join('')}
        ${bill.tax ? `<div style="display:flex;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.05)"><span style="font-size:13px;color:#6E6B80">Tax</span><span style="font-size:13px;color:#6E6B80">$${parseFloat(bill.tax).toFixed(2)}</span></div>` : ''}
        ${bill.tip ? `<div style="display:flex;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.05)"><span style="font-size:13px;color:#6E6B80">Tip</span><span style="font-size:13px;color:#6E6B80">$${parseFloat(bill.tip).toFixed(2)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;padding:14px 16px"><span style="font-size:15px;font-weight:700;color:#F0EEF8">Total</span><span style="font-size:15px;font-weight:700;color:#30D158">$${parseFloat(bill.total || 0).toFixed(2)}</span></div>
      </div>
    </div>` : '';

  const profileJson = JSON.stringify(creatorProfile || {}).replace(/</g, '\u003c').replace(/>/g, '\u003e');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <title>🪶 ${bill.name} — RAVEN</title>
  <meta property="og:title" content="🪶 ${bill.name} — You've been spotted by RAVEN" />
  <meta property="og:description" content="Tap to see what you owe. Total: $${parseFloat(bill.total || 0).toFixed(2)}" />
  <meta property="og:image" content="https://work46121-gif.github.io/raven-site/raven-hero.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url" content="${baseUrl}/bill/${billId}?t=${token || ''}" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Helvetica Neue',Arial,sans-serif;background:#06060A;color:#F0EEF8;min-height:100vh;padding-bottom:100px}
    .header{position:sticky;top:0;background:rgba(6,6,10,0.95);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,0.07);padding:0 20px;z-index:100}
    .header-inner{max-width:500px;margin:0 auto;height:56px;display:flex;align-items:center;justify-content:space-between}
    .brand{font-size:20px;font-weight:900;letter-spacing:0.15em;color:#F0EEF8}
    .bill-hero{max-width:500px;margin:20px auto 0;padding:0 20px}
    .bill-title{font-size:32px;font-weight:800;letter-spacing:-0.01em;margin-bottom:6px}
    .bill-meta{display:flex;gap:12px;flex-wrap:wrap}
    .bill-tag{font-size:12px;color:#6E6B80}
    .bill-tag span{color:#F0EEF8;font-weight:600}
    .pm-row{display:flex;align-items:center;gap:14px;padding:14px 16px;background:#0C0C12;border:1px solid rgba(255,255,255,0.06);border-radius:12px;text-decoration:none;margin-bottom:8px;transition:all 0.18s}
    .pm-row:hover{border-color:rgba(255,255,255,0.15);transform:translateX(2px)}
    .pm-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:700;font-size:15px;color:#fff}
    .pm-info{flex:1;display:flex;flex-direction:column;gap:2px}
    .pm-info b{font-size:14px;font-weight:600;color:#F0EEF8}
    .pm-info span{font-size:11px;color:#6E6B80}
  </style>
</head>
<body>
  <div class="header">
    <div class="header-inner">
      <div class="brand">🪶 RAVEN</div>
      <div style="font-size:11px;color:#6E6B80;background:rgba(255,255,255,0.05);padding:4px 10px;border-radius:20px;font-weight:600">${billId}</div>
    </div>
  </div>

  <div class="bill-hero">
    <div class="bill-title">${bill.name}</div>
    <div class="bill-meta">
      <div class="bill-tag">Total <span>$${parseFloat(bill.total || 0).toFixed(2)}</span></div>
      ${(participants || []).length > 0 ? `<div class="bill-tag"><span>${(participants||[]).length}</span> people</div>` : ''}
    </div>
  </div>

  ${receiptHTML}
  ${participantsHTML}
  ${itemsHTML}

  <!-- Comments Section -->
  <div style="max-width:500px;margin:24px auto 0;padding:0 20px">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6E6B80;font-weight:600;margin-bottom:10px">Comments</div>
    <div id="comments-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
      <div style="color:#6E6B80;font-size:13px;text-align:center;padding:12px 0" id="no-comments-msg">No comments yet</div>
    </div>
    <div style="background:#0C0C12;border:1px solid rgba(255,255,255,0.07);border-radius:14px;overflow:hidden">
      <input id="comment-name" type="text" placeholder="Your name" autocomplete="off" style="width:100%;padding:12px 16px;background:transparent;border:none;border-bottom:1px solid rgba(255,255,255,0.07);color:#F0EEF8;font-family:inherit;font-size:14px;outline:none" />
      <textarea id="comment-text" placeholder="Add a comment about this bill... e.g. Can we double-check if this is correct?" rows="3" style="width:100%;padding:12px 16px;background:transparent;border:none;border-bottom:1px solid rgba(255,255,255,0.07);color:#F0EEF8;font-family:inherit;font-size:14px;outline:none;resize:none;line-height:1.5"></textarea>
      <button onclick="postComment()" style="width:100%;padding:13px;background:rgba(48,209,88,0.12);border:none;color:#30D158;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer;transition:background 0.15s" onmouseover="this.style.background='rgba(48,209,88,0.2)'" onmouseout="this.style.background='rgba(48,209,88,0.12)'">💬 Post Comment</button>
    </div>
  </div>

  <div id="creatorProfile" data-value='${profileJson}' style="display:none"></div>

  <!-- Pay Modal -->
  <div id="pay-modal" style="display:none;position:fixed;inset:0;z-index:999">
    <div onclick="closePayModal()" style="position:absolute;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(10px);cursor:pointer"></div>
    <div style="position:absolute;bottom:0;left:0;right:0;display:flex;justify-content:center">
      <div style="background:#0C0C12;border:1px solid rgba(255,255,255,0.1);border-radius:24px 24px 0 0;padding:28px 20px 52px;width:100%;max-width:480px">
        <div style="width:36px;height:4px;background:rgba(255,255,255,0.12);border-radius:2px;margin:0 auto 20px"></div>
        <div style="font-size:20px;font-weight:700;margin-bottom:4px">Pay <span id="pm-name"></span></div>
        <div style="font-size:42px;font-weight:800;color:#30D158;margin-bottom:20px;letter-spacing:-0.02em" id="pm-amount">$0.00</div>
        <div id="pm-methods" style="margin-bottom:14px"></div>
        <button id="pm-mark-btn" style="width:100%;padding:14px;background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#9896A8;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:8px">✓ Mark as paid (other method)</button>
        <button onclick="closePayModal()" style="width:100%;padding:12px;background:transparent;border:none;color:#6E6B80;font-family:inherit;font-size:13px;cursor:pointer">I'll pay later</button>
      </div>
    </div>
  </div>

  <script>
    let currentParticipantId = null;

    function showPayOptions(participantId, name, amount) {
      currentParticipantId = participantId;
      const profile = JSON.parse(document.getElementById('creatorProfile').dataset.value || '{}');
      document.getElementById('pm-name').textContent = name;
      document.getElementById('pm-amount').textContent = '$' + parseFloat(amount).toFixed(2);

      const methods = [];
      const amt = parseFloat(amount).toFixed(2);

      if (profile.venmo) {
        const handle = profile.venmo.startsWith('@') ? profile.venmo : '@' + profile.venmo;
        const url = 'https://venmo.com/' + profile.venmo.replace('@','') + '?txn=pay&note=Bill&amount=' + amt;
        methods.push('<a href="' + url + '" target="_blank" class="pm-row"><div class="pm-icon" style="background:#008CFF">V</div><div class="pm-info"><b>Venmo</b><span>' + handle + '</span></div><span style="color:#6E6B80">→</span></a>');
      }
      if (profile.cashapp) {
        const tag = profile.cashapp.startsWith('$') ? profile.cashapp : '$' + profile.cashapp;
        const url = 'https://cash.app/' + profile.cashapp.replace('$','') + '/' + amt;
        methods.push('<a href="' + url + '" target="_blank" class="pm-row"><div class="pm-icon" style="background:#00D632">$</div><div class="pm-info"><b>Cash App</b><span>' + tag + '</span></div><span style="color:#6E6B80">→</span></a>');
      }
      if (profile.zelle) {
        const zel = profile.zelle;
        methods.push('<a href="#" onclick="navigator.clipboard.writeText(\'' + zel + '\').then(()=>showToast(\'Copied!\'));return false" class="pm-row"><div class="pm-icon" style="background:#6D1ED4">Z</div><div class="pm-info"><b>Zelle</b><span>' + zel + ' · tap to copy</span></div><span style="color:#6E6B80">→</span></a>');
      }
      if (profile.applepay) {
        const ap = profile.applepay;
        methods.push('<a href="#" onclick="navigator.clipboard.writeText(\'' + ap + '\').then(()=>showToast(\'Copied!\'));return false" class="pm-row"><div class="pm-icon" style="background:#222;border:1px solid #444;font-size:9px;color:#fff">Pay</div><div class="pm-info"><b>Apple Pay</b><span>' + ap + ' · tap to copy</span></div><span style="color:#6E6B80">→</span></a>');
      }

      if (methods.length === 0) {
        methods.push('<p style="color:#6E6B80;text-align:center;padding:16px 0;font-size:13px">No payment methods set up yet</p>');
      }

      document.getElementById('pm-methods').innerHTML = methods.join('');
      document.getElementById('pm-mark-btn').onclick = () => markPaid(participantId, name);
      document.getElementById('pay-modal').style.display = 'block';
    }

    async function markPaid(participantId, name) {
      try {
        const billId = '${billId}';
        const res = await fetch('/bill/' + billId + '/mark-paid', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ participantId, name })
        });
        const data = await res.json();
        if (data.success) {
          document.getElementById('pay-modal').style.display = 'none';
          const btn = document.getElementById('paybtn-' + participantId);
          if (btn) btn.remove();
          const status = document.getElementById('pstatus-' + participantId);
          if (status) status.innerHTML = '✅ Paid';
          showToast('✅ Marked as paid!');
        }
      } catch(e) { alert('Error. Please try again.'); }
    }

    function closePayModal() {
      document.getElementById('pay-modal').style.display = 'none';
    }

    const BILL_ID = '${billId}';

    async function loadComments() {
      try {
        const res = await fetch('/bill/' + BILL_ID + '/comments');
        const data = await res.json();
        renderComments(data.comments || []);
      } catch(e) {}
    }

    function renderComments(comments) {
      const list = document.getElementById('comments-list');
      const noMsg = document.getElementById('no-comments-msg');
      if (comments.length === 0) {
        if (noMsg) noMsg.style.display = 'block';
        return;
      }
      if (noMsg) noMsg.style.display = 'none';
      list.innerHTML = comments.map(c => {
        const date = new Date(c.created_at).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
        return '<div style="background:#0C0C12;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:14px 16px">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
          '<span style="font-size:13px;font-weight:700;color:#F0EEF8">' + (c.name || 'Anonymous') + '</span>' +
          '<span style="font-size:11px;color:#6E6B80">' + date + '</span>' +
          '</div>' +
          '<div style="font-size:14px;color:#9896A8;line-height:1.5">' + c.body + '</div>' +
          '</div>';
      }).join('');
    }

    async function postComment() {
      const name = document.getElementById('comment-name').value.trim();
      const body = document.getElementById('comment-text').value.trim();
      if (!body) { showToast('Please write a comment first'); return; }
      try {
        const res = await fetch('/bill/' + BILL_ID + '/comments', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ name: name || 'Anonymous', body })
        });
        const data = await res.json();
        if (data.success) {
          document.getElementById('comment-text').value = '';
          loadComments();
          showToast('✅ Comment posted!');
        }
      } catch(e) { showToast('Error posting comment'); }
    }

    loadComments();

        function showToast(msg) {
      let t = document.getElementById('toast');
      if (!t) { t = document.createElement('div'); t.id = 'toast'; t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1A1A24;border:1px solid rgba(48,209,88,0.3);color:#30D158;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:600;z-index:9999;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,0.5)'; document.body.appendChild(t); }
      t.textContent = msg;
      t.style.opacity = '1';
      setTimeout(() => t.style.opacity = '0', 3000);
    }
  </script>
</body>
</html>`;

  res.send(html);
});



// ─── BILL COMMENTS ────────────────────────────────────────────────────────────

app.get('/bill/:billId/comments', async (req, res) => {
  try {
    const { billId } = req.params;
    const { data } = await supabase
      .from('bill_comments')
      .select('*')
      .eq('bill_id', billId)
      .order('created_at', { ascending: true });
    res.json({ success: true, comments: data || [] });
  } catch(err) {
    res.json({ success: false, comments: [] });
  }
});

app.post('/bill/:billId/comments', async (req, res) => {
  try {
    const { billId } = req.params;
    const { name, body } = req.body;
    if (!body?.trim()) return res.json({ success: false, error: 'Empty comment' });

    await supabase.from('bill_comments').insert({
      bill_id: billId,
      name: name?.trim() || 'Anonymous',
      body: body.trim(),
      created_at: new Date().toISOString()
    });

    const { data: bill } = await supabase.from('bills').select('name, creator_phone').eq('id', billId).single();
    if (bill?.creator_phone && !bill.creator_phone.includes('@')) {
      await sendSMS(bill.creator_phone,
        `🪶 RAVEN — New comment on ${bill.name}:\n\n"${body.trim().substring(0, 100)}"\n— ${name || 'Anonymous'}`
      );
    }

    res.json({ success: true });
  } catch(err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/bill/:billId/mark-paid', async (req, res) => {
  try {
    const { billId } = req.params;
    const { participantId, name } = req.body;
    const { data: bill } = await supabase.from('bills').select('*').eq('id', billId).single();
    if (!bill) return res.json({ success: false, error: 'Bill not found' });
    await supabase.from('participants')
      .update({ paid: true, paid_at: new Date().toISOString() })
      .eq('id', participantId);
    if (bill.creator_phone && !bill.creator_phone.includes('@')) {
      await sendSMS(bill.creator_phone,
        `🪶 RAVEN — ${name} marked themselves as paid for ${bill.name}!\n\nReply STATUS ${billId} for the full update.`
      );
    }
    res.json({ success: true });
  } catch(err) {
    res.json({ success: false, error: err.message });
  }
});

// ─── SAVE SELECTIONS ─────────────────────────────────────────────────────────

app.post('/bill/:billId/select', async (req, res) => {
  try {
    const { billId } = req.params;
    const { name, items } = req.body;
    if (!name || !items || items.length === 0) return res.json({ success: false });

    const { data: bill } = await supabase.from('bills').select('*').eq('id', billId).single();
    if (!bill) return res.json({ success: false });

    await supabase.from('item_selections').delete().eq('bill_id', billId).eq('participant_name', name.toLowerCase());

    const rows = items.map(itemId => ({
      bill_id: billId,
      item_id: itemId,
      participant_name: name.toLowerCase()
    }));
    await supabase.from('item_selections').insert(rows);

    const { data: receiptItems } = await supabase.from('receipt_items').select('*').eq('bill_id', billId);
    const { data: allSelections } = await supabase.from('item_selections').select('*').eq('bill_id', billId);

    let myTotal = 0;
    items.forEach(itemId => {
      const item = receiptItems.find(i => i.id === itemId);
      if (item) myTotal += parseFloat(item.price);
    });

    const uniquePeople = [...new Set(allSelections.map(s => s.participant_name))];
    const myTax = (bill.tax || 0) / Math.max(uniquePeople.length, 1);
    const myTip = (bill.tip || 0) / Math.max(uniquePeople.length, 1);
    myTotal += myTax + myTip;

    await sendSMS(bill.creator_phone, `🪶 RAVEN — ${name} selected their items for ${bill.name}\n💰 Their total: ${formatMoney(myTotal)}\n\n${uniquePeople.length} people have selected so far.`);

    res.json({ success: true });
  } catch (err) {
    console.error('Select error:', err);
    res.json({ success: false });
  }
});

// ─── DEMO BILL CREATE ─────────────────────────────────────────────────────────

app.post('/demo/create', async (req, res) => {
  try {
    const { type, name, items, people, total, tax, tip, subtotal } = req.body;
    const billId = generateBillId();

    if (type === 'itemized') {
      const { error: billError } = await supabase.from('bills').insert({
        id: billId,
        creator_phone: 'demo',
        name: name || 'Demo Dinner',
        total: total || 0,
        per_person: 0,
        status: 'selecting',
        tax: tax || 0,
        tip: tip || 0,
        subtotal: subtotal || 0
      });
      if (billError) throw billError;

      if (items && items.length > 0) {
        await supabase.from('receipt_items').insert(
          items.map(item => ({ bill_id: billId, name: item.name, price: item.price }))
        );
      }

    } else if (type === 'simple') {
      const perPerson = people && people.length > 0 ? total / people.length : total;
      const { error: billError } = await supabase.from('bills').insert({
        id: billId,
        creator_phone: 'demo',
        name: name || 'Demo Split',
        total: total || 0,
        per_person: perPerson,
        status: 'active'
      });
      if (billError) throw billError;

      if (people && people.length > 0) {
        await supabase.from('participants').insert(
          people.map(p => ({
            bill_id: billId,
            phone: `demo_${p.name.toLowerCase().replace(/\s+/g, '_')}`,
            name: p.name,
            amount: p.amount || perPerson,
            paid: false
          }))
        );
      }
    }

    console.log(`✅ Demo bill created: ${billId} (${type})`);
    res.json({ success: true, billId });
  } catch (err) {
    console.error('Demo create error:', err);
    res.json({ success: false, error: err.message });
  }
});

// ─── DEMO RECEIPT SCAN ───────────────────────────────────────────────────────

app.post('/demo/scan-receipt', async (req, res) => {
  try {
    const { image, mediaType } = req.body;
    if (!image) return res.json({ success: false, error: 'No image provided' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    console.log(`🔍 ANTHROPIC_API_KEY present: ${!!apiKey}, length: ${apiKey?.length}`);

    if (!apiKey) {
      return res.json({ success: false, error: 'ANTHROPIC_API_KEY not set in environment' });
    }

    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: image }
          },
          {
            type: 'text',
            text: `Parse this receipt and return ONLY a JSON object with this exact structure, no other text:
{
  "restaurant_name": "Restaurant or store name from the receipt",
  "items": [{"name": "Item Name", "price": 0.00}],
  "subtotal": 0.00,
  "tax": 0.00,
  "tip": 0.00,
  "total": 0.00
}
Rules:
- restaurant_name: extract the business/restaurant name from the top of the receipt. If unclear, use a short descriptive name.
- Include every ordered item with its price
- If tip is not shown, set to 0
- Return ONLY the JSON, no other text`
          }
        ]
      }]
    });

    const text = message.content[0].text.trim();
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    console.log(`✅ Demo receipt scanned: ${parsed.items?.length} items, total $${parsed.total}, name: ${parsed.restaurant_name}`);
    res.json({ success: true, ...parsed, bill_name: parsed.restaurant_name });
  } catch (err) {
    console.error('Demo scan error:', err);
    res.json({ success: false, error: err.message });
  }
});

// ─── REMIND FROM DASHBOARD ───────────────────────────────────────────────────

app.post('/remind-dashboard', async (req, res) => {
  try {
    const { billId } = req.body;
    if (!billId) return res.status(400).json({ error: 'Missing billId' });
    const { data: bill } = await supabase.from('bills').select('*').eq('id', billId).single();
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    const { data: unpaid } = await supabase.from('participants').select('*').eq('bill_id', billId).eq('paid', false);
    if (!unpaid || unpaid.length === 0) return res.json({ success: true, reminded: 0 });
    let reminded = 0;
    for (const p of unpaid) {
      if (p.phone && !p.phone.startsWith('unknown_')) {
        await sendSMS(p.phone, `🪶 RAVEN — Reminder!\n\nHey ${p.name}, you still owe $${parseFloat(p.amount).toFixed(2)} for ${bill.name}.\n\nReply: PAID ${billId} ${p.name}\n\nThanks! 🙏`);
        reminded++;
      }
    }
    res.json({ success: true, reminded, unpaid: unpaid.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── WAITLIST ─────────────────────────────────────────────────────────────────

app.post('/waitlist', async (req, res) => {
  const { email, timestamp, source } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Invalid email' });
  try {
    await supabase.from('waitlist').insert({ email, source: source || 'website', created_at: timestamp || new Date().toISOString() });
    console.log('Waitlist signup:', email);
    res.json({ success: true });
  } catch (err) {
    console.error('Waitlist error:', err);
    res.json({ success: true });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'RAVEN is live 🪶', version: '2.0.0', twilio: TWILIO_READY ? 'connected' : 'pending' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🪶 RAVEN SMS server running on port ${PORT}`));
