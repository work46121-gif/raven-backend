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
  if (!bill) return res.status(404).send('<h1>Bill not found</h1>');
  if (bill.share_token && token !== bill.share_token) {
    return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RAVEN</title><style>body{font-family:Helvetica,sans-serif;background:#06060A;color:#F0EEF8;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px}</style></head><body><div style="max-width:360px"><div style="font-size:48px;margin-bottom:20px">🔒</div><h2>Private Bill</h2><p style="color:#6E6B80;margin-top:10px">Ask the bill creator to share the correct link.</p></div></body></html>');
  }

  const [itemsRes, selectionsRes, participantsRes] = await Promise.all([
    supabase.from('receipt_items').select('*').eq('bill_id', billId),
    supabase.from('item_selections').select('*').eq('bill_id', billId),
    supabase.from('participants').select('*').eq('bill_id', billId).order('name')
  ]);
  const items = itemsRes.data || [];
  const selections = selectionsRes.data || [];
  const participants = participantsRes.data || [];

  let creatorProfile = null;
  const emailTry = await supabase.from('profiles').select('first_name,venmo,cashapp,zelle,applepay').eq('email', bill.creator_phone).maybeSingle();
  creatorProfile = emailTry.data;
  if (!creatorProfile) {
    const phoneTry = await supabase.from('profiles').select('first_name,venmo,cashapp,zelle,applepay').eq('phone', bill.creator_phone).maybeSingle();
    creatorProfile = phoneTry.data;
  }

  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `https://raven-backend-production-fb1f.up.railway.app`;

  const receiptHTML = bill.receipt_image
    ? `<div style="padding:16px 20px 0;max-width:500px;margin:0 auto"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6E6B80;font-weight:600;margin-bottom:8px">Receipt</div><img src="data:image/jpeg;base64,${bill.receipt_image}" style="width:100%;border-radius:14px;display:block"></div>` : '';

  // Build per-person item map with prices
  const participantItems = {}; // name -> [{name, price, splitWith}]
  participants.forEach(p => { participantItems[p.name.toLowerCase()] = []; });
  if (items.length > 0 && selections.length > 0) {
    items.forEach(item => {
      const claimers = selections.filter(s => String(s.item_id) === String(item.id)).map(s => s.participant_name);
      claimers.forEach(claimer => {
        const key = claimer.toLowerCase();
        if (participantItems[key] !== undefined) {
          participantItems[key].push({ name: item.name, price: parseFloat(item.price), splitWith: claimers.length });
        }
      });
    });
    const hasAny = Object.values(participantItems).some(a => a.length > 0);
    if (!hasAny) {
      participants.forEach(p => {
        participantItems[p.name.toLowerCase()] = items.map(i => ({ name: i.name, price: parseFloat(i.price), splitWith: participants.length }));
      });
    }
  }

  function buildBreakdown(p, myItems, bill, participantCount) {
    if (myItems.length === 0) {
      const amount = parseFloat(p.amount||0);
      if (amount <= 0) return '';
      return '<div style="margin-top:6px;background:rgba(255,255,255,0.03);border-radius:8px;padding:8px 10px"><div style="display:flex;justify-content:space-between"><span style="font-size:11px;font-weight:700;color:#F0EEF8">Total</span><span style="font-size:12px;font-weight:700;color:#30D158;font-family:monospace">$'+amount.toFixed(2)+'</span></div></div>';
    }
    const tax = parseFloat(bill.tax||0);
    const tip = parseFloat(bill.tip||0);
    const shared = participantCount > 0 ? (tax+tip)/participantCount : 0;
    const itemsTotal = myItems.reduce((s,i) => s + i.price/i.splitWith, 0);
    let rows = myItems.map(i => {
      const share = (i.price/i.splitWith).toFixed(2);
      const split = i.splitWith > 1 ? ` <span style="color:#9896A8;font-size:10px">(÷${i.splitWith})</span>` : '';
      return `<div style="display:flex;justify-content:space-between;padding:3px 0"><span style="font-size:11px;color:#6E6B80">${i.name}${split}</span><span style="font-size:11px;color:#9896A8;font-family:monospace">$${share}</span></div>`;
    }).join('');
    let shared_rows = '';
    if (tax) shared_rows += `<div style="display:flex;justify-content:space-between;padding:2px 0"><span style="font-size:11px;color:#6E6B80">Tax (split)</span><span style="font-size:11px;color:#9896A8;font-family:monospace">$${(tax/participantCount).toFixed(2)}</span></div>`;
    if (tip) shared_rows += `<div style="display:flex;justify-content:space-between;padding:2px 0"><span style="font-size:11px;color:#6E6B80">Tip (split)</span><span style="font-size:11px;color:#9896A8;font-family:monospace">$${(tip/participantCount).toFixed(2)}</span></div>`;
    const divider = shared_rows ? `<div style="border-top:1px solid rgba(255,255,255,0.06);margin-top:4px;padding-top:4px">${shared_rows}</div>` : '';
    const total = (itemsTotal + shared).toFixed(2);
    return `<div style="margin-top:8px;background:rgba(255,255,255,0.03);border-radius:8px;padding:8px 10px">${rows}${divider}<div style="border-top:1px solid rgba(255,255,255,0.08);margin-top:4px;padding-top:5px;display:flex;justify-content:space-between"><span style="font-size:11px;font-weight:700;color:#F0EEF8">Total</span><span style="font-size:12px;font-weight:700;color:#30D158;font-family:monospace">$${total}</span></div></div>`;
  }

  const participantsHTML = participants.length > 0 ? `
    <div style="max-width:500px;margin:20px auto 0;padding:0 20px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6E6B80;font-weight:600;margin-bottom:10px">Who owes what</div>
      <div style="background:#0C0C12;border:1px solid rgba(255,255,255,0.07);border-radius:16px;overflow:hidden">
        ${participants.map(p => {
          const myItems = participantItems[p.name.toLowerCase()] || [];
          const safeName = p.name.replace(/"/g, '&quot;');
          const breakdownHTML = buildBreakdown(p, myItems, bill, participants.length);
          return `<div id="prow-${p.id}" style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.05)">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
              <div style="min-width:0;flex:1">
                <div style="font-size:15px;font-weight:600;color:#F0EEF8">${p.name}</div>
                <div id="pstatus-${p.id}" style="font-size:12px;color:${p.paid ? '#30D158' : '#6E6B80'};margin-top:2px">${p.paid ? '✅ Paid' : 'Owes $' + parseFloat(p.amount).toFixed(2)}</div>
                ${breakdownHTML}
              </div>
              ${!p.paid ? `<button onclick="showPay(this)" data-pid="${p.id}" data-name="${safeName}" data-amount="${parseFloat(p.amount).toFixed(2)}" id="paybtn-${p.id}" style="padding:9px 18px;background:#30D158;border:none;border-radius:10px;color:#000;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;flex-shrink:0;margin-top:2px">💳 Pay</button>` : '<span style="font-size:18px">✅</span>'}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  const itemsListHTML = items.length > 0 ? `
    <div style="max-width:500px;margin:20px auto 0;padding:0 20px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6E6B80;font-weight:600;margin-bottom:10px">Items</div>
      <div style="background:#0C0C12;border:1px solid rgba(255,255,255,0.07);border-radius:16px;overflow:hidden">
        ${items.map(i => `<div style="display:flex;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.05)"><span style="font-size:14px;color:#F0EEF8">${i.name}</span><span style="font-size:14px;color:#9896A8">$${parseFloat(i.price).toFixed(2)}</span></div>`).join('')}
        ${bill.tax ? `<div style="display:flex;justify-content:space-between;padding:11px 16px;border-bottom:1px solid rgba(255,255,255,0.05)"><span style="font-size:13px;color:#6E6B80">Tax</span><span style="font-size:13px;color:#6E6B80">$${parseFloat(bill.tax).toFixed(2)}</span></div>` : ''}
        ${bill.tip ? `<div style="display:flex;justify-content:space-between;padding:11px 16px;border-bottom:1px solid rgba(255,255,255,0.05)"><span style="font-size:13px;color:#6E6B80">Tip</span><span style="font-size:13px;color:#6E6B80">$${parseFloat(bill.tip).toFixed(2)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;padding:14px 16px"><span style="font-size:15px;font-weight:700;color:#F0EEF8">Total</span><span style="font-size:15px;font-weight:700;color:#30D158">$${parseFloat(bill.total || 0).toFixed(2)}</span></div>
      </div>
    </div>` : '';

  const profileB64 = Buffer.from(JSON.stringify(creatorProfile || {})).toString('base64');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <title>🪶 ${bill.name} — RAVEN</title>
  <meta property="og:title" content="🪶 ${bill.name} — You've been spotted by RAVEN" />
  <meta property="og:description" content="Tap to see what you owe. Total: $${parseFloat(bill.total||0).toFixed(2)}" />
  <meta property="og:image" content="https://work46121-gif.github.io/raven-site/raven-hero.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url" content="${baseUrl}/bill/${billId}" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;background:#06060A;color:#F0EEF8;min-height:100vh;padding-bottom:120px}
    .hdr{position:sticky;top:0;background:rgba(6,6,10,0.95);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,0.07);padding:0 20px;z-index:100}
    .hdr-i{max-width:500px;margin:0 auto;height:56px;display:flex;align-items:center;justify-content:space-between}
    .pm-row{display:flex;align-items:center;gap:14px;padding:14px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;text-decoration:none;margin-bottom:8px;-webkit-tap-highlight-color:transparent;width:100%;cursor:pointer}
    .pm-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:700;font-size:14px;color:#fff}
    .pm-info{flex:1;display:flex;flex-direction:column;gap:2px;text-align:left}
    .pm-info b{font-size:14px;font-weight:600;color:#F0EEF8}
    .pm-info span{font-size:11px;color:#6E6B80}
  </style>
</head>
<body>
  <div class="hdr"><div class="hdr-i">
    <div style="font-size:18px;font-weight:900;letter-spacing:0.12em"><a href="https://work46121-gif.github.io/raven-site/" style="text-decoration:none;color:inherit">🪶 RAVEN</a></div>
    <div style="font-size:11px;color:#6E6B80;background:rgba(255,255,255,0.05);padding:4px 10px;border-radius:20px;font-weight:600">${billId}</div>
  </div></div>

  <div style="max-width:500px;margin:20px auto 0;padding:0 20px">
    <div style="font-size:28px;font-weight:800;margin-bottom:6px">${bill.name}</div>
    <div style="display:flex;gap:12px">
      <span style="font-size:12px;color:#6E6B80">Total <strong style="color:#F0EEF8">$${parseFloat(bill.total||0).toFixed(2)}</strong></span>
      ${participants.length > 0 ? `<span style="font-size:12px;color:#6E6B80"><strong style="color:#F0EEF8">${participants.length}</strong> people</span>` : ''}
    </div>
  </div>

  ${receiptHTML}
  ${participantsHTML}
  ${itemsListHTML}

  <div style="max-width:500px;margin:24px auto 0;padding:0 20px 40px">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6E6B80;font-weight:600;margin-bottom:10px">Comments</div>
    <div id="clist" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
      <div id="no-c" style="color:#6E6B80;font-size:13px;text-align:center;padding:12px 0">No comments yet</div>
    </div>
    <div style="background:#0C0C12;border:1px solid rgba(255,255,255,0.07);border-radius:14px;overflow:hidden">
      <input id="cname" type="text" placeholder="Your name" style="width:100%;padding:12px 16px;background:transparent;border:none;border-bottom:1px solid rgba(255,255,255,0.07);color:#F0EEF8;font-family:inherit;font-size:14px;outline:none"/>
      <div id="gif-preview-wrap" style="display:none;padding:0 12px;"></div>
      <textarea id="cbody" placeholder="Add a comment... or just drop a GIF 🎭" rows="2" style="width:100%;padding:12px 16px;background:transparent;border:none;border-bottom:1px solid rgba(255,255,255,0.07);color:#F0EEF8;font-family:inherit;font-size:14px;outline:none;resize:none;line-height:1.5"></textarea>
      <div style="display:flex;border-bottom:1px solid rgba(255,255,255,0.07)">
        <button onclick="toggleGif()" style="flex:0;padding:12px 16px;background:transparent;border:none;color:#6E6B80;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap">🎭 GIF</button>
        <div id="gif-selected" style="flex:1;padding:12px 8px;font-size:12px;color:#6E6B80;display:flex;align-items:center;gap:8px;overflow:hidden">
          <span id="gif-preview-text" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></span>
          <button id="gif-clear" onclick="clearGif()" style="display:none;background:rgba(255,68,68,0.15);border:none;color:#FF6B6B;font-size:11px;padding:2px 8px;border-radius:6px;cursor:pointer;flex-shrink:0">✕</button>
        </div>
      </div>
      <!-- GIF search panel -->
      <div id="gif-panel" style="display:none;border-bottom:1px solid rgba(255,255,255,0.07)">
        <div style="padding:10px 12px;display:flex;gap:8px">
          <input id="gif-search" type="text" placeholder="Search GIFs... e.g. money, thanks, funny" style="flex:1;padding:9px 12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#F0EEF8;font-family:inherit;font-size:13px;outline:none" oninput="searchGifs(this.value)"/>
        </div>
        <div id="gif-results" style="display:flex;flex-wrap:wrap;gap:4px;padding:0 12px 10px;max-height:200px;overflow-y:auto"></div>
      </div>
      <button id="csub" onclick="postC()" style="width:100%;padding:13px;background:rgba(48,209,88,0.1);border:none;color:#30D158;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer">💬 Post Comment</button>
    </div>
  </div>

  <input type="hidden" id="pd" value="${profileB64}">

  <div id="pmod" style="display:none;position:fixed;inset:0;z-index:999">
    <div onclick="closePay()" style="position:absolute;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(8px)"></div>
    <div style="position:absolute;bottom:0;left:0;right:0;display:flex;justify-content:center">
      <div style="background:#0C0C12;border:1px solid rgba(255,255,255,0.1);border-radius:24px 24px 0 0;padding:24px 20px 52px;width:100%;max-width:500px">
        <div style="width:36px;height:4px;background:rgba(255,255,255,0.12);border-radius:2px;margin:0 auto 20px"></div>
        <div style="font-size:18px;font-weight:700;margin-bottom:4px">Pay <span id="pname"></span></div>
        <div style="font-size:40px;font-weight:800;color:#30D158;margin-bottom:20px" id="pamt">$0.00</div>
        <div id="pmethods" style="margin-bottom:12px"></div>
        <button id="pmark" style="width:100%;padding:14px;background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#9896A8;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:8px">✓ Mark as paid (other method)</button>
        <button onclick="closePay()" style="width:100%;padding:12px;background:transparent;border:none;color:#6E6B80;font-family:inherit;font-size:13px;cursor:pointer">I'll pay later</button>
      </div>
    </div>
  </div>

  <script>
    const BID = '${billId}';

    function showPay(btn) {
      const pid = btn.dataset.pid, name = btn.dataset.name, amount = btn.dataset.amount;
      let p = {};
      try { p = JSON.parse(atob(document.getElementById('pd').value||'')); } catch(e){}
      document.getElementById('pname').textContent = name;
      document.getElementById('pamt').textContent = '$' + parseFloat(amount).toFixed(2);
      const amt = parseFloat(amount).toFixed(2);
      const mc = document.getElementById('pmethods');
      mc.innerHTML = '';
      let n = 0;

      function row(bg, icon, title, sub, href, copy, method) {
        const el = document.createElement(href?'a':'button');
        el.className = 'pm-row';
        if(href){ el.href=href; el.target='_blank'; }
        if(copy){ el.addEventListener('click',function(e){ e.preventDefault(); navigator.clipboard.writeText(copy).then(()=>toast('Copied: '+copy)).catch(()=>prompt('Copy:',copy)); }); }
        // When any payment method is tapped, record it
        el.addEventListener('click', function() {
          setTimeout(() => markPaid(pid, name, method), 300);
        });
        el.innerHTML = '<div class="pm-icon" style="background:'+bg+'">'+icon+'</div><div class="pm-info"><b>'+title+'</b><span>'+sub+'</span></div><span style="color:#6E6B80;font-size:16px">→</span>';
        mc.appendChild(el);
        n++;
      }

      if(p.venmo&&p.venmo.trim()){const h='@'+p.venmo.replace('@','');row('#008CFF','V','Venmo',h+' · $'+amt,'venmo://paycharge?txn=pay&recipients='+p.venmo.replace('@','')+'&amount='+amt+'&note=Bill',null,'Venmo');}
      if(p.cashapp&&p.cashapp.trim()){const tag=p.cashapp.replace('$','');const t='$'+tag;row('#00D632','$','Cash App',t+' · $'+amt,'https://cash.app/$'+tag+'/'+amt,null,'Cash App');}
      if(p.zelle&&p.zelle.trim()){row('#6D1ED4','Z','Zelle',p.zelle+' · tap to copy',null,p.zelle,'Zelle');}
      if(p.applepay&&p.applepay.trim()){
        const ap=p.applepay.trim();
        const dig=ap.replace(/\D/g,'');
        const e164=dig.length===10?'1'+dig:(dig.length===11&&dig[0]==='1'?dig:dig);
        if(dig.length>=7){
          const sms='sms:+'+e164+'&body='+encodeURIComponent('Sending $'+amt+' via Apple Pay');
          const el=document.createElement('a');
          el.className='pm-row'; el.href=sms;
          el.addEventListener('click', function(){ setTimeout(() => markPaid(pid, name, 'Apple Pay'), 300); });
          el.innerHTML='<div class="pm-icon" style="background:#222;border:1px solid #444">Pay</div><div class="pm-info"><b>Apple Pay</b><span>Opens iMessage to '+ap+'</span></div><span style="color:#6E6B80;font-size:16px">→</span>';
          mc.appendChild(el); n++;
        } else { row('#222','Pay','Apple Pay',ap+' · tap to copy',null,ap,'Apple Pay'); }
      }
      if(n===0){mc.innerHTML='<p style="color:#6E6B80;text-align:center;padding:16px 0;font-size:13px">No payment methods set up yet.</p>';}
      document.getElementById('pmark').onclick=function(){ markPaid(pid, name, 'Other'); };
      document.getElementById('pmod').style.display='block';
    }

    function closePay(){ document.getElementById('pmod').style.display='none'; }

    async function markPaid(pid, name, method) {
      try{
        const r=await fetch('/bill/'+BID+'/mark-paid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({participantId:pid, name, payment_method: method||null})});
        const d=await r.json();
        if(d.success){
          closePay();
          document.getElementById('paybtn-'+pid)?.remove();
          const s=document.getElementById('pstatus-'+pid);
          if(s) s.textContent='✅ Paid' + (method && method !== 'Other' ? ' via '+method : '');
          toast('✅ Marked as paid!');
        }
      }catch(e){alert('Error. Try again.');}
    }

    // ── GIF ──
    let selectedGif = null;
    let gifTimer = null;

    function toggleGif() {
      const panel = document.getElementById('gif-panel');
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      if (panel.style.display === 'block') {
        document.getElementById('gif-search').focus();
        searchGifs('reaction');
      }
    }

    function clearGif() {
      selectedGif = null;
      const wrap = document.getElementById('gif-preview-wrap');
      if (wrap) { wrap.innerHTML = ''; wrap.style.display = 'none'; }
      document.getElementById('gif-preview-text').textContent = '';
      document.getElementById('gif-clear').style.display = 'none';
      document.getElementById('gif-panel').style.display = 'none';
    }

    async function searchGifs(q) {
      if (!q || q.length < 2) return;
      clearTimeout(gifTimer);
      const container = document.getElementById('gif-results');
      container.innerHTML = '<div style="color:#6E6B80;font-size:12px;padding:8px;width:100%">Searching...</div>';
      gifTimer = setTimeout(async () => {
        try {
          const res = await fetch('/gif-search?q='+encodeURIComponent(q));
          const data = await res.json();
          container.innerHTML = '';
          if (!data.gifs || data.gifs.length === 0) {
            container.innerHTML = '<div style="color:#6E6B80;font-size:12px;padding:8px;width:100%">No GIFs found — try a different search</div>';
            return;
          }
          data.gifs.forEach(g => {
            if (!g.preview) return;
            const img = document.createElement('img');
            img.src = g.preview;
            img.alt = g.title;
            img.style.cssText = 'width:calc(33.3% - 3px);border-radius:6px;cursor:pointer;object-fit:cover;height:80px;flex-shrink:0';
            img.addEventListener('click', () => {
              selectedGif = g.full || g.preview;
              const wrap = document.getElementById('gif-preview-wrap');
              if (wrap) {
                wrap.style.display = 'block';
                wrap.innerHTML = '<div style="position:relative;display:inline-block;margin:8px 0 4px">'
                  + '<img src="' + (g.full || g.preview) + '" style="max-width:100%;max-height:160px;border-radius:8px;display:block">'
                  + '<button onclick="clearGif()" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.75);border:none;color:#fff;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center">×</button>'
                  + '</div>';
              }
              document.getElementById('gif-preview-text').textContent = '🎭 GIF selected';
              document.getElementById('gif-clear').style.display = 'inline';
              document.getElementById('gif-panel').style.display = 'none';
              toast('GIF selected ✓');
            });
            container.appendChild(img);
          });
        } catch(e) {
          container.innerHTML = '<div style="color:#FF6B6B;font-size:12px;padding:8px;width:100%">Error loading GIFs</div>';
        }
      }, 400);
    }

        async function loadC(){
      try{
        const r=await fetch('/bill/'+BID+'/comments');
        const d=await r.json();
        const comments=d.comments||[];
        const list=document.getElementById('clist');
        const none=document.getElementById('no-c');
        if(comments.length===0){if(none)none.style.display='block';return;}
        if(none)none.style.display='none';
        list.innerHTML=comments.map(c=>{
          const dt=new Date(c.created_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
          const gifHtml=c.gif_url?'<img src="'+c.gif_url+'" style="max-width:100%;border-radius:8px;margin-top:8px;display:block">':'';
          const bodyHtml=c.body?'<div style="font-size:14px;color:#9896A8;line-height:1.5">'+c.body+'</div>':'';
          return '<div style="background:#0C0C12;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:14px 16px">'
            +'<div style="display:flex;justify-content:space-between;margin-bottom:6px">'
            +'<span style="font-size:13px;font-weight:700">'+(c.name||'Anonymous')+'</span>'
            +'<span style="font-size:11px;color:#6E6B80">'+dt+'</span></div>'
            +bodyHtml+gifHtml+'</div>';
        }).join('');
      }catch(e){console.error('loadC error',e);}
    }

    async function postC(){
      const name=document.getElementById('cname').value.trim();
      const body=document.getElementById('cbody').value.trim();
      if(!body && !selectedGif){toast('Write something or pick a GIF first');return;}
      const btn=document.getElementById('csub');
      btn.textContent='Posting...';btn.disabled=true;
      try{
        const r=await fetch('/bill/'+BID+'/comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name||'Anonymous',body:body||'',gif_url:selectedGif||null})});
        const d=await r.json();
        if(d.success){document.getElementById('cbody').value='';document.getElementById('cname').value='';clearGif();await loadC();toast('✅ Posted!');}
        else toast('Error: '+(d.error||'try again'));
      }catch(e){toast('Network error');}
      finally{btn.textContent='💬 Post Comment';btn.disabled=false;}
    }

    function toast(msg){
      let t=document.getElementById('_t');
      if(!t){t=document.createElement('div');t.id='_t';t.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1A1A24;border:1px solid rgba(48,209,88,0.3);color:#30D158;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:600;z-index:9999;white-space:nowrap;pointer-events:none;transition:opacity 0.3s';document.body.appendChild(t);}
      t.textContent=msg;t.style.opacity='1';
      clearTimeout(t._t);t._t=setTimeout(()=>t.style.opacity='0',3000);
    }

    loadC();
  </script>
</body>
</html>`;

  res.send(html);
});


// ─── TRIP HUB ─────────────────────────────────────────────────────────────────

app.get('/trip/:tripId', async (req, res) => {
  const { tripId } = req.params;
  const token = req.query.t;
  const { data: trip } = await supabase.from('trips').select('*').eq('id', tripId).single();
  if (!trip) return res.status(404).send('<h1>Trip not found</h1>');
  if (trip.share_token && token !== trip.share_token) {
    return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Helvetica,sans-serif;background:#06060A;color:#F0EEF8;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px}</style></head><body><div><div style="font-size:48px">🔒</div><h2>Private Trip</h2><p style="color:#6E6B80">Ask the trip creator to share the correct link.</p></div></body></html>');
  }
  const { data: receipts } = await supabase.from('trip_receipts').select('*').eq('trip_id', tripId).order('created_at', { ascending: false });
  const people = Array.isArray(trip.people) ? trip.people : JSON.parse(trip.people || '[]');
  const totals = {};
  people.forEach(p => { totals[p.toLowerCase()] = 0; });
  (receipts || []).forEach(r => {
    try {
      const splits = typeof r.splits === 'string' ? JSON.parse(r.splits) : (r.splits || {});
      Object.entries(splits).forEach(([person, amt]) => { const key = person.toLowerCase(); if (totals[key] !== undefined) totals[key] += parseFloat(amt) || 0; });
    } catch(e) {}
  });
  const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0);
  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `https://raven-backend-production-fb1f.up.railway.app`;

  const receiptRows = (receipts || []).map(r => {
    let splitsHtml = '';
    try { const sp = typeof r.splits === 'string' ? JSON.parse(r.splits) : (r.splits||{}); splitsHtml = Object.entries(sp).map(([p,a]) => `<span style="font-size:11px;color:#6E6B80">${p}: $${parseFloat(a).toFixed(2)}</span>`).join(' · '); } catch(e) {}
    return `<div style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.05)"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-weight:600">${r.name||'Receipt'}</span><span style="color:#30D158;font-weight:700">$${parseFloat(r.total||0).toFixed(2)}</span></div><div style="font-size:12px;color:#6E6B80;margin-bottom:4px">${new Date(r.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</div>${splitsHtml?'<div style="margin-top:4px">'+splitsHtml+'</div>':''}</div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <title>✈️ ${trip.name} — RAVEN Trip Hub</title>
  <meta property="og:title" content="✈️ ${trip.name} — RAVEN Trip Hub" />
  <meta property="og:description" content="Add receipts and track who owes what on this trip" />
  <meta property="og:image" content="https://work46121-gif.github.io/raven-site/raven-hero.png" />
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;background:#06060A;color:#F0EEF8;min-height:100vh;padding-bottom:120px}
    .hdr{position:sticky;top:0;background:rgba(6,6,10,0.95);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,0.07);padding:0 20px;z-index:100}
    .hdr-i{max-width:520px;margin:0 auto;height:56px;display:flex;align-items:center;justify-content:space-between}
    .card{background:#0C0C12;border:1px solid rgba(255,255,255,0.07);border-radius:16px;overflow:hidden}
    .section{max-width:520px;margin:20px auto 0;padding:0 20px}
    .lbl{font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6E6B80;font-weight:600;margin-bottom:10px}
    .btn-g{width:100%;padding:14px;background:#30D158;color:#000;border:none;border-radius:12px;font-family:inherit;font-size:15px;font-weight:700;cursor:pointer}
    .btn-s{width:100%;padding:13px;background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#9896A8;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer}
    input{background:#13131A;border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#F0EEF8;font-family:inherit;font-size:14px;outline:none;padding:12px 16px;width:100%;transition:border-color 0.2s}
    input:focus{border-color:#7C3AED}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <div class="hdr"><div class="hdr-i">
    <a href="https://work46121-gif.github.io/raven-site/" style="text-decoration:none;color:inherit;font-size:18px;font-weight:900;letter-spacing:0.12em">🪶 RAVEN</a>
    <div style="font-size:11px;color:#6E6B80;background:rgba(255,255,255,0.05);padding:4px 10px;border-radius:20px;font-weight:600">${tripId}</div>
  </div></div>

  <div class="section" style="margin-top:24px">
    <div style="font-size:28px;font-weight:800;margin-bottom:4px">✈️ ${trip.name}</div>
    <div style="font-size:13px;color:#6E6B80">${people.length} people · ${(receipts||[]).length} receipts · $${grandTotal.toFixed(2)} total so far</div>
  </div>

  <div class="section" style="margin-top:20px">
    <div class="lbl">Who Owes What</div>
    <div class="card">
      ${people.map(p => `<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.05)"><div style="display:flex;align-items:center;gap:10px"><div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7C3AED,#30D158);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700">${p[0].toUpperCase()}</div><span style="font-weight:600">${p}</span></div><span style="font-size:18px;font-weight:700;color:#30D158;font-family:monospace">$${(totals[p.toLowerCase()]||0).toFixed(2)}</span></div>`).join('')}
      <div style="display:flex;justify-content:space-between;padding:14px 16px;font-weight:700"><span>Grand Total</span><span style="color:#30D158;font-family:monospace">$${grandTotal.toFixed(2)}</span></div>
    </div>
  </div>

  <div class="section" style="margin-top:20px">
    <button class="btn-g" id="add-btn" onclick="document.getElementById('add-panel').style.display='block';this.style.display='none'">📸 Add a Receipt</button>
  </div>

  <div id="add-panel" style="display:none">
    <div class="section" style="margin-top:16px">
      <div class="lbl">New Receipt</div>
      <div class="card" style="padding:20px;display:flex;flex-direction:column;gap:14px">
        <div><div style="font-size:12px;color:#6E6B80;margin-bottom:6px">Receipt Name</div><input id="r-name" type="text" placeholder="e.g. Dinner at Casa Marina"></div>
        <div>
          <div style="font-size:12px;color:#6E6B80;margin-bottom:8px">Photo — AI will scan it automatically</div>
          <div id="r-drop" style="border:2px dashed rgba(48,209,88,0.3);border-radius:12px;padding:20px;text-align:center;cursor:pointer" onclick="document.getElementById('r-file').click()">
            <div id="r-empty" style="color:#6E6B80;font-size:13px">📸 Tap to upload receipt</div>
            <img id="r-preview" style="display:none;max-width:100%;border-radius:8px;max-height:200px;object-fit:contain">
          </div>
          <input id="r-file" type="file" accept="image/*" style="display:none" onchange="tripPhoto(this)">
        </div>
        <div id="r-scan-status" style="display:none"></div>
        <div>
          <div style="font-size:12px;color:#6E6B80;margin-bottom:8px">Split type</div>
          <div style="display:flex;gap:8px">
            <button id="r-btn-e" onclick="setSplit('even')" style="flex:1;padding:10px;border-radius:8px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;background:rgba(48,209,88,0.15);border:1px solid rgba(48,209,88,0.3);color:#30D158">⚖️ Even</button>
            <button id="r-btn-i" onclick="setSplit('itemized')" style="flex:1;padding:10px;border-radius:8px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;background:#1A1A24;border:1px solid rgba(255,255,255,0.1);color:#9896A8">📋 Itemized</button>
          </div>
        </div>
        <div id="r-even-sec">
          <div style="font-size:12px;color:#6E6B80;margin-bottom:6px">Total Amount</div>
          <div style="position:relative"><span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#6E6B80">$</span><input id="r-total" type="number" placeholder="0.00" step="0.01" style="padding-left:28px" oninput="updateEven()"></div>
          <div id="r-even-prev" style="margin-top:10px;display:none">${people.map(p=>`<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px"><span style="color:#9896A8">${p}</span><span id="ep-${p.toLowerCase().replace(/\s+/g,'_')}" style="color:#30D158">$0.00</span></div>`).join('')}</div>
        </div>
        <div id="r-item-sec" style="display:none">
          <div id="r-items-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px"></div>
          <div style="display:flex;gap:8px">
            <input id="r-iname" type="text" placeholder="Item" style="flex:1">
            <div style="position:relative;display:flex;align-items:center"><span style="position:absolute;left:10px;color:#6E6B80;font-size:13px">$</span><input id="r-iprice" type="number" placeholder="0.00" step="0.01" style="width:80px;padding-left:24px"></div>
            <button onclick="addItem()" style="padding:0 14px;background:rgba(124,58,237,0.15);border:1px solid rgba(124,58,237,0.3);border-radius:8px;color:#C084FC;font-family:inherit;font-weight:700;cursor:pointer;font-size:18px">+</button>
          </div>
        </div>
        <div style="display:flex;gap:10px">
          <button class="btn-s" style="flex:1" onclick="document.getElementById('add-panel').style.display='none';document.getElementById('add-btn').style.display='block'">Cancel</button>
          <button class="btn-g" id="r-save" onclick="saveReceipt()" style="flex:2">Save Receipt</button>
        </div>
      </div>
    </div>
  </div>

  <div class="section" style="margin-top:20px">
    <div class="lbl">All Receipts (${(receipts||[]).length})</div>
    ${(receipts||[]).length === 0
      ? '<div style="color:#6E6B80;font-size:13px;text-align:center;padding:24px">No receipts yet — be the first to add one! 🧾</div>'
      : '<div class="card">' + receiptRows + '</div>'}
  </div>

  <script>
    const TRIP_ID='${tripId}',TRIP_TOKEN='${trip.share_token}',PEOPLE=${JSON.stringify(people)},BACKEND='${baseUrl}';
    let splitType='even',tripItems=[],imgBase64=null;

    function setSplit(t){
      splitType=t;
      document.getElementById('r-even-sec').style.display=t==='even'?'block':'none';
      document.getElementById('r-item-sec').style.display=t==='itemized'?'block':'none';
      const be=document.getElementById('r-btn-e'),bi=document.getElementById('r-btn-i');
      be.style.background=t==='even'?'rgba(48,209,88,0.15)':'#1A1A24';be.style.borderColor=t==='even'?'rgba(48,209,88,0.3)':'rgba(255,255,255,0.1)';be.style.color=t==='even'?'#30D158':'#9896A8';
      bi.style.background=t==='itemized'?'rgba(124,58,237,0.15)':'#1A1A24';bi.style.borderColor=t==='itemized'?'rgba(124,58,237,0.3)':'rgba(255,255,255,0.1)';bi.style.color=t==='itemized'?'#C084FC':'#9896A8';
    }

    function updateEven(){
      const v=parseFloat(document.getElementById('r-total').value)||0,per=v/PEOPLE.length;
      document.getElementById('r-even-prev').style.display=v>0?'block':'none';
      PEOPLE.forEach(p=>{const el=document.getElementById('ep-'+p.toLowerCase().replace(/\\s+/g,'_'));if(el)el.textContent='$'+per.toFixed(2);});
    }

    function addItem(){
      const n=document.getElementById('r-iname').value.trim(),p=parseFloat(document.getElementById('r-iprice').value);
      if(!n||isNaN(p)||p<=0)return;
      tripItems.push({id:Date.now(),name:n,price:p,assignees:[]});
      document.getElementById('r-iname').value='';document.getElementById('r-iprice').value='';
      renderItems();
    }

    function renderItems(){
      document.getElementById('r-items-list').innerHTML=tripItems.map(item=>
        '<div style="background:#1A1A24;border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:10px 12px">'
        +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
        +'<span style="flex:1;font-size:13px;font-weight:500">'+item.name+'</span>'
        +'<span style="font-family:monospace;font-size:13px;color:#9896A8">$'+item.price.toFixed(2)+'</span>'
        +'<button onclick="tripItems=tripItems.filter(i=>i.id!=='+item.id+');renderItems()" style="background:none;border:none;color:#6E6B80;cursor:pointer;font-size:16px">×</button>'
        +'</div><div style="display:flex;gap:6px;flex-wrap:wrap">'
        +PEOPLE.map(p=>{const on=item.assignees.includes(p);return '<button onclick="toggleAssign('+item.id+',\''+p.replace(/\'/g,"\\'")+'\')" style="padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;background:'+(on?'rgba(48,209,88,0.15)':'rgba(255,255,255,0.05)')+';border:1px solid '+(on?'rgba(48,209,88,0.3)':'rgba(255,255,255,0.1)')+';color:'+(on?'#30D158':'#9896A8')+'">'+(on?'✓ ':'')+p+'</button>';}).join('')
        +'</div></div>'
      ).join('');
    }

    function toggleAssign(id,p){const item=tripItems.find(i=>i.id===id);if(!item)return;if(item.assignees.includes(p))item.assignees=item.assignees.filter(a=>a!==p);else item.assignees.push(p);renderItems();}

    async function tripPhoto(input){
      const file=input.files[0];if(!file)return;
      const reader=new FileReader();
      reader.onload=async e=>{
        document.getElementById('r-preview').src=e.target.result;document.getElementById('r-preview').style.display='block';document.getElementById('r-empty').style.display='none';
        const resized=await new Promise(res=>{const i=new Image();i.onload=function(){let{width:w,height:h}=i;if(w>1600||h>1600){if(w>h){h=Math.round(h*1600/w);w=1600;}else{w=Math.round(w*1600/h);h=1600;}}const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(i,0,0,w,h);res(c.toDataURL('image/jpeg',0.88));};i.src=e.target.result;});
        imgBase64=resized.split(',')[1];
        const st=document.getElementById('r-scan-status');st.style.display='block';
        st.innerHTML='<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);border-radius:8px"><div style="width:16px;height:16px;border:2px solid rgba(124,58,237,0.3);border-top-color:#A855F7;border-radius:50%;animation:spin 0.8s linear infinite"></div><span style="font-size:13px;color:#C084FC;font-weight:600">Scanning receipt...</span></div>';
        try{
          const r=await fetch(BACKEND+'/demo/scan-receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:imgBase64,mediaType:file.type||'image/jpeg'})});
          const d=await r.json();
          if(d.success&&d.items?.length){
            if(!document.getElementById('r-name').value&&d.bill_name)document.getElementById('r-name').value=d.bill_name;
            const tot=d.total||d.items.reduce((s,i)=>s+i.price,0);
            document.getElementById('r-total').value=tot.toFixed(2);updateEven();
            tripItems=d.items.map((item,idx)=>({id:Date.now()+idx,name:item.name,price:parseFloat(item.price)||0,assignees:[]}));
            setSplit('itemized');renderItems();
            st.innerHTML='<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(48,209,88,0.08);border:1px solid rgba(48,209,88,0.2);border-radius:8px"><span>✅</span><span style="font-size:13px;color:#30D158;font-weight:600">'+d.items.length+' items found! Assign who ordered what.</span></div>';
          }else throw new Error();
        }catch(e){st.innerHTML='<div style="padding:10px 14px;background:rgba(255,68,68,0.07);border:1px solid rgba(255,68,68,0.2);border-radius:8px;font-size:13px;color:#FF6B6B">Could not scan — enter total manually</div>';}
      };
      reader.readAsDataURL(file);
    }

    async function saveReceipt(){
      const name=document.getElementById('r-name').value.trim()||'Receipt';
      const btn=document.getElementById('r-save');btn.textContent='Saving...';btn.disabled=true;
      let total=0,splits={};
      if(splitType==='even'){
        total=parseFloat(document.getElementById('r-total').value)||0;
        if(total<=0){btn.textContent='Save Receipt';btn.disabled=false;alert('Enter a total amount');return;}
        const per=total/PEOPLE.length;PEOPLE.forEach(p=>{splits[p]=per;});
      }else{
        PEOPLE.forEach(p=>{splits[p]=0;});
        tripItems.forEach(item=>{const as=item.assignees.length>0?item.assignees:PEOPLE;const sh=item.price/as.length;as.forEach(p=>{splits[p]=(splits[p]||0)+sh;});total+=item.price;});
        if(total<=0){btn.textContent='Save Receipt';btn.disabled=false;alert('Add at least one item');return;}
      }
      try{
        const r=await fetch(BACKEND+'/trip/'+TRIP_ID+'/receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,total,splits,token:TRIP_TOKEN,items:splitType==='itemized'?tripItems:[]})});
        const d=await r.json();
        if(d.success){location.reload();}
        else{btn.textContent='Save Receipt';btn.disabled=false;alert('Error: '+(d.error||'try again'));}
      }catch(e){btn.textContent='Save Receipt';btn.disabled=false;alert('Network error');}
    }
  </script>
</body>
</html>`;
  res.send(html);
});

app.post('/trip/:tripId/receipt', async (req, res) => {
  try {
    const { tripId } = req.params;
    const { name, total, splits, token, items } = req.body;
    const { data: trip } = await supabase.from('trips').select('*').eq('id', tripId).single();
    if (!trip) return res.json({ success: false, error: 'Trip not found' });
    if (trip.share_token !== token) return res.json({ success: false, error: 'Invalid token' });
    await supabase.from('trip_receipts').insert({ trip_id: tripId, name: name||'Receipt', total: parseFloat(total)||0, splits: JSON.stringify(splits||{}), items: JSON.stringify(items||[]), created_at: new Date().toISOString() });
    const { data: all } = await supabase.from('trip_receipts').select('total').eq('trip_id', tripId);
    const newTotal = (all||[]).reduce((s,r) => s+parseFloat(r.total||0), 0);
    await supabase.from('trips').update({ total: newTotal, receipt_count: (all||[]).length }).eq('id', tripId);
    res.json({ success: true });
  } catch(err) { console.error('Trip receipt error:', err); res.json({ success: false, error: err.message }); }
});

// ─── GIF SEARCH PROXY ────────────────────────────────────────────────────────

app.get('/gif-search', async (req, res) => {
  const q = req.query.q || 'reaction';
  const giphyKey = process.env.GIPHY_API_KEY;
  if (!giphyKey) return res.json({ success: false, gifs: [], error: 'GIPHY_API_KEY not set' });
  try {
    const response = await fetch('https://api.giphy.com/v1/gifs/search?api_key='+giphyKey+'&q='+encodeURIComponent(q)+'&limit=12&rating=g&lang=en');
    const data = await response.json();
    const gifs = (data.data || []).map(g => ({
      id: g.id,
      title: g.title,
      preview: g.images?.fixed_height_small?.url || g.images?.preview_gif?.url || '',
      full: g.images?.fixed_height?.url || g.images?.downsized?.url || ''
    })).filter(g => g.preview);
    res.json({ success: true, gifs });
  } catch(err) {
    console.error('Giphy error:', err.message);
    res.json({ success: false, gifs: [] });
  }
});

// ─── BILL COMMENTS ────────────────────────────────────────────────────────────

app.get('/bill/:billId/comments', async (req, res) => {
  try {
    const { billId } = req.params;
    const { data } = await supabase.from('bill_comments').select('*').eq('bill_id', billId).order('created_at', { ascending: true });
    res.json({ success: true, comments: data || [] });
  } catch(err) { res.json({ success: false, comments: [] }); }
});

app.post('/bill/:billId/comments', async (req, res) => {
  try {
    const { billId } = req.params;
    const { name, body, gif_url } = req.body;
    if (!body?.trim() && !gif_url) return res.json({ success: false, error: 'Empty comment' });
    const { error: ie } = await supabase.from('bill_comments').insert({ bill_id: billId, name: name?.trim()||'Anonymous', body: body?.trim()||'', gif_url: gif_url||null, created_at: new Date().toISOString() });
    if (ie) return res.json({ success: false, error: ie.message });
    const { data: bill } = await supabase.from('bills').select('name,creator_phone').eq('id', billId).single();
    if (bill?.creator_phone && !bill.creator_phone.includes('@')) {
      const msg = body?.trim()
        ? `🪶 RAVEN — New comment on ${bill.name}:\n"${body.trim().substring(0,100)}"\n— ${name||'Anonymous'}`
        : `🪶 RAVEN — ${name||'Anonymous'} sent a GIF on ${bill.name}`;
      await sendSMS(bill.creator_phone, msg);
    }
    res.json({ success: true });
  } catch(err) { res.json({ success: false, error: err.message }); }
});

app.post('/bill/:billId/mark-paid', async (req, res) => {
  try {
    const { billId } = req.params;
    const { participantId, name, payment_method } = req.body;
    const { data: bill } = await supabase.from('bills').select('*').eq('id', billId).single();
    if (!bill) return res.json({ success: false, error: 'Bill not found' });
    await supabase.from('participants').update({
      paid: true,
      paid_at: new Date().toISOString(),
      ...(payment_method ? { payment_method } : {})
    }).eq('id', participantId);
    if (bill.creator_phone && !bill.creator_phone.includes('@')) {
      const methodStr = payment_method ? ` via ${payment_method}` : '';
      await sendSMS(bill.creator_phone, `🪶 RAVEN — ${name} marked as paid${methodStr} for ${bill.name}!`);
    }
    res.json({ success: true });
  } catch(err) { res.json({ success: false, error: err.message }); }
});

app.get('/test-bill/:billId', async (req, res) => {
  const { billId } = req.params;
  const b = await supabase.from('bills').select('id,name,creator_phone').eq('id', billId).single();
  const c = await supabase.from('bill_comments').select('*').eq('bill_id', billId);
  const pf = await supabase.from('profiles').select('first_name,venmo,cashapp,zelle,applepay').eq('email', b.data?.creator_phone).maybeSingle();
  const pt = await supabase.from('participants').select('*').eq('bill_id', billId);
  res.json({ bill: b.data, bill_err: b.error?.message, comments: c.data, profile: pf.data, profile_err: pf.error?.message, participants: pt.data });
});


app.get('/', (req, res) => {
  res.json({ status: 'RAVEN is live 🪶', version: '2.0.0', twilio: TWILIO_READY ? 'connected' : 'pending' });
});

// ─── WAITLIST ─────────────────────────────────────────────────────────────────
app.post('/waitlist', async (req, res) => {
  try {
    const { email, source } = req.body;
    if (!email || !email.includes('@')) return res.json({ success: false, error: 'Invalid email' });
    const { error } = await supabase.from('waitlist').upsert(
      { email: email.toLowerCase().trim(), source: source || 'website', created_at: new Date().toISOString() },
      { onConflict: 'email' }
    );
    if (error) console.error('Waitlist insert error:', error);
    res.json({ success: true });
  } catch(err) {
    console.error('Waitlist error:', err);
    res.json({ success: true }); // always return success to user
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🪶 RAVEN SMS server running on port ${PORT}`));
