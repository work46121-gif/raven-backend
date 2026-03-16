require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function getAnthropic() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

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
      model: 'claude-sonnet-4-6',
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
    const text = message.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error('Claude receipt parse error:', err);
    return null;
  }
}

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

  const participantItems = {};
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
      const amount = parseFloat(p.amount || 0);
      if (amount <= 0) return '';
      return '<div style="margin-top:6px;background:rgba(255,255,255,0.03);border-radius:8px;padding:8px 10px"><div style="display:flex;justify-content:space-between"><span style="font-size:11px;font-weight:700;color:#F0EEF8">Total</span><span style="font-size:12px;font-weight:700;color:#30D158;font-family:monospace">$' + amount.toFixed(2) + '</span></div></div>';
    }
    const tax = parseFloat(bill.tax || 0);
    const tip = parseFloat(bill.tip || 0);
    const shared = participantCount > 0 ? (tax + tip) / participantCount : 0;
    const itemsTotal = myItems.reduce((s, i) => s + i.price / i.splitWith, 0);
    let rows = myItems.map(i => {
      const share = (i.price / i.splitWith).toFixed(2);
      const split = i.splitWith > 1 ? ` <span style="color:#9896A8;font-size:10px">(÷${i.splitWith})</span>` : '';
      return `<div style="display:flex;justify-content:space-between;padding:3px 0"><span style="font-size:11px;color:#6E6B80">${i.name}${split}</span><span style="font-size:11px;color:#9896A8;font-family:monospace">$${share}</span></div>`;
    }).join('');
    let shared_rows = '';
    if (tax) shared_rows += `<div style="display:flex;justify-content:space-between;padding:2px 0"><span style="font-size:11px;color:#6E6B80">Tax (split)</span><span style="font-size:11px;color:#9896A8;font-family:monospace">$${(tax / participantCount).toFixed(2)}</span></div>`;
    if (tip) shared_rows += `<div style="display:flex;justify-content:space-between;padding:2px 0"><span style="font-size:11px;color:#6E6B80">Tip (split)</span><span style="font-size:11px;color:#9896A8;font-family:monospace">$${(tip / participantCount).toFixed(2)}</span></div>`;
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
      <div style="display:flex;align-items:center;border-bottom:1px solid rgba(255,255,255,0.07)">
        <input id="cname" type="text" placeholder="Your name" style="flex:1;padding:12px 16px;background:transparent;border:none;color:#F0EEF8;font-family:inherit;font-size:14px;outline:none"/>
      </div>
      <div id="gif-preview-wrap" style="display:none;padding:0 12px;"></div>
      <textarea id="cbody" placeholder="Add a comment... or just drop a GIF 🎭" rows="2" style="width:100%;padding:12px 16px;background:transparent;border:none;border-bottom:1px solid rgba(255,255,255,0.07);color:#F0EEF8;font-family:inherit;font-size:14px;outline:none;resize:none;line-height:1.5"></textarea>
      <div style="display:flex;border-bottom:1px solid rgba(255,255,255,0.07)">
        <button onclick="toggleGif()" style="flex:0;padding:12px 16px;background:transparent;border:none;color:#6E6B80;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;white-space:nowrap">🎭 GIF</button>
        <div id="gif-selected" style="flex:1;padding:12px 8px;font-size:12px;color:#6E6B80;display:flex;align-items:center;gap:8px;overflow:hidden">
          <span id="gif-preview-text" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></span>
          <button id="gif-clear" onclick="clearGif()" style="display:none;background:rgba(255,68,68,0.15);border:none;color:#FF6B6B;font-size:11px;padding:2px 8px;border-radius:6px;cursor:pointer;flex-shrink:0">✕</button>
        </div>
      </div>
      <div id="gif-panel" style="display:none;border-bottom:1px solid rgba(255,255,255,0.07)">
        <div style="padding:10px 12px;display:flex;gap:8px">
          <input id="gif-search" type="text" placeholder="Search GIFs..." style="flex:1;padding:9px 12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#F0EEF8;font-family:inherit;font-size:13px;outline:none" oninput="searchGifs(this.value)"/>
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
    const BID = ${JSON.stringify(billId)};
    let selectedGif = null;
    let gifTimer = null;

    // ── AUTO-FILL NAME from URL param or localStorage ──
    (function(){
      try {
        const urlName = new URLSearchParams(window.location.search).get('name');
        if(urlName){ const el=document.getElementById('cname'); if(el){el.value=decodeURIComponent(urlName);el.style.color='#9896A8';} return; }
        const sn = sessionStorage.getItem('bill_commenter_name');
        if(sn){ const el=document.getElementById('cname'); if(el){el.value=sn;el.style.color='#9896A8';} return; }
        const profile = JSON.parse(localStorage.getItem('raven_profile')||'{}');
        if(profile.first_name){ const el=document.getElementById('cname'); if(el){el.value=profile.first_name;el.style.color='#9896A8';} }
      } catch(e){}
    })();

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
        el.addEventListener('click', function() { setTimeout(() => markPaid(pid, name, method), 300); });
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

    function toggleGif() {
      const panel = document.getElementById('gif-panel');
      const isOpen = panel.style.display === 'block';
      panel.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) {
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
            container.innerHTML = '<div style="color:#6E6B80;font-size:12px;padding:8px;width:100%">No GIFs found</div>';
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
      if(name) sessionStorage.setItem('bill_commenter_name', name);
      const btn=document.getElementById('csub');
      btn.textContent='Posting...';btn.disabled=true;
      try{
        const r=await fetch('/bill/'+BID+'/comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name||'Anonymous',body:body||'',gif_url:selectedGif||null})});
        const d=await r.json();
        if(d.success){document.getElementById('cbody').value='';clearGif();await loadC();toast('✅ Posted!');}
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
  if (!trip) return res.status(404).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:sans-serif;background:#06060A;color:#F0EEF8;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center}</style></head><body><div><div style="font-size:52px">🪶</div><h2>Trip Not Found</h2></div></body></html>');

  let inviteToken = trip.invite_token;
  if (!inviteToken) {
    inviteToken = Array.from({length:16}, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random()*36)]).join('');
    await supabase.from('trips').update({ invite_token: inviteToken }).eq('id', tripId);
    trip.invite_token = inviteToken;
  }

  const validInvite = token === trip.invite_token;
  const validShare  = token === trip.share_token;

  if (!validShare && !validInvite) {
    return res.status(403).send('<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:sans-serif;background:#06060A;color:#F0EEF8;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center}</style></head><body><div><div style="font-size:52px">🔒</div><h2>Private Trip</h2><p style="color:#6E6B80">Ask the trip creator to share the correct link.</p></div></body></html>');
  }

  // Invite-only link → show join page
  if (validInvite && !validShare) {
    const invBaseUrl = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `https://raven-backend-production-fb1f.up.railway.app`;
    const ogImage = trip.cover_image
      ? `${invBaseUrl}/trip/${tripId}/cover-image`
      : 'https://work46121-gif.github.io/raven-site/raven-hero.png';
    const coverImgHTML = trip.cover_image
      ? `<div style="width:100%;height:160px;border-radius:20px;overflow:hidden;margin-bottom:24px;border:1px solid rgba(255,255,255,0.1)"><img src="${ogImage}" style="width:100%;height:100%;object-fit:cover"></div>`
      : '<div style="font-size:52px;margin-bottom:16px">✈️</div>';
    const peopleArr = Array.isArray(trip.people) ? trip.people : JSON.parse(trip.people || '[]');
    const invEsc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Join ${invEsc(trip.name)} — RAVEN</title>
<meta property="og:title" content="✈️ You're invited to join ${invEsc(trip.name)}">
<meta property="og:description" content="${peopleArr.length} people on this trip · Tap to join on RAVEN">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="800">
<meta property="og:image:height" content="400">
<meta property="og:url" content="${invBaseUrl}/trip/${tripId}?t=${trip.invite_token}&invite=1">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="✈️ Join ${invEsc(trip.name)} on RAVEN">
<meta name="twitter:description" content="${peopleArr.length} people · Tap to join">
<meta name="twitter:image" content="${ogImage}">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#06060A;color:#F0EEF8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}</style>
</head>
<body>
<div style="max-width:400px;width:100%;position:relative;z-index:1">
  ${coverImgHTML}
  <div style="font-size:30px;font-weight:800;margin-bottom:8px">${invEsc(trip.name)}</div>
  <div style="font-size:14px;color:#6E6B80;margin-bottom:8px">${peopleArr.length} people already on this trip</div>
  <div style="font-size:14px;color:#6E6B80;margin-bottom:32px">You've been invited to join this trip hub on RAVEN</div>
  <div style="background:#0C0C12;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:24px">
    <a href="https://work46121-gif.github.io/raven-site/dashboard.html?join_trip=${tripId}&join_token=${trip.invite_token}" style="display:block;width:100%;padding:15px;background:#30D158;color:#000;border-radius:12px;font-size:15px;font-weight:800;text-decoration:none;margin-bottom:10px">🪶 Create Account &amp; Join Trip</a>
    <a href="https://work46121-gif.github.io/raven-site/dashboard.html?join_trip=${tripId}&join_token=${trip.invite_token}&signin=1" style="display:block;width:100%;padding:13px;background:transparent;border:1px solid rgba(255,255,255,0.12);color:#9896A8;border-radius:12px;font-size:14px;font-weight:600;text-decoration:none">Already have an account? Sign In</a>
  </div>
  <div style="margin-top:20px;font-size:11px;color:#6E6B80">Powered by <b style="color:#C084FC">RAVEN</b> — Scan. Share. Settle.</div>
</div>
</body>
</html>`);
  }

  const { data: receipts } = await supabase.from('trip_receipts').select('*').eq('trip_id', tripId).order('created_at', { ascending: false });
  const { data: comments } = await supabase.from('trip_comments').select('*').eq('trip_id', tripId).order('created_at', { ascending: true });
  const people = Array.isArray(trip.people) ? trip.people : JSON.parse(trip.people || '[]');

  // Fetch payment profiles for all trip members
  let memberPayProfiles = {}; // { "Name": { venmo, cashapp, zelle, applepay } }
  try {
    // Strategy 1: use member_emails stored on trip
    let memberEmails = [];
    try { memberEmails = Array.isArray(trip.member_emails) ? trip.member_emails : JSON.parse(trip.member_emails || '[]'); } catch(e) {}
    if (trip.creator_email) memberEmails = [...new Set([...memberEmails, trip.creator_email])];

    if (memberEmails.length > 0) {
      const { data: profilesByEmail } = await supabase.from('profiles').select('first_name,last_name,email,venmo,cashapp,zelle,applepay,raven_id,avatar_url,created_at').in('email', memberEmails);
      (profilesByEmail || []).forEach(p => {
        const name = p.first_name || '';
        if (name) memberPayProfiles[name] = { venmo: p.venmo||'', cashapp: p.cashapp||'', zelle: p.zelle||'', applepay: p.applepay||'', email: p.email||'', raven_id: p.raven_id||'', avatar_url: p.avatar_url||'', created_at: p.created_at||'' };
      });
    }

    // Strategy 2: try matching people array names against all profiles by first_name
    // (catches cases where member_emails isn't populated)
    if (people.length > 0) {
      const { data: profilesByName } = await supabase.from('profiles').select('first_name,venmo,cashapp,zelle,applepay,raven_id,avatar_url,created_at').in('first_name', people);
      (profilesByName || []).forEach(p => {
        if (p.first_name && !memberPayProfiles[p.first_name]) {
          memberPayProfiles[p.first_name] = { venmo: p.venmo||'', cashapp: p.cashapp||'', zelle: p.zelle||'', applepay: p.applepay||'', raven_id: p.raven_id||'', avatar_url: p.avatar_url||'', created_at: p.created_at||'' };
        }
      });
    }
  } catch(e) { console.error('Error fetching payment profiles:', e); }

  // Net owed per person: how much each person owes TO payers (excluding what they paid themselves)
  const totals = {};       // what each person owes overall
  const owedTo = {};       // { payerName: totalOwedToThem }
  people.forEach(p => { totals[p] = 0; owedTo[p] = 0; });
  (receipts || []).forEach(r => {
    try {
      const splits = typeof r.splits === 'string' ? JSON.parse(r.splits) : (r.splits || {});
      const payer = r.paid_by || '';
      Object.entries(splits).forEach(([person, amt]) => {
        const key = Object.keys(totals).find(k => k.toLowerCase() === person.toLowerCase());
        if (key === undefined) return;
        const amtNum = parseFloat(amt) || 0;
        // If this person IS the payer, they don't owe themselves — skip
        if (payer && key.toLowerCase() === payer.toLowerCase()) return;
        totals[key] += amtNum;
        // Track who they owe it to
        if (payer) {
          const payerKey = Object.keys(owedTo).find(k => k.toLowerCase() === payer.toLowerCase());
          if (payerKey) owedTo[payerKey] += amtNum;
        }
      });
    } catch(e) {}
  });
  const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0);

  const baseUrl   = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `https://raven-backend-production-fb1f.up.railway.app`;
  const tripUrl   = `${baseUrl}/trip/${tripId}?t=${trip.share_token}`;
  const inviteUrl = `${baseUrl}/trip/${tripId}?t=${trip.invite_token}&invite=1`;

  // Build server-side HTML snippets safely (no user content in JS template literals)
  const avatarColors = ['linear-gradient(135deg,#7C3AED,#A855F7)','linear-gradient(135deg,#E8633A,#FF6B35)','linear-gradient(135deg,#0EA5E9,#7C3AED)','linear-gradient(135deg,#30D158,#0EA5E9)','linear-gradient(135deg,#F59E0B,#EF4444)','linear-gradient(135deg,#EC4899,#8B5CF6)','linear-gradient(135deg,#14B8A6,#3B82F6)','linear-gradient(135deg,#84CC16,#10B981)'];

  function esc(str) { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  const coverHTML = trip.cover_image
    ? `<div style="max-width:560px;margin:0 auto;padding:16px 20px 0"><div style="position:relative;width:100%;height:190px;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.07)"><img src="data:image/jpeg;base64,${trip.cover_image}" id="cover-img" style="width:100%;height:100%;object-fit:cover"><button id="cover-change-btn" style="position:absolute;bottom:10px;right:10px;padding:7px 14px;background:rgba(0,0,0,0.7);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;font-family:'Epilogue',sans-serif;font-size:12px;font-weight:600;cursor:pointer">📷 Change</button><input id="cover-upload" type="file" accept="image/*" style="display:none"></div></div>`
    : `<div style="max-width:560px;margin:16px auto 0;padding:0 20px"><div id="cover-empty" style="width:100%;height:100px;border:2px dashed rgba(124,58,237,0.3);border-radius:16px;display:flex;align-items:center;justify-content:center;gap:10px;cursor:pointer;background:rgba(124,58,237,0.03)"><span style="font-size:20px">🖼</span><span style="font-size:13px;color:#6E6B80;font-weight:500">Add a cover photo for this trip</span></div><input id="cover-upload" type="file" accept="image/*" style="display:none"></div>`;

  const avatarRow = people.map((p, i) =>
    `<div data-person-avatar="${esc(p)}" onclick="openMemberProfile('${esc(p)}')" title="${esc(p)}" style="width:32px;height:32px;border-radius:50%;background:${avatarColors[i%avatarColors.length]};border:2px solid #06060A;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0;margin-left:${i===0?'0':'-8px'};overflow:hidden;cursor:pointer">${esc(p[0].toUpperCase())}</div>`
  ).join('');

  let countdownHTML = '';
  if (trip.trip_date) {
    // Compare dates in Eastern Time to avoid UTC offset issues
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const todayET = new Date(nowET.getFullYear(), nowET.getMonth(), nowET.getDate());
    const [y, m, d] = trip.trip_date.split('-').map(Number);
    const tripDay = new Date(y, m - 1, d);
    const diffMs = tripDay.getTime() - todayET.getTime();
    const days = Math.round(diffMs / 86400000);
    if (days > 0) {
      countdownHTML = `<div style="background:linear-gradient(135deg,rgba(124,58,237,0.12),rgba(48,209,88,0.08));border:1px solid rgba(124,58,237,0.22);border-radius:16px;padding:20px;text-align:center"><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:#C084FC;font-weight:700;margin-bottom:8px">✈️ Countdown to Trip</div><div style="font-size:72px;font-weight:900;line-height:1;color:#F0EEF8;margin-bottom:4px">${days}</div><div style="font-size:13px;color:#9896A8">day${days!==1?'s':''} to go · ${tripDay.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'America/New_York'})}</div></div>`;
    } else if (days === 0) {
      countdownHTML = `<div style="background:linear-gradient(135deg,rgba(48,209,88,0.12),rgba(124,58,237,0.08));border:1px solid rgba(48,209,88,0.3);border-radius:16px;padding:20px;text-align:center"><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:#30D158;font-weight:700;margin-bottom:8px">✈️ Today's the Day!</div><div style="font-size:48px;font-weight:900;line-height:1;color:#30D158;margin-bottom:4px">🛫</div><div style="font-size:13px;color:#9896A8">${tripDay.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</div></div>`;
    } else {
      const ago = Math.abs(days);
      countdownHTML = `<div style="background:rgba(48,209,88,0.06);border:1px solid rgba(48,209,88,0.18);border-radius:16px;padding:16px;text-align:center"><div style="font-size:13px;color:#30D158;font-weight:600">✅ Trip was ${ago>0?ago+' day'+(ago!==1?'s':'')+' ago':'today'} · ${tripDay.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</div></div>`;
    }
  } else {
    countdownHTML = `<div style="background:#13131A;border:1px dashed rgba(255,255,255,0.08);border-radius:14px;padding:14px 16px;display:flex;align-items:center;justify-content:space-between"><div style="font-size:13px;color:#6E6B80">📅 No trip date set</div><div style="font-size:11px;color:#6E6B80;font-style:italic">Set date in settings</div></div>`;
  }

  // Build per-person breakdown: who owes whom and how much
  const owesRows = people.map((p, i) => {
    const amtOwed = totals[p] || 0;
    const amtReceivable = owedTo[p] || 0;
    const isCreditor = amtReceivable > 0 && amtOwed === 0;
    const isBoth = amtOwed > 0 && amtReceivable > 0;

    // Find which payers this person owes money to
    const owesBreakdown = [];
    (receipts||[]).forEach(r => {
      if (!r.paid_by || r.paid_by.toLowerCase() === p.toLowerCase()) return;
      try {
        const sp = typeof r.splits==='string' ? JSON.parse(r.splits) : (r.splits||{});
        const myShare = Object.entries(sp).find(([k]) => k.toLowerCase() === p.toLowerCase());
        if (myShare && parseFloat(myShare[1]) > 0) {
          owesBreakdown.push({ payer: r.paid_by, amount: parseFloat(myShare[1]), receipt: r.name||'Receipt' });
        }
      } catch(e) {}
    });

    // Collapse to per-payer totals
    const owesPerPayer = {};
    owesBreakdown.forEach(o => { owesPerPayer[o.payer] = (owesPerPayer[o.payer]||0) + o.amount; });
    const payerEntries = Object.entries(owesPerPayer);

    // Render pay slots with data attributes — filled client-side using PAY_PROFILES
    const payBtnsHtml = payerEntries.map(([payerName, amt]) =>
      `<div class="pay-slot" data-payer="${esc(payerName)}" data-amount="${amt.toFixed(2)}" style="margin-top:4px">
        <div style="font-size:10px;color:#6E6B80;margin-bottom:4px">Pay ${esc(payerName)} <b style="color:#FF9A3C">$${amt.toFixed(2)}</b></div>
        <div class="pay-btns" style="display:flex;flex-wrap:wrap;gap:6px">
          <span style="font-size:11px;color:#6E6B80;font-style:italic">Loading payment options...</span>
        </div>
      </div>`
    ).join('');

    return `<div style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.05)">
      <div style="display:flex;align-items:center;justify-content:space-between;${payerEntries.length>0?'margin-bottom:12px':''}">
        <div style="display:flex;align-items:center;gap:10px;cursor:pointer" onclick="openMemberProfile('${esc(p)}')" title="View ${esc(p)}'s profile">
          <div data-person-avatar="${esc(p)}" style="width:34px;height:34px;border-radius:50%;background:${avatarColors[i%avatarColors.length]};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;overflow:hidden">${esc(p[0].toUpperCase())}</div>
          <div>
            <div style="font-weight:600;font-size:14px;display:flex;align-items:center;gap:6px">${esc(p)} <span style="font-size:11px;color:#6E6B80;font-weight:400">›</span></div>
            <div style="font-size:11px;color:${amtOwed>0?'#FF9A3C':amtReceivable>0?'#A855F7':'#30D158'}">
              ${amtOwed>0 ? `owes $${amtOwed.toFixed(2)}` : amtReceivable>0 ? `collecting $${amtReceivable.toFixed(2)}` : 'all settled ✓'}
            </div>
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:700;color:${amtOwed>0?'#FF9A3C':amtReceivable>0?'#A855F7':'#9896A8'}">
            ${amtOwed>0 ? '-$'+amtOwed.toFixed(2) : amtReceivable>0 ? '+$'+amtReceivable.toFixed(2) : '$0.00'}
          </div>
        </div>
      </div>
      ${payerEntries.length>0 ? `<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:10px 12px">${payBtnsHtml}</div>` : ''}
    </div>`;
  }).join('');

  const avatarColorMap = ['#7C3AED','#E8633A','#0EA5E9','#30D158','#F59E0B','#EC4899','#14B8A6','#84CC16'];

  const receiptRows = (receipts||[]).map((r, rIdx) => {
    let splits = {};
    let items = [];
    try { splits = typeof r.splits==='string' ? JSON.parse(r.splits) : (r.splits||{}); } catch(e) {}
    try { items = typeof r.items==='string' ? JSON.parse(r.items) : (r.items||[]); } catch(e) {}

    const payer = r.paid_by || '';
    const payerProfile = payer ? (memberPayProfiles[payer] || null) : null;
    // Entries excluding the payer (they don't owe themselves)
    const splitEntries = Object.entries(splits).filter(([p,a]) => parseFloat(a) > 0 && (!payer || p.toLowerCase() !== payer.toLowerCase()));
    const allEntries   = Object.entries(splits).filter(([,a]) => parseFloat(a) > 0);
    const total = parseFloat(r.total||0);
    const dateStr = new Date(r.created_at).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'});
    const receiptId = 'receipt-' + rIdx;

    // Split pills (collapsed view) — only non-payers
    const splitPillsHtml = splitEntries.map(([p,a]) =>
      `<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:rgba(255,255,255,0.05);border-radius:20px;font-size:12px;color:#9896A8">
        <span style="width:18px;height:18px;border-radius:50%;background:${avatarColorMap[people.indexOf(p) % avatarColorMap.length] || '#6E6B80'};display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;flex-shrink:0">${esc(p[0].toUpperCase())}</span>
        ${esc(p)} <b style="color:#F0EEF8;font-family:monospace">$${parseFloat(a).toFixed(2)}</b>
      </span>`
    ).join('');

    // Pay button slot — rendered client-side using PAY_PROFILES (includes localStorage enrichment)
    function payButtonsHtml(forPerson, amountOwed) {
      return `<div class="pay-slot" data-payer="${esc(forPerson)}" data-amount="${parseFloat(amountOwed).toFixed(2)}">
        <div class="pay-btns" style="display:flex;flex-wrap:wrap;gap:8px">
          <span style="font-size:12px;color:#6E6B80;font-style:italic">Loading payment options...</span>
        </div>
      </div>`;
    }

    // ── ITEMS breakdown ──
    let itemsHtml = '';
    if (items.length > 0) {
      itemsHtml = `<div style="margin-bottom:16px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#6E6B80;font-weight:700;margin-bottom:8px">Items</div>
        <div style="background:rgba(255,255,255,0.02);border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.06)">
          ${items.map((item,i) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:${i<items.length-1?'1px solid rgba(255,255,255,0.05)':'none'}">
            <span style="font-size:13px;color:#E0DEF0">${esc(item.name||'Item')}</span>
            <div style="display:flex;align-items:center;gap:8px">
              ${item.assignees&&item.assignees.length>0?`<span style="font-size:11px;color:#6E6B80">${item.assignees.map(a=>esc(a)).join(', ')}</span>`:''}
              <span style="font-family:monospace;font-size:13px;color:#9896A8">$${parseFloat(item.price||0).toFixed(2)}</span>
            </div>
          </div>`).join('')}
        </div>
      </div>`;
    }

    // ── WHO OWES WHAT (payer excluded — they paid) ──
    const personBreakdownHtml = splitEntries.length > 0 ? `
      <div style="margin-bottom:16px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#6E6B80;font-weight:700;margin-bottom:10px">${payer ? `Owes ${esc(payer)}` : 'Who Owes What'}</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${splitEntries.map(([person, amount]) => {
            const pct = total > 0 ? Math.round((parseFloat(amount)/total)*100) : 0;
            const color = avatarColorMap[people.indexOf(person) % avatarColorMap.length] || '#6E6B80';
            return `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:12px 14px">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:${payer?'10px':'8px'}">
                <div style="display:flex;align-items:center;gap:8px">
                  <div data-person-avatar="${esc(person)}" style="width:28px;height:28px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;overflow:hidden;flex-shrink:0">${esc(person[0].toUpperCase())}</div>
                  <span style="font-size:14px;font-weight:600">${esc(person)}</span>
                </div>
                <div style="text-align:right">
                  <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:#30D158;letter-spacing:0.03em;line-height:1">$${parseFloat(amount).toFixed(2)}</div>
                  <div style="font-size:10px;color:#6E6B80">${pct}% of bill</div>
                </div>
              </div>
              <div style="height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;margin-bottom:${payer?'10px':'0'}">
                <div style="height:100%;width:${pct}%;background:${color};border-radius:2px"></div>
              </div>
              ${payer ? `<div style="padding-top:8px;border-top:1px solid rgba(255,255,255,0.06)">${payButtonsHtml(payer, amount)}</div>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>` : '';

    // ── TOTALS + PAYER BADGE ──
    const payerBadgeHtml = payer ? `
      <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:rgba(124,58,237,0.07);border:1px solid rgba(124,58,237,0.2);border-radius:10px;margin-bottom:12px">
        <div data-person-avatar="${esc(payer)}" style="width:32px;height:32px;border-radius:50%;background:${avatarColorMap[people.indexOf(payer)%avatarColorMap.length]||'#7C3AED'};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;overflow:hidden">${esc(payer[0].toUpperCase())}</div>
        <div style="flex:1">
          <div style="font-size:12px;color:#A855F7;font-weight:700">💳 Paid by ${esc(payer)}</div>
          <div style="font-size:11px;color:#6E6B80">Others need to pay them back</div>
        </div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:#A855F7">$${total.toFixed(2)}</div>
      </div>` : '';

    const totalsHtml = `
      ${payerBadgeHtml}
      <div style="background:rgba(48,209,88,0.04);border:1px solid rgba(48,209,88,0.12);border-radius:10px;padding:14px 16px">
        <div style="display:flex;flex-direction:column;gap:6px">
          ${items.length > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:#6E6B80"><span>Subtotal</span><span style="font-family:monospace">$${items.reduce((s,i)=>s+parseFloat(i.price||0),0).toFixed(2)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;align-items:center;${items.length>0?'padding-top:6px;border-top:1px solid rgba(255,255,255,0.08)':''}">
            <span style="font-size:15px;font-weight:700">Total</span>
            <span style="font-family:'Bebas Neue',sans-serif;font-size:24px;color:#30D158;letter-spacing:0.03em">$${total.toFixed(2)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:#6E6B80">
            <span>${allEntries.length} ${allEntries.length===1?'person':'people'} splitting${payer?` · paid by ${esc(payer)}`:''}</span>
            <span>${dateStr}</span>
          </div>
        </div>
      </div>`;

    return `
    <div style="border-bottom:1px solid rgba(255,255,255,0.05)" id="${receiptId}-wrap">
      <div onclick="toggleReceipt('${receiptId}')" style="display:flex;align-items:center;justify-content:space-between;padding:16px;cursor:pointer;gap:12px;transition:background 0.15s" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:5px">
            <div style="width:36px;height:36px;border-radius:10px;background:rgba(48,209,88,0.1);border:1px solid rgba(48,209,88,0.2);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🧾</div>
            <div>
              <div style="font-weight:700;font-size:15px;color:#F0EEF8">${esc(r.name||'Receipt')}</div>
              <div style="font-size:11px;color:#6E6B80;margin-top:1px">${dateStr}${payer ? ` · 💳 ${esc(payer)} paid` : ''} · ${allEntries.length} ${allEntries.length===1?'person':'people'}</div>
            </div>
          </div>
          ${splitEntries.length > 0 ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;padding-left:46px">${splitPillsHtml}</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:26px;color:#30D158;letter-spacing:0.03em;line-height:1">$${total.toFixed(2)}</div>
          <button onclick="event.stopPropagation();openEditReceipt('${esc(r.id)}')" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.06);border:none;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0" title="Edit receipt">✏️</button>
          <div id="${receiptId}-chevron" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;font-size:12px;color:#6E6B80;transition:transform 0.2s;flex-shrink:0">▾</div>
        </div>
      </div>
      <div id="${receiptId}" style="display:none;padding:0 16px 20px;margin-top:-4px">
        <div style="background:#0C0C12;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:0">
          ${itemsHtml}
          ${personBreakdownHtml}
          ${totalsHtml}
        </div>
      </div>
    </div>`;
  }).join('');


  const commentRows = (comments||[]).map(c => {
    const initials = c.author_name ? esc(c.author_name[0].toUpperCase()) : '?';
    const timeStr = new Date(c.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'});
    return `<div style="display:flex;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.05)">
      <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7C3AED,#30D158);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0">${initials}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px"><span style="font-size:13px;font-weight:700">${esc(c.author_name||'Anonymous')}</span><span style="font-size:11px;color:#6E6B80">${timeStr}</span></div>
        ${c.body?`<div style="font-size:14px;line-height:1.6;color:#E0DEF0;word-break:break-word">${esc(c.body)}</div>`:''}
        ${c.gif_url?`<img src="${esc(c.gif_url)}" style="max-width:200px;border-radius:10px;display:block;margin-top:6px">`:''}
      </div>
    </div>`;
  }).join('');

  const perPersonInputs = people.map(p =>
    `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px"><span style="color:#9896A8">${esc(p)}</span><span id="ep-${esc(p.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,''))}" style="color:#30D158;font-weight:600">$0.00</span></div>`
  ).join('');

  const existingMemberRows = people.map((p, i) =>
    `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#13131A;border:1px solid rgba(255,255,255,0.07);border-radius:10px"><div style="display:flex;align-items:center;gap:9px"><div style="width:28px;height:28px;border-radius:50%;background:${avatarColors[i%avatarColors.length]};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff">${esc(p[0].toUpperCase())}</div><span style="font-size:13px;font-weight:600">${esc(p)}</span></div><span style="font-size:11px;color:#6E6B80">existing</span></div>`
  ).join('');

  // All user-controlled data goes into a single JSON blob read by JS — NEVER interpolated into JS template literals
  const pageData = JSON.stringify({
    tripId,
    shareToken: trip.share_token,
    backendUrl: baseUrl,
    tripUrl,
    inviteUrl,
    tripName: trip.name,
    tripDate: trip.trip_date || '',
    people,
    hasCoverImage: !!trip.cover_image,
    memberPayProfiles,
    receiptsData: (receipts||[]).map(r => {
      let splitsData = {};
      try { splitsData = typeof r.splits==='string' ? JSON.parse(r.splits) : (r.splits||{}); } catch(e) {}
      return {
        id: r.id,
        name: r.name || 'Receipt',
        paid_by: r.paid_by || '',
        total: parseFloat(r.total||0),
        splits: splitsData
      };
    })
  });

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>✈️ ${esc(trip.name)} — RAVEN</title>
<meta property="og:title" content="✈️ ${esc(trip.name)} — Trip Hub on RAVEN">
<meta property="og:description" content="${people.length} people · ${(receipts||[]).length} receipts · $${grandTotal.toFixed(2)} total">
<meta property="og:image" content="${trip.cover_image ? baseUrl+'/trip/'+tripId+'/cover-image' : 'https://work46121-gif.github.io/raven-site/raven-hero.png'}">
<meta property="og:image:width" content="800">
<meta property="og:image:height" content="400">
<meta property="og:url" content="${tripUrl}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="✈️ ${esc(trip.name)} — Trip Hub on RAVEN">
<meta name="twitter:description" content="${people.length} people · ${(receipts||[]).length} receipts · $${grandTotal.toFixed(2)} total">
<meta name="twitter:image" content="${trip.cover_image ? baseUrl+'/trip/'+tripId+'/cover-image' : 'https://work46121-gif.github.io/raven-site/raven-hero.png'}">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Epilogue:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--black:#06060A;--dark:#0C0C12;--dark2:#13131A;--border:rgba(255,255,255,0.07);--border2:rgba(255,255,255,0.12);--white:#F0EEF8;--muted:#6E6B80;--muted2:#9896A8;--green:#30D158;--purple:#7C3AED;--purple2:#A855F7;--orange:#FF6B35}
body{font-family:'Epilogue',sans-serif;background:var(--black);color:var(--white);min-height:100vh;padding-bottom:60px}
.hdr{position:sticky;top:0;background:rgba(6,6,10,0.95);backdrop-filter:blur(20px);border-bottom:1px solid var(--border);z-index:100}
.hdr-inner{max-width:560px;margin:0 auto;height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 20px}
.sec{max-width:560px;margin:20px auto 0;padding:0 20px}
.sec-lbl{font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:var(--muted);font-weight:700;margin-bottom:10px}
.card{background:var(--dark);border:1px solid var(--border);border-radius:16px;overflow:hidden}
.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(12px);z-index:500;align-items:flex-end;justify-content:center}
.modal-bg.open{display:flex}
.modal-box{background:var(--dark);border:1px solid var(--border2);border-radius:24px 24px 0 0;padding:24px 20px 52px;width:100%;max-width:520px;max-height:85vh;overflow-y:auto}
.handle{width:36px;height:4px;background:var(--border2);border-radius:2px;margin:0 auto 20px}
.btn-g{width:100%;padding:15px;background:var(--green);color:#000;border:none;border-radius:12px;font-family:'Epilogue',sans-serif;font-size:15px;font-weight:800;cursor:pointer}
.btn-o{width:100%;padding:13px;background:transparent;border:1px solid var(--border2);border-radius:12px;color:var(--muted2);font-family:'Epilogue',sans-serif;font-size:14px;font-weight:600;cursor:pointer}
.btn-p{width:100%;padding:13px;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.25);border-radius:12px;color:var(--purple2);font-family:'Epilogue',sans-serif;font-size:14px;font-weight:600;cursor:pointer}
input,textarea{background:var(--dark2);border:1px solid var(--border);border-radius:10px;color:var(--white);font-family:'Epilogue',sans-serif;font-size:14px;outline:none;padding:12px 16px;width:100%;transition:border-color 0.2s}
input:focus,textarea:focus{border-color:var(--purple)}
.spl{flex:1;padding:10px;border-radius:8px;font-family:'Epilogue',sans-serif;font-size:13px;font-weight:600;cursor:pointer;background:#1A1A24;border:1px solid var(--border);color:var(--muted2)}
.spl.ae{background:rgba(48,209,88,0.12);border-color:rgba(48,209,88,0.3);color:var(--green)}
.spl.ai{background:rgba(124,58,237,0.12);border-color:rgba(124,58,237,0.3);color:var(--purple2)}
@keyframes spin{to{transform:rotate(360deg)}}
.spinner{width:16px;height:16px;border:2px solid rgba(124,58,237,0.3);border-top-color:var(--purple2);border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0;display:inline-block}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0.4}}
</style>
</head>
<body>

<!-- All page data — safely JSON-encoded, never interpolated into JS -->
<script id="page-data" type="application/json">${pageData}</script>

<div class="hdr"><div class="hdr-inner">
  <a href="https://work46121-gif.github.io/raven-site/" style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:0.15em;text-decoration:none;color:#F0EEF8">🪶 RAVEN</a>
  <div style="font-size:10px;color:#6E6B80;background:rgba(255,255,255,0.05);padding:4px 10px;border-radius:12px;font-weight:600">${esc(tripId)}</div>
</div></div>

${coverHTML}

<div class="sec" style="margin-top:16px">
  <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(48,209,88,0.08);border:1px solid rgba(48,209,88,0.2);padding:4px 12px;border-radius:12px;font-size:10px;font-weight:700;color:#30D158;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:12px">
    <span style="width:5px;height:5px;border-radius:50%;background:#30D158;animation:blink 2s infinite"></span>Trip Hub · Live
  </div>
  <div style="font-family:'Bebas Neue',sans-serif;font-size:36px;letter-spacing:0.04em;line-height:1;margin-bottom:8px">✈️ ${esc(trip.name)}</div>
  <div style="font-size:13px;color:#6E6B80;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    <span>${people.length} people</span>
    <span style="width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,0.12)"></span>
    <span>${(receipts||[]).length} receipt${(receipts||[]).length!==1?'s':''}</span>
    <span style="width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,0.12)"></span>
    <span style="color:#30D158;font-weight:600">$${grandTotal.toFixed(2)} total</span>
  </div>
  <div style="display:flex;align-items:center;margin-top:14px;margin-bottom:6px">
    ${avatarRow}
    <button id="open-add-members" style="width:32px;height:32px;border-radius:50%;background:#13131A;border:2px dashed rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;cursor:pointer;margin-left:4px;flex-shrink:0;font-size:14px;color:#6E6B80">+</button>
    <button id="open-invite" style="padding:5px 14px;margin-left:10px;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.25);border-radius:20px;color:#A855F7;font-family:'Epilogue',sans-serif;font-size:11px;font-weight:700;cursor:pointer">📨 Invite</button>
  </div>
</div>

<div class="sec" style="margin-top:16px">${countdownHTML}</div>

<div class="sec" style="margin-top:20px">
  <div class="sec-lbl">Who Owes What</div>
  <div class="card">
    ${owesRows}
    <div style="display:flex;justify-content:space-between;padding:12px 16px;background:rgba(48,209,88,0.04);border-top:1px solid rgba(48,209,88,0.12)">
      <span style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#9896A8">Grand Total</span>
      <span style="font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:700;color:#30D158">$${grandTotal.toFixed(2)}</span>
    </div>
  </div>
</div>

<div class="sec" style="margin-top:16px;display:flex;flex-direction:column;gap:10px">
  <button class="btn-g" id="open-receipt-btn">📸 Add a Receipt</button>
  <div style="display:flex;gap:10px">
    <button class="btn-p" id="open-share" style="flex:1">🔗 Share</button>
    <button id="open-settings" style="flex:1;padding:13px;background:#13131A;border:1px solid var(--border2);border-radius:12px;color:#9896A8;font-family:'Epilogue',sans-serif;font-size:14px;font-weight:600;cursor:pointer">⚙️ Settings</button>
  </div>
</div>

<div id="receipt-form-wrap" style="display:none">
  <div class="sec" style="margin-top:16px">
    <div class="sec-lbl">New Receipt</div>
    <div class="card" style="padding:20px;display:flex;flex-direction:column;gap:14px">
      <div><div style="font-size:12px;color:#6E6B80;margin-bottom:6px;font-weight:600">Receipt Name</div><input id="r-name" type="text" placeholder="e.g. Dinner at Casa Marina"></div>
      <div>
        <div style="font-size:12px;color:#6E6B80;margin-bottom:6px;font-weight:600">Who paid? <span style="color:#6E6B80;font-weight:400">(they'll collect from others)</span></div>
        <select id="r-paidby" style="width:100%;padding:12px 14px;background:#13131A;border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#F0EEF8;font-family:'Epilogue',sans-serif;font-size:14px;font-weight:600">
          <option value="">— Select who paid —</option>
          ${people.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}
        </select>
      </div>
      <div>
        <div style="font-size:12px;color:#6E6B80;margin-bottom:8px;font-weight:600">Photo — AI scans automatically</div>
        <div id="r-drop" style="border:2px dashed rgba(48,209,88,0.25);border-radius:12px;padding:20px;text-align:center;cursor:pointer">
          <div id="r-empty" style="color:#6E6B80;font-size:13px">📸 Tap to upload receipt photo</div>
          <img id="r-preview" style="display:none;max-width:100%;border-radius:8px;max-height:220px;object-fit:contain">
        </div>
        <input id="r-file" type="file" accept="image/*" style="display:none">
      </div>
      <div id="r-scan-status" style="display:none"></div>
      <div>
        <div style="font-size:12px;color:#6E6B80;margin-bottom:8px;font-weight:600">Split type</div>
        <div style="display:flex;gap:8px"><button class="spl ae" id="r-btn-e" id="r-btn-e">⚖️ Even</button><button class="spl" id="r-btn-i">📋 Itemized</button></div>
      </div>
      <div id="r-even-sec">
        <div style="font-size:12px;color:#6E6B80;margin-bottom:6px;font-weight:600">Total Amount</div>
        <div style="position:relative"><span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#6E6B80">$</span><input id="r-total" type="number" placeholder="0.00" step="0.01" style="padding-left:28px"></div>
        <div id="r-even-prev" style="margin-top:10px;display:none;background:#13131A;border-radius:10px;padding:10px 14px">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#6E6B80;font-weight:600;margin-bottom:8px">Per Person</div>
          ${perPersonInputs}
        </div>
      </div>
      <div id="r-item-sec" style="display:none">
        <div id="r-items-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px"></div>
        <div style="display:flex;gap:8px">
          <input id="r-iname" type="text" placeholder="Item name" style="flex:1">
          <div style="position:relative;display:flex;align-items:center"><span style="position:absolute;left:10px;color:#6E6B80;font-size:13px">$</span><input id="r-iprice" type="number" placeholder="0.00" step="0.01" style="width:80px;padding-left:24px"></div>
          <button id="r-add-item" style="padding:0 14px;background:rgba(124,58,237,0.15);border:1px solid rgba(124,58,237,0.3);border-radius:8px;color:#A855F7;font-family:'Epilogue',sans-serif;font-weight:700;cursor:pointer;font-size:18px;flex-shrink:0">+</button>
        </div>
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn-o" id="close-receipt-btn" style="flex:1">Cancel</button>
        <button class="btn-g" id="r-save" style="flex:2">Save Receipt</button>
      </div>
    </div>
  </div>
</div>

<div class="sec" style="margin-top:20px">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;cursor:pointer" onclick="toggleReceipts()">
    <div class="sec-lbl" style="margin-bottom:0">All Receipts (${(receipts||[]).length})</div>
    <div id="receipts-toggle" style="font-size:12px;color:#6E6B80;background:rgba(255,255,255,0.05);padding:4px 10px;border-radius:8px;user-select:none">${(receipts||[]).length > 0 ? '▾ Show' : ''}</div>
  </div>
  <div id="receipts-body" style="display:none">
    ${(receipts||[]).length===0
      ? `<div style="text-align:center;padding:28px 20px;color:#6E6B80;font-size:14px;background:#0C0C12;border:1px solid rgba(255,255,255,0.07);border-radius:16px"><div style="font-size:32px;margin-bottom:10px">🧾</div><div style="font-weight:600;color:#9896A8;margin-bottom:4px">No receipts yet</div><div>Be the first to add one!</div></div>`
      : `<div class="card">${receiptRows}</div>`}
  </div>
</div>

<div class="sec" style="margin-top:24px">
  <div class="sec-lbl">Comments (${(comments||[]).length})</div>
  <div class="card" id="comments-card">
    ${(comments||[]).length===0
      ? '<div style="padding:24px;text-align:center;color:#6E6B80;font-size:13px">No comments yet — say something! 👋</div>'
      : commentRows}
  </div>
  <div style="margin-top:12px;background:#0C0C12;border:1px solid var(--border2);border-radius:14px;overflow:hidden">
    <!-- Name row with avatar -->
    <div id="comment-name-row" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border)">
      <div id="comment-avatar" style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7C3AED,#30D158);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0;overflow:hidden">?</div>
      <input id="comment-author" type="text" placeholder="Your name" style="flex:1;background:transparent;border:none;color:#F0EEF8;font-family:inherit;font-size:14px;font-weight:600;outline:none">
    </div>
    <div id="gif-preview-wrap" style="display:none;padding:10px 12px;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:8px">
        <img id="gif-preview-img" style="height:80px;border-radius:8px;object-fit:cover">
        <button id="gif-clear-btn" style="padding:4px 10px;background:rgba(255,68,68,0.12);border:1px solid rgba(255,68,68,0.25);border-radius:6px;color:#FF6B6B;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">✕ Remove</button>
      </div>
    </div>
    <textarea id="comment-body" placeholder="Add a comment..." rows="2" style="border-radius:0;border:none;border-bottom:1px solid var(--border);background:transparent;resize:none;display:block"></textarea>
    <div id="gif-panel" style="display:none;border-bottom:1px solid var(--border);background:#13131A">
      <div style="padding:8px 12px"><input id="gif-search" type="text" placeholder="Search GIFs..." style="padding:10px 14px;font-size:13px;background:#1A1A24;border:1px solid var(--border);border-radius:8px"></div>
      <div id="gif-results" style="display:flex;flex-wrap:wrap;gap:4px;padding:0 12px 10px;max-height:180px;overflow-y:auto"><div style="color:#6E6B80;font-size:12px;padding:8px 0">Type to search GIFs...</div></div>
    </div>
    <div style="display:flex">
      <button id="gif-toggle-btn" style="padding:13px 16px;background:transparent;border:none;border-right:1px solid var(--border);color:#6E6B80;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;flex-shrink:0">🎭 GIF</button>
      <button id="post-comment-btn" style="flex:1;padding:13px;background:rgba(48,209,88,0.12);border:none;color:#30D158;font-family:inherit;font-size:15px;font-weight:700;cursor:pointer">💬 Post</button>
    </div>
  </div>
</div>

<!-- MEMBER PROFILE MODAL -->
<div class="modal-bg" id="member-profile-modal" onclick="if(event.target.id==='member-profile-modal')closeMemberProfile()">
  <div style="background:#13131A;border:1px solid rgba(255,255,255,0.1);border-radius:24px 24px 0 0;width:100%;max-width:480px;overflow:hidden">
    <!-- Header gradient band — tall enough for avatar overlap -->
    <div style="height:110px;background:linear-gradient(135deg,#7C3AED,#30D158);position:relative;flex-shrink:0">
      <button onclick="closeMemberProfile()" style="position:absolute;top:14px;right:14px;background:rgba(0,0,0,0.3);border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;line-height:1">✕</button>
    </div>
    <div style="padding:0 24px 32px;margin-top:-46px">
      <div id="mp-avatar" style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,#7C3AED,#30D158);border:4px solid #13131A;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:#fff;overflow:hidden;margin-bottom:12px;flex-shrink:0"></div>
      <div style="display:flex;align-items:flex-end;gap:10px;margin-bottom:4px;flex-wrap:wrap">
        <div id="mp-name" style="font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:0.04em"></div>
        <div id="mp-raven-id" style="font-size:13px;color:#A855F7;font-weight:700;padding-bottom:4px"></div>
      </div>
      <div id="mp-member-since" style="font-size:12px;color:#6E6B80;margin-bottom:18px"></div>
      <div id="mp-payment-chips" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px"></div>
      <div style="display:flex;flex-direction:column;gap:10px" id="mp-actions"></div>
    </div>
  </div>
</div>

<!-- EDIT RECEIPT MODAL -->
<div class="modal-bg" id="edit-receipt-modal" onclick="if(event.target.id==='edit-receipt-modal')closeEditReceipt()">
  <div style="background:#13131A;border:1px solid rgba(255,255,255,0.1);border-radius:24px 24px 0 0;padding:28px 24px 48px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto">
    <div style="width:36px;height:4px;background:rgba(255,255,255,0.15);border-radius:2px;margin:0 auto 20px"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:24px;letter-spacing:0.05em">✏️ Edit Receipt</div>
      <button onclick="closeEditReceipt()" style="background:rgba(255,255,255,0.07);border:none;color:#9896A8;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:16px">✕</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:16px">
      <div>
        <div style="font-size:12px;color:#6E6B80;font-weight:600;margin-bottom:6px">Receipt Name</div>
        <input id="edit-r-name" type="text" style="width:100%;padding:12px 14px;background:#0C0C12;border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#F0EEF8;font-family:'Epilogue',sans-serif;font-size:14px">
      </div>
      <div>
        <div style="font-size:12px;color:#6E6B80;font-weight:600;margin-bottom:6px">Who Paid?</div>
        <select id="edit-r-paidby" style="width:100%;padding:12px 14px;background:#0C0C12;border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#F0EEF8;font-family:'Epilogue',sans-serif;font-size:14px;font-weight:600">
          <option value="">— No one selected —</option>
          ${people.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}
        </select>
      </div>
      <div>
        <div style="font-size:12px;color:#6E6B80;font-weight:600;margin-bottom:6px">Total Amount</div>
        <div style="position:relative"><span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#6E6B80">$</span><input id="edit-r-total" type="number" step="0.01" oninput="updateEditSplitPreview()" style="width:100%;padding:12px 14px 12px 28px;background:#0C0C12;border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#F0EEF8;font-family:'Epilogue',sans-serif;font-size:14px"></div>
      </div>
      <div>
        <div style="font-size:12px;color:#6E6B80;font-weight:600;margin-bottom:10px">Who's on this receipt?</div>
        <div id="edit-r-people" style="display:flex;flex-direction:column;gap:8px"></div>
        <div style="font-size:11px;color:#6E6B80;margin-top:8px">Unchecked people are removed from the split. Amounts are recalculated evenly among checked people.</div>
      </div>
      <div id="edit-r-split-preview" style="display:none;background:#0C0C12;border:1px solid rgba(48,209,88,0.15);border-radius:10px;padding:12px 14px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#6E6B80;font-weight:600;margin-bottom:8px">Split Preview</div>
        <div id="edit-r-split-rows" style="display:flex;flex-direction:column;gap:4px"></div>
      </div>
      <button id="edit-r-save" onclick="saveEditReceipt()" style="width:100%;padding:15px;background:#30D158;border:none;border-radius:12px;font-family:'Epilogue',sans-serif;font-size:15px;font-weight:700;color:#000;cursor:pointer;margin-top:4px">Save Changes</button>
    </div>
  </div>
</div>

<!-- SETTINGS MODAL -->
<div class="modal-bg" id="settings-modal">
  <div class="modal-box">
    <div class="handle"></div>
    <div style="font-size:26px;font-weight:800;margin-bottom:16px">Trip Settings</div>
    <div style="margin-bottom:14px"><div style="font-size:12px;color:#6E6B80;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em">Trip Name</div><input id="settings-name" type="text" placeholder="Trip name"></div>
    <div style="margin-bottom:16px"><div style="font-size:12px;color:#6E6B80;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em">Trip Date</div><input id="settings-date" type="date"></div>
    <button class="btn-g" id="save-settings-btn" style="margin-bottom:10px">💾 Save Changes</button>
    <button class="btn-o" id="close-settings-btn">Cancel</button>
  </div>
</div>

<!-- ADD MEMBERS MODAL -->
<div class="modal-bg" id="add-members-modal">
  <div class="modal-box">
    <div class="handle"></div>
    <div style="font-size:26px;font-weight:800;margin-bottom:8px">Add Members</div>
    <div style="font-size:13px;color:#6E6B80;margin-bottom:16px;line-height:1.6">Add more people to this trip.</div>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <input id="new-member-input" type="text" placeholder="Enter name" style="flex:1">
      <button id="add-member-btn" style="padding:12px 18px;background:rgba(48,209,88,0.12);border:1px solid rgba(48,209,88,0.25);border-radius:10px;color:#30D158;font-family:'Epilogue',sans-serif;font-size:14px;font-weight:700;cursor:pointer;flex-shrink:0">+ Add</button>
    </div>
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6E6B80;font-weight:600;margin-bottom:8px">Current Members</div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">${existingMemberRows}</div>
    <div id="new-members-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px"></div>
    <button class="btn-g" id="save-members-btn" style="display:none;margin-bottom:10px">✓ Save New Members</button>
    <button class="btn-o" id="close-members-btn">Close</button>
  </div>
</div>

<!-- INVITE MODAL -->
<div class="modal-bg" id="invite-modal">
  <div class="modal-box">
    <div class="handle"></div>
    <div style="font-size:26px;font-weight:800;margin-bottom:16px">Invite to Trip</div>
    <div style="background:#13131A;border:1px solid var(--border2);border-radius:14px;padding:16px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#9896A8;margin-bottom:6px">📋 Trip Link</div>
      <div style="font-size:12px;color:#6E6B80;margin-bottom:10px">For people already added to the trip</div>
      <div id="trip-url-text" style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#9896A8;background:#1A1A24;border-radius:8px;padding:8px 12px;margin-bottom:10px;word-break:break-all"></div>
      <div style="display:flex;gap:8px">
        <button id="copy-trip-btn" style="flex:1;padding:11px;background:rgba(48,209,88,0.1);border:1px solid rgba(48,209,88,0.25);border-radius:9px;color:#30D158;font-family:'Epilogue',sans-serif;font-size:13px;font-weight:700;cursor:pointer">📋 Copy</button>
        <button id="share-trip-btn" style="flex:1;padding:11px;background:rgba(48,209,88,0.1);border:1px solid rgba(48,209,88,0.25);border-radius:9px;color:#30D158;font-family:'Epilogue',sans-serif;font-size:13px;font-weight:700;cursor:pointer">📤 Share</button>
      </div>
    </div>
    <div style="background:#13131A;border:1px solid rgba(124,58,237,0.25);border-radius:14px;padding:16px;margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#C084FC;margin-bottom:6px">📨 Invite Link</div>
      <div style="font-size:12px;color:#6E6B80;margin-bottom:10px">Requires creating a RAVEN account</div>
      <div id="invite-url-text" style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#9896A8;background:#1A1A24;border-radius:8px;padding:8px 12px;margin-bottom:10px;word-break:break-all"></div>
      <div style="display:flex;gap:8px">
        <button id="copy-invite-btn" style="flex:1;padding:11px;background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.3);border-radius:9px;color:#A855F7;font-family:'Epilogue',sans-serif;font-size:13px;font-weight:700;cursor:pointer">📋 Copy Invite</button>
        <button id="share-invite-btn" style="flex:1;padding:11px;background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.3);border-radius:9px;color:#A855F7;font-family:'Epilogue',sans-serif;font-size:13px;font-weight:700;cursor:pointer">📤 Share</button>
      </div>
    </div>
    <button class="btn-o" id="close-invite-btn">Done</button>
  </div>
</div>

<div id="toast" style="position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(80px);background:#13131A;border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:12px 20px;font-size:13px;color:#F0EEF8;z-index:9999;opacity:0;transition:all 0.3s;white-space:nowrap;box-shadow:0 20px 60px rgba(0,0,0,0.5)"></div>

<script>
// ── Read all data from JSON — no user content ever touches JS source code ──
const D = JSON.parse(document.getElementById('page-data').textContent);
const TRIP_ID    = D.tripId;
const TRIP_TOKEN = D.shareToken;
const BACKEND    = D.backendUrl;
const TRIP_URL   = D.tripUrl;
const INVITE_URL = D.inviteUrl;
const TRIP_NAME  = D.tripName;
const TRIP_DATE  = D.tripDate;
let   PEOPLE     = D.people;
const PAY_PROFILES = D.memberPayProfiles || {};
const receiptsDataMap = {}; // keyed by receipt id — safe lookup, no user data in onclick
(D.receiptsData || []).forEach(r => { receiptsDataMap[r.id] = r; });

// Enrich PAY_PROFILES with the current user's payment methods from localStorage
// (catches cases where server-side lookup didn't find them)
(function enrichPayProfiles() {
  try {
    const local = JSON.parse(localStorage.getItem('raven_profile') || '{}');
    const name = local.first_name || '';
    if (!name) return;
    if (!PAY_PROFILES[name]) PAY_PROFILES[name] = {};
    if (local.venmo)    PAY_PROFILES[name].venmo    = local.venmo;
    if (local.cashapp)  PAY_PROFILES[name].cashapp  = local.cashapp;
    if (local.zelle)    PAY_PROFILES[name].zelle    = local.zelle;
    if (local.applepay) PAY_PROFILES[name].applepay = local.applepay;
  } catch(e) {}
})();

// Populate invite modal URLs (set via JS, never via template literal)
document.getElementById('trip-url-text').textContent   = TRIP_URL;
document.getElementById('invite-url-text').textContent = INVITE_URL;
// Pre-fill settings inputs
document.getElementById('settings-name').value = TRIP_NAME;
if (TRIP_DATE) document.getElementById('settings-date').value = TRIP_DATE;

let splitType = 'even', tripItems = [], imgBase64 = null, newMembers = [];
let gifUrl = null, gifTimer = null, gifPanelOpen = false;

// ── TOAST ──
function toast(msg, ok) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.borderColor = ok===false ? 'rgba(255,68,68,0.3)' : 'rgba(48,209,88,0.3)';
  t.style.opacity = '1';
  t.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.style.opacity='0'; t.style.transform='translateX(-50%) translateY(80px)'; }, 3000);
}

// ── AUTO-FILL NAME + AVATAR ──
const SUPA_URL = 'https://ffjpzkpdumdcwnakpaje.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmanB6a3BkdW1kY3duYWtwYWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5ODc4OTcsImV4cCI6MjA4ODU2Mzg5N30.JtDLVu4K1TJ8emcN_mvSHBu6e0y8-jPQv-ypoc9p0RU';

function applyNameAndAvatar(firstName, avatarUrl) {
  if (firstName) {
    const inp = document.getElementById('comment-author');
    if (inp) {
      inp.value = firstName;
      inp.readOnly = true;
      inp.style.cssText = 'flex:1;background:transparent;border:none;color:#9896A8;font-family:inherit;font-size:14px;font-weight:600;outline:none;cursor:default';
    }
    sessionStorage.setItem('raven_trip_name', firstName);
  }
  // Update comment box avatar
  const avatarEl = document.getElementById('comment-avatar');
  if (avatarEl) {
    if (avatarUrl) {
      avatarEl.innerHTML = '<img src="' + avatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
      avatarEl.style.background = 'transparent';
    } else if (firstName) {
      avatarEl.textContent = firstName[0].toUpperCase();
    }
  }
  // Update ALL avatar circles on the page for this user (receipt breakdowns, people row, etc.)
  if (firstName) {
    document.querySelectorAll('[data-person-avatar]').forEach(el => {
      if (el.getAttribute('data-person-avatar').toLowerCase() === firstName.toLowerCase()) {
        if (avatarUrl) {
          el.innerHTML = '<img src="' + avatarUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
          el.style.background = 'transparent';
        }
      }
    });
  }
}

(async function(){
  try {
    const urlName   = new URLSearchParams(window.location.search).get('name');
    const local     = JSON.parse(localStorage.getItem('raven_profile') || '{}');
    const sessName  = sessionStorage.getItem('raven_trip_name');
    const firstName = urlName ? decodeURIComponent(urlName) : (local.first_name || sessName || '');

    // Apply what we know immediately from localStorage/URL
    applyNameAndAvatar(firstName, local.avatar_url || '');

    // Always try to fetch fresh avatar + name from Supabase
    try {
      // Find the Supabase session token — key format varies by supabase-js version
      let sbSession = null;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.includes('auth-token') || k.includes('supabase.auth'))) {
          try { sbSession = JSON.parse(localStorage.getItem(k)); break; } catch(e) {}
        }
      }
      const accessToken = sbSession?.access_token;
      const userId = sbSession?.user?.id;
      if (accessToken && userId) {
        const profResp = await fetch(SUPA_URL + '/rest/v1/profiles?select=*&id=eq.' + userId, {
          headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + accessToken, 'Accept': 'application/json' }
        });
        if (profResp.ok) {
          const profiles = await profResp.json();
          if (profiles && profiles.length > 0) {
            const p = profiles[0];
            const fn = p.first_name || firstName;
            const av = p.avatar_url || '';
            localStorage.setItem('raven_profile', JSON.stringify({ ...local, first_name: fn, avatar_url: av, user_id: userId }));
            applyNameAndAvatar(fn, av);
          }
        }
      }
    } catch(e) { /* best effort */ }
  } catch(e) {}
})();

// ── AUTO-OPEN receipt form ──
if (new URLSearchParams(window.location.search).get('action') === 'receipt') {
  setTimeout(() => { document.getElementById('receipt-form-wrap').style.display='block'; document.getElementById('open-receipt-btn').style.display='none'; }, 300);
}

// ── PENDING RECEIPTS — check for unscanned photos saved during offline ──
(function checkPendingReceipts() {
  try {
    const pending = JSON.parse(localStorage.getItem('raven_pending_receipts') || '[]');
    const unscanned = pending.filter(p => !p.scanned && p.tripId === TRIP_ID);
    if (unscanned.length === 0) return;
    // Show banner
    const banner = document.createElement('div');
    banner.id = 'pending-receipts-banner';
    banner.style.cssText = 'margin:12px 0;padding:14px 16px;background:rgba(255,107,53,0.08);border:1px solid rgba(255,107,53,0.25);border-radius:12px;display:flex;align-items:center;justify-content:space-between;gap:12px';
    banner.innerHTML = '<div><div style="font-size:13px;font-weight:700;color:#FF6B35;margin-bottom:2px">📸 ' + unscanned.length + ' unscanned receipt photo' + (unscanned.length>1?'s':'') + ' saved on this device</div>'
      + '<div style="font-size:12px;color:#9896A8">Tap to retry scanning when the server is available</div></div>'
      + '<button onclick="retryPendingScans()" style="padding:8px 14px;background:rgba(255,107,53,0.15);border:1px solid rgba(255,107,53,0.35);border-radius:8px;color:#FF6B35;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0">↻ Retry</button>';
    const firstSec = document.querySelector('.sec');
    if (firstSec) firstSec.parentNode.insertBefore(banner, firstSec);
  } catch(e) {}
})();

async function retryPendingScans() {
  try {
    const pending = JSON.parse(localStorage.getItem('raven_pending_receipts') || '[]');
    const unscanned = pending.filter(p => !p.scanned && p.tripId === TRIP_ID);
    if (unscanned.length === 0) { toast('No pending receipts to scan'); return; }
    const banner = document.getElementById('pending-receipts-banner');
    if (banner) banner.innerHTML = '<div style="font-size:13px;color:#FF6B35;font-weight:600">↻ Scanning saved receipts...</div>';
    // Load the first unscanned receipt into the form and trigger scan
    const first = unscanned[0];
    imgBase64 = first.imageBase64;
    window._currentPendingId = first.id;
    // Show the receipt form
    document.getElementById('receipt-form-wrap').style.display = 'block';
    document.getElementById('open-receipt-btn').style.display = 'none';
    // Show preview
    document.getElementById('r-preview').src = 'data:' + (first.mediaType||'image/jpeg') + ';base64,' + first.imageBase64;
    document.getElementById('r-preview').style.display = 'block';
    document.getElementById('r-empty').style.display = 'none';
    // Show scan status and fire scan
    const st = document.getElementById('r-scan-status');
    st.style.display = 'block';
    st.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);border-radius:8px"><div class="spinner"></div><span style="font-size:13px;color:#C084FC;font-weight:600">Scanning saved receipt...</span></div>';
    document.getElementById('receipt-form-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Reuse the doScan logic by dispatching through the file change path
    // Trigger the scan directly using stored base64
    try { await Promise.race([fetch(BACKEND+'/'), new Promise(r=>setTimeout(r,20000))]); } catch(e) {}
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 60000);
    const r = await fetch(BACKEND+'/demo/scan-receipt', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ image: imgBase64, mediaType: first.mediaType||'image/jpeg' }), signal: controller.signal });
    const d = await r.json();
    if (d.success && d.items && d.items.length) {
      if (d.bill_name && !document.getElementById('r-name').value) document.getElementById('r-name').value = d.bill_name;
      const tot = d.total || d.items.reduce((s,i)=>s+i.price,0);
      document.getElementById('r-total').value = tot.toFixed(2); updateEven();
      tripItems = d.items.map((item,idx)=>({id:Date.now()+idx,name:item.name,price:parseFloat(item.price)||0,assignees:[]}));
      setSplit('itemized'); renderItems();
      st.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(48,209,88,0.08);border:1px solid rgba(48,209,88,0.2);border-radius:8px"><span>✅</span><span style="font-size:13px;color:#30D158;font-weight:600">' + d.items.length + ' items found from saved receipt!</span></div>';
      // Mark scanned
      const idx = pending.findIndex(p=>p.id===first.id);
      if (idx>=0) { pending[idx].scanned=true; localStorage.setItem('raven_pending_receipts', JSON.stringify(pending)); }
      if (banner) banner.remove();
    } else {
      st.innerHTML = '<div style="padding:10px 14px;background:rgba(255,68,68,0.07);border:1px solid rgba(255,68,68,0.2);border-radius:8px;font-size:13px;color:#FF6B6B">Still could not scan — enter manually or try again later</div>';
      if (banner) banner.innerHTML = '<div style="font-size:13px;color:#FF6B35;font-weight:600">📸 ' + unscanned.length + ' saved receipt' + (unscanned.length>1?'s':'') + ' — server still starting up, try again in a minute</div>';
    }
  } catch(e) {
    const banner = document.getElementById('pending-receipts-banner');
    if (banner) banner.innerHTML = '<div style="font-size:13px;color:#FF6B35">Server not ready yet — your photos are safe, try again shortly</div>';
  }
}

// ── INJECT CURRENT USER AVATAR into receipt breakdowns ──
// Receipts are server-rendered with initials — this swaps in the real photo for the logged-in user
(function injectUserAvatars() {
  try {
    const profile = JSON.parse(localStorage.getItem('raven_profile') || '{}');
    const firstName = profile.first_name || '';
    const avatarUrl = profile.avatar_url || '';
    if (!firstName) return; // can't match without a name

    // Run after a short delay so avatar fetch has time to complete
    setTimeout(() => {
      const updatedProfile = JSON.parse(localStorage.getItem('raven_profile') || '{}');
      const av = updatedProfile.avatar_url || '';
      const fn = updatedProfile.first_name || firstName;
      if (!fn) return;

      // Find all avatar circles that show this user's initial
      document.querySelectorAll('[data-person-avatar]').forEach(el => {
        if (el.getAttribute('data-person-avatar').toLowerCase() === fn.toLowerCase()) {
          if (av) {
            el.innerHTML = '<img src="' + av + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
            el.style.background = 'transparent';
          }
        }
      });
    }, 1200); // wait for avatar fetch to complete
  } catch(e) {}
})();
// ── RENDER PAY BUTTONS client-side ──
function renderPaySlots() {
  document.querySelectorAll('.pay-slot').forEach(slot => {
    if (slot.getAttribute('data-rendered') === '1') return;
    const payerName = slot.getAttribute('data-payer');
    const amount    = parseFloat(slot.getAttribute('data-amount') || '0');
    const container = slot.querySelector('.pay-btns');
    if (!container || !payerName) return;

    const profKey = Object.keys(PAY_PROFILES).find(k => k.toLowerCase() === payerName.toLowerCase());
    const prof = profKey ? PAY_PROFILES[profKey] : null;
    const a = amount.toFixed(2);

    container.innerHTML = '';

    if (!prof || (!prof.venmo && !prof.cashapp && !prof.zelle && !prof.applepay)) {
      const msg = document.createElement('span');
      msg.style.cssText = 'font-size:12px;color:#6E6B80;font-style:italic';
      msg.textContent = 'Ask ' + payerName + ' how they want to be paid';
      container.appendChild(msg);
      slot.setAttribute('data-rendered','1');
      return;
    }

    // Main "Pay" button
    const slotId = 'payopt-' + Math.random().toString(36).slice(2,8);
    const mainBtn = document.createElement('button');
    mainBtn.style.cssText = 'display:inline-flex;align-items:center;gap:8px;padding:10px 18px;background:linear-gradient(135deg,#30D158,#0EA5E9);border:none;border-radius:10px;font-family:inherit;font-size:14px;font-weight:700;color:#000;cursor:pointer';
    mainBtn.innerHTML = '💳 Pay ' + payerName + ' · $' + a + ' <span style="font-size:12px" id="' + slotId + '-arrow">▾</span>';

    // Options panel
    const panel = document.createElement('div');
    panel.id = slotId;
    panel.style.cssText = 'display:none;margin-top:10px;background:#0C0C12;border:1px solid rgba(255,255,255,0.1);border-radius:12px;overflow:hidden';

    const header = document.createElement('div');
    header.style.cssText = 'padding:10px 14px;font-size:11px;color:#6E6B80;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid rgba(255,255,255,0.06)';
    header.textContent = 'Choose how to pay ' + payerName;
    panel.appendChild(header);

    const methods = [];
    if (prof.venmo)    { const h=prof.venmo.replace('@','');    methods.push({ label:'Venmo',     sub:'@'+h,         color:'#0084FF', textColor:'#fff', icon:'V', href:'venmo://paycharge?txn=pay&recipients='+h+'&amount='+a+'&note=Trip', copy:null }); }
    if (prof.cashapp)  { const t=prof.cashapp.replace('$',''); methods.push({ label:'Cash App',  sub:'$'+t,         color:'#00D632', textColor:'#000', icon:'$', href:'https://cash.app/$'+t+'/'+a, copy:null }); }
    if (prof.zelle)    {                                        methods.push({ label:'Zelle',     sub:prof.zelle,    color:'#6D1ED4', textColor:'#fff', icon:'Z', href:null, copy:prof.zelle }); }
    if (prof.applepay) {                                        methods.push({ label:'Apple Pay', sub:prof.applepay, color:'#1a1a1a', textColor:'#fff', icon:'✦', href:null, copy:prof.applepay, border:'1px solid #555' }); }

    methods.forEach((m, mi) => {
      const row = document.createElement('a');
      row.href = m.href || '#';
      row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:14px 16px;text-decoration:none;' + (mi < methods.length-1 ? 'border-bottom:1px solid rgba(255,255,255,0.05);' : '');
      row.addEventListener('mouseover', () => { row.style.background = 'rgba(255,255,255,0.04)'; });
      row.addEventListener('mouseout',  () => { row.style.background = 'transparent'; });
      if (m.href && m.href.startsWith('http')) row.target = '_blank';
      if (!m.href && m.copy) {
        row.addEventListener('click', e => {
          e.preventDefault();
          navigator.clipboard.writeText(m.copy).then(() => toast(m.label + ' info copied!'));
        });
      }
      const icon = document.createElement('div');
      icon.style.cssText = 'width:36px;height:36px;border-radius:9px;background:' + m.color + ';' + (m.border||'') + 'display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:900;color:' + m.textColor + ';flex-shrink:0';
      icon.textContent = m.icon;
      const info = document.createElement('div');
      info.innerHTML = '<div style="font-size:14px;font-weight:700;color:#F0EEF8">' + m.label + '</div><div style="font-size:12px;color:#6E6B80">' + m.sub + (m.copy ? ' · tap to copy' : '') + '</div>';
      const amt = document.createElement('div');
      amt.style.marginLeft='auto'; amt.style.fontFamily='Bebas Neue,sans-serif'; amt.style.fontSize='20px'; amt.style.color='#30D158';
      amt.textContent = '$' + a;
      row.appendChild(icon); row.appendChild(info); row.appendChild(amt);
      panel.appendChild(row);
    });

    mainBtn.addEventListener('click', () => {
      const open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : 'block';
      const arrow = document.getElementById(slotId + '-arrow');
      if (arrow) arrow.textContent = open ? '▾' : '▴';
    });

    const wrap = document.createElement('div');
    wrap.appendChild(mainBtn);
    wrap.appendChild(panel);
    container.appendChild(wrap);
    slot.setAttribute('data-rendered','1');
  });
}

// Run after page loads and PAY_PROFILES is enriched from localStorage
setTimeout(renderPaySlots, 300);
// Also re-run when a receipt is expanded
// pay slots re-rendered on receipt expand — see toggleReceipt below

function retryLastScan() {
  if (imgBase64) {
    retryPendingScans();
  } else {
    toast('Please re-upload the receipt photo to retry', false);
  }
}

function toggleReceipts() {
  const body = document.getElementById('receipts-body');
  const btn  = document.getElementById('receipts-toggle');
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (btn) btn.textContent = open ? '▾ Show' : '▴ Hide';
}

function toggleReceipt(id) {
  const panel   = document.getElementById(id);
  const chevron = document.getElementById(id + '-chevron');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (chevron) {
    chevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
    chevron.style.background = isOpen ? 'rgba(255,255,255,0.05)' : 'rgba(48,209,88,0.12)';
    chevron.style.color = isOpen ? '#6E6B80' : '#30D158';
    chevron.textContent = '▾';
  }
  if (!isOpen) renderPaySlots(); // fill pay buttons when expanding
}

// ── MEMBER PROFILE MODAL ──
function openMemberProfile(name) {
  const allProfs = PAY_PROFILES;
  const profKey = Object.keys(allProfs).find(k => k.toLowerCase() === name.toLowerCase());
  const prof = profKey ? allProfs[profKey] : null;
  const modal = document.getElementById("member-profile-modal");
  const avEl = document.getElementById("mp-avatar");
  const colors = ["linear-gradient(135deg,#7C3AED,#A855F7)","linear-gradient(135deg,#E8633A,#FF6B35)","linear-gradient(135deg,#0EA5E9,#7C3AED)","linear-gradient(135deg,#30D158,#0EA5E9)","linear-gradient(135deg,#F59E0B,#EF4444)","linear-gradient(135deg,#EC4899,#8B5CF6)"];
  if (avEl) { if (prof?.avatar_url) { avEl.innerHTML = '<img src="'+prof.avatar_url+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">'; avEl.style.background="transparent"; } else { avEl.textContent=name[0].toUpperCase(); avEl.style.background=colors[name.charCodeAt(0)%colors.length]; } }
  const nameEl=document.getElementById("mp-name"); if(nameEl) nameEl.textContent=name;
  const ridEl=document.getElementById("mp-raven-id"); if(ridEl) ridEl.textContent=prof?.raven_id?"@"+prof.raven_id:"";
  const sinceEl=document.getElementById("mp-member-since"); if(sinceEl) { if(prof?.created_at){const d=new Date(prof.created_at);sinceEl.textContent="🪶 RAVEN member since "+d.toLocaleDateString("en-US",{month:"long",year:"numeric"});}else{sinceEl.textContent="🪶 RAVEN member";}}
  const chipsEl=document.getElementById("mp-payment-chips"); if(chipsEl){const chips=[];if(prof?.venmo)chips.push('<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 11px;background:#0084FF;border-radius:8px;font-size:12px;font-weight:700;color:#fff">V Venmo</span>');if(prof?.cashapp)chips.push('<span style="display:inline-flex;align-items:center;gap:5px;padding:5px 11px;background:#00D632;border-radius:8px;font-size:12px;font-weight:700;color:#000">$ Cash App</span>');if(prof?.zelle)chips.push('<span style="padding:5px 11px;background:#6D1ED4;border-radius:8px;font-size:12px;font-weight:700;color:#fff">Z Zelle</span>');if(prof?.applepay)chips.push('<span style="padding:5px 11px;background:#1a1a1a;border:1px solid #555;border-radius:8px;font-size:12px;font-weight:700;color:#fff">✦ Apple Pay</span>');chipsEl.innerHTML=chips.length?chips.join(""):'<span style="font-size:12px;color:#6E6B80">No payment methods set up</span>';}
  const actEl=document.getElementById("mp-actions"); if(actEl){actEl.innerHTML="";if(prof?.raven_id){const addBtn=document.createElement("button");addBtn.style.cssText="width:100%;padding:13px;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.3);border-radius:12px;font-family:inherit;font-size:14px;font-weight:700;color:#A855F7;cursor:pointer";addBtn.textContent="👥 Add Friend on RAVEN";addBtn.onclick=()=>{window.open("https://work46121-gif.github.io/raven-site/dashboard.html","_blank");toast("Search for @"+prof.raven_id+" in Friends");closeMemberProfile();};actEl.appendChild(addBtn);}const closeBtn=document.createElement("button");closeBtn.style.cssText="width:100%;padding:13px;background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:12px;font-family:inherit;font-size:14px;color:#6E6B80;cursor:pointer";closeBtn.textContent="Close";closeBtn.onclick=closeMemberProfile;actEl.appendChild(closeBtn);}
  if(modal) modal.classList.add("open");
}
function closeMemberProfile(){const m=document.getElementById("member-profile-modal");if(m)m.classList.remove("open");}

// ── EDIT RECEIPT ──
let _editReceiptId = null;
function openEditReceipt(id) {
  const r = receiptsDataMap[id];
  if (!r) { toast('Receipt data not found', false); return; }
  _editReceiptId = id;
  document.getElementById('edit-r-name').value = r.name;
  document.getElementById('edit-r-total').value = r.total;
  const sel = document.getElementById('edit-r-paidby');
  sel.value = r.paid_by || '';

  // Build people checkboxes
  const peopleContainer = document.getElementById('edit-r-people');
  peopleContainer.innerHTML = '';
  const currentSplitNames = Object.keys(r.splits || {}).map(k => k.toLowerCase());
  const avatarColors = ['#7C3AED','#E8633A','#0EA5E9','#30D158','#F59E0B','#EC4899','#14B8A6','#84CC16'];

  PEOPLE.forEach((person, i) => {
    const isOnReceipt = currentSplitNames.includes(person.toLowerCase());
    const currentAmt  = Object.entries(r.splits || {}).find(([k]) => k.toLowerCase() === person.toLowerCase());
    const amt = currentAmt ? parseFloat(currentAmt[1]).toFixed(2) : '0.00';

    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 14px;background:#0C0C12;border:1px solid rgba(255,255,255,0.08);border-radius:10px;cursor:pointer;transition:border-color 0.15s';
    row.innerHTML =
      '<input type="checkbox" name="edit-person" value="' + person + '" ' + (isOnReceipt ? 'checked' : '') + ' style="width:18px;height:18px;accent-color:#30D158;cursor:pointer;flex-shrink:0">' +
      '<div style="width:30px;height:30px;border-radius:50%;background:' + avatarColors[i % avatarColors.length] + ';display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0">' + person[0].toUpperCase() + '</div>' +
      '<span style="font-size:14px;font-weight:600;flex:1">' + person + '</span>' +
      '<span style="font-size:12px;color:#6E6B80">' + (isOnReceipt ? '$' + amt : 'not included') + '</span>';

    const cb = row.querySelector('input');
    cb.addEventListener('change', () => {
      row.style.borderColor = cb.checked ? 'rgba(48,209,88,0.3)' : 'rgba(255,255,255,0.08)';
      updateEditSplitPreview();
    });
    if (isOnReceipt) row.style.borderColor = 'rgba(48,209,88,0.3)';
    peopleContainer.appendChild(row);
  });

  updateEditSplitPreview();
  document.getElementById('edit-receipt-modal').classList.add('open');
}

function updateEditSplitPreview() {
  const total = parseFloat(document.getElementById('edit-r-total').value) || 0;
  const checked = [...document.querySelectorAll('input[name="edit-person"]:checked')].map(cb => cb.value);
  const preview = document.getElementById('edit-r-split-preview');
  const rows    = document.getElementById('edit-r-split-rows');
  if (!preview || !rows) return;
  if (checked.length === 0 || total === 0) { preview.style.display = 'none'; return; }
  const per = total / checked.length;
  preview.style.display = 'block';
  rows.innerHTML = checked.map(p =>
    '<div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:#9896A8">' + p + '</span><span style="color:#30D158;font-weight:600">$' + per.toFixed(2) + '</span></div>'
  ).join('');
}

function closeEditReceipt() {
  document.getElementById('edit-receipt-modal').classList.remove('open');
  _editReceiptId = null;
}

async function saveEditReceipt() {
  if (!_editReceiptId) return;
  const name   = document.getElementById('edit-r-name').value.trim() || 'Receipt';
  const paidBy = document.getElementById('edit-r-paidby').value;
  const total  = parseFloat(document.getElementById('edit-r-total').value) || 0;
  const btn    = document.getElementById('edit-r-save');

  // Build new splits from checked people
  const checked = [...document.querySelectorAll('input[name="edit-person"]:checked')].map(cb => cb.value);
  if (checked.length === 0) { toast('Select at least one person', false); return; }
  const per = total / checked.length;
  const splits = {};
  checked.forEach(p => { splits[p] = per; });

  btn.textContent = 'Saving...'; btn.disabled = true;
  try {
    const r = await fetch(BACKEND + '/trip/' + TRIP_ID + '/receipt/' + _editReceiptId + '/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TRIP_TOKEN, name, paid_by: paidBy || null, total, splits })
    });
    const d = await r.json();
    if (d.success) { closeEditReceipt(); toast('✅ Receipt updated!'); setTimeout(() => location.reload(), 900); }
    else { toast(d.error || 'Error saving', false); btn.textContent = 'Save Changes'; btn.disabled = false; }
  } catch(e) { toast('Network error', false); btn.textContent = 'Save Changes'; btn.disabled = false; }
}

// ── MODAL HELPERS ──
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

['settings-modal','add-members-modal','invite-modal'].forEach(id => {
  document.getElementById(id).addEventListener('click', function(e) {
    if (e.target === this) closeModal(id);
  });
});

document.getElementById('open-settings').addEventListener('click',    () => openModal('settings-modal'));
document.getElementById('close-settings-btn').addEventListener('click', () => closeModal('settings-modal'));
document.getElementById('open-share').addEventListener('click',        () => openModal('invite-modal'));
document.getElementById('open-invite').addEventListener('click',       () => openModal('invite-modal'));
document.getElementById('close-invite-btn').addEventListener('click',  () => closeModal('invite-modal'));
document.getElementById('open-add-members').addEventListener('click',  () => { newMembers=[]; renderNewMembers(); openModal('add-members-modal'); });
document.getElementById('close-members-btn').addEventListener('click', () => closeModal('add-members-modal'));

document.getElementById('open-receipt-btn').addEventListener('click',  () => { document.getElementById('receipt-form-wrap').style.display='block'; document.getElementById('open-receipt-btn').style.display='none'; setTimeout(()=>document.getElementById('receipt-form-wrap').scrollIntoView({behavior:'smooth',block:'start'}),50); });
document.getElementById('close-receipt-btn').addEventListener('click', () => { document.getElementById('receipt-form-wrap').style.display='none'; document.getElementById('open-receipt-btn').style.display='block'; });

// ── COVER PHOTO ──
(function(){
  const inp = document.getElementById('cover-upload');
  const btn = document.getElementById('cover-change-btn');
  const emp = document.getElementById('cover-empty');
  if (btn) btn.addEventListener('click', () => inp.click());
  if (emp) emp.addEventListener('click', () => inp.click());
  inp.addEventListener('change', function() {
    const file = this.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        const tw=800, th=400;
        let {width:w, height:h} = img;
        const scale = Math.max(tw/w, th/h);
        w=Math.round(w*scale); h=Math.round(h*scale);
        const c=document.createElement('canvas'); c.width=tw; c.height=th;
        c.getContext('2d').drawImage(img,(tw-w)/2,(th-h)/2,w,h);
        const resized = c.toDataURL('image/jpeg',0.88);
        const existing = document.getElementById('cover-img');
        if (existing) existing.src = resized;
        toast('Saving cover...');
        fetch(BACKEND+'/trip/'+TRIP_ID+'/cover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TRIP_TOKEN,image:resized.split(',')[1]})})
          .then(r=>r.json()).then(d=>{ if(d.success){toast('🖼 Cover saved!');setTimeout(()=>location.reload(),1200);}else toast(d.error||'Error',false); })
          .catch(()=>toast('Network error',false));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
})();

// ── SETTINGS ──
document.getElementById('save-settings-btn').addEventListener('click', async function() {
  const name = document.getElementById('settings-name').value.trim();
  const date = document.getElementById('settings-date').value;
  if (!name) { toast('Trip name cannot be empty', false); return; }
  this.textContent = 'Saving...'; this.disabled = true;
  try {
    const r = await fetch(BACKEND+'/trip/'+TRIP_ID+'/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TRIP_TOKEN,name,trip_date:date||null})});
    const d = await r.json();
    if (d.success) { toast('✅ Trip updated!'); setTimeout(()=>location.reload(),1200); }
    else toast(d.error||'Error',false);
  } catch(e) { toast('Network error',false); }
  this.textContent='💾 Save Changes'; this.disabled=false;
});

// ── COPY / SHARE ──
document.getElementById('copy-trip-btn').addEventListener('click',    () => navigator.clipboard.writeText(TRIP_URL).then(()=>toast('Trip link copied!')).catch(()=>prompt('Copy:',TRIP_URL)));
document.getElementById('share-trip-btn').addEventListener('click',   () => { if(navigator.share)navigator.share({title:TRIP_NAME,url:TRIP_URL}).catch(()=>navigator.clipboard.writeText(TRIP_URL));else navigator.clipboard.writeText(TRIP_URL).then(()=>toast('Copied!')); });
document.getElementById('copy-invite-btn').addEventListener('click',  () => navigator.clipboard.writeText(INVITE_URL).then(()=>toast('Invite link copied!')).catch(()=>prompt('Copy:',INVITE_URL)));
document.getElementById('share-invite-btn').addEventListener('click', () => { if(navigator.share)navigator.share({title:'Join '+TRIP_NAME+' on RAVEN',url:INVITE_URL}).catch(()=>navigator.clipboard.writeText(INVITE_URL));else navigator.clipboard.writeText(INVITE_URL).then(()=>toast('Copied!')); });

// ── ADD MEMBERS ──
document.getElementById('add-member-btn').addEventListener('click', addNewMember);
document.getElementById('new-member-input').addEventListener('keydown', e => { if(e.key==='Enter') addNewMember(); });

function addNewMember() {
  const inp  = document.getElementById('new-member-input');
  const name = inp.value.trim();
  if (!name) return;
  if (PEOPLE.some(p=>p.toLowerCase()===name.toLowerCase())) { toast('Already on this trip',false); return; }
  if (newMembers.some(p=>p.toLowerCase()===name.toLowerCase())) { toast('Already added',false); return; }
  newMembers.push(name); inp.value=''; renderNewMembers();
}
function renderNewMembers() {
  const c   = document.getElementById('new-members-list');
  const btn = document.getElementById('save-members-btn');
  c.innerHTML = '';
  newMembers.forEach(n => {
    const d = document.createElement('div');
    d.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(48,209,88,0.05);border:1px solid rgba(48,209,88,0.2);border-radius:10px';
    d.innerHTML = '<div style="display:flex;align-items:center;gap:9px"><div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#30D158,#0EA5E9);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff">' + n[0].toUpperCase() + '</div><span style="font-size:13px;font-weight:600;color:#F0EEF8">' + n.replace(/</g,'&lt;') + '</span></div>';
    const x = document.createElement('button');
    x.textContent = '×'; x.style.cssText = 'background:none;border:none;color:#6E6B80;cursor:pointer;font-size:18px;padding:0';
    x.addEventListener('click', () => { newMembers=newMembers.filter(p=>p!==n); renderNewMembers(); });
    d.appendChild(x); c.appendChild(d);
  });
  btn.style.display = newMembers.length>0 ? 'block' : 'none';
}
document.getElementById('save-members-btn').addEventListener('click', async function() {
  this.textContent='Saving...'; this.disabled=true;
  try {
    const r = await fetch(BACKEND+'/trip/'+TRIP_ID+'/add-members',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TRIP_TOKEN,members:newMembers})});
    const d = await r.json();
    if (d.success) { toast('✅ Members added!'); setTimeout(()=>location.reload(),1200); }
    else { toast(d.error||'Error',false); this.textContent='✓ Save'; this.disabled=false; }
  } catch(e) { toast('Network error',false); this.textContent='✓ Save'; this.disabled=false; }
});

// ── GIF ──
document.getElementById('gif-toggle-btn').addEventListener('click', () => {
  gifPanelOpen = !gifPanelOpen;
  document.getElementById('gif-panel').style.display = gifPanelOpen ? 'block' : 'none';
  document.getElementById('gif-toggle-btn').style.color = gifPanelOpen ? '#30D158' : '#6E6B80';
  if (gifPanelOpen) document.getElementById('gif-search').focus();
});
document.getElementById('gif-clear-btn').addEventListener('click', clearGif);
function clearGif() {
  gifUrl = null;
  document.getElementById('gif-preview-wrap').style.display = 'none';
  document.getElementById('gif-preview-img').src = '';
}
document.getElementById('gif-search').addEventListener('input', function() { searchGifs(this.value); });
function searchGifs(q) {
  clearTimeout(gifTimer);
  const container = document.getElementById('gif-results');
  if (!q.trim()) { container.innerHTML='<div style="color:#6E6B80;font-size:12px;padding:8px 0">Type to search...</div>'; return; }
  container.innerHTML='<div style="color:#6E6B80;font-size:12px;padding:8px 0">Searching...</div>';
  gifTimer = setTimeout(() => {
    fetch(BACKEND+'/gif-search?q='+encodeURIComponent(q))
      .then(r=>r.json()).then(d=>{
        const gifs = d.gifs||[];
        if (!gifs.length) { container.innerHTML='<div style="color:#6E6B80;font-size:12px;padding:8px 0">No results</div>'; return; }
        container.innerHTML='';
        gifs.forEach(g => {
          const url = g.preview||g.full||''; if (!url) return;
          const img = document.createElement('img');
          img.src = url; img.style.cssText='height:80px;width:auto;border-radius:6px;cursor:pointer;object-fit:cover;border:2px solid transparent';
          img.addEventListener('mouseover',function(){this.style.borderColor='#30D158';});
          img.addEventListener('mouseout', function(){this.style.borderColor='transparent';});
          img.addEventListener('click', () => {
            gifUrl = g.full||url;
            document.getElementById('gif-preview-img').src = gifUrl;
            document.getElementById('gif-preview-wrap').style.display = 'block';
            gifPanelOpen=false;
            document.getElementById('gif-panel').style.display='none';
            document.getElementById('gif-toggle-btn').style.color='#6E6B80';
            document.getElementById('gif-search').value='';
            container.innerHTML='';
            toast('GIF selected ✓');
          });
          container.appendChild(img);
        });
      }).catch(()=>{ container.innerHTML='<div style="color:#FF6B6B;font-size:12px;padding:8px 0">Error loading GIFs</div>'; });
  }, 500);
}

// ── POST COMMENT ──
document.getElementById('post-comment-btn').addEventListener('click', async function() {
  const author = document.getElementById('comment-author').value.trim();
  const body   = document.getElementById('comment-body').value.trim();
  if (!author) { toast('Enter your name',false); return; }
  if (!body && !gifUrl) { toast('Add a message or GIF',false); return; }
  try { sessionStorage.setItem('raven_trip_name', author); } catch(e) {}
  this.textContent='Posting...'; this.disabled=true;
  try {
    const r = await fetch(BACKEND+'/trip/'+TRIP_ID+'/comment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TRIP_TOKEN,author_name:author,body,gif_url:gifUrl||null})});
    const d = await r.json();
    if (d.success) { document.getElementById('comment-body').value=''; clearGif(); toast('✅ Posted!'); setTimeout(()=>location.reload(),900); }
    else toast(d.error||'Error',false);
  } catch(e) { toast('Network error',false); }
  this.textContent='💬 Post'; this.disabled=false;
});

// ── RECEIPT SPLIT ──
document.getElementById('r-btn-e').addEventListener('click', () => setSplit('even'));
document.getElementById('r-btn-i').addEventListener('click', () => setSplit('itemized'));
document.getElementById('r-total').addEventListener('input', updateEven);
document.getElementById('r-add-item').addEventListener('click', addItem);
document.getElementById('r-drop').addEventListener('click', () => document.getElementById('r-file').click());
document.getElementById('r-file').addEventListener('change', function() { if(this.files[0]) tripPhoto(this.files[0]); });
document.getElementById('r-save').addEventListener('click', saveReceipt);

function setSplit(t) {
  splitType=t;
  document.getElementById('r-even-sec').style.display = t==='even'?'block':'none';
  document.getElementById('r-item-sec').style.display = t==='itemized'?'block':'none';
  document.getElementById('r-btn-e').className = 'spl'+(t==='even'?' ae':'');
  document.getElementById('r-btn-i').className = 'spl'+(t==='itemized'?' ai':'');
}
function updateEven() {
  const v=parseFloat(document.getElementById('r-total').value)||0, per=v/PEOPLE.length;
  document.getElementById('r-even-prev').style.display = v>0?'block':'none';
  PEOPLE.forEach(p => {
    const id = 'ep-'+p.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
    const el = document.getElementById(id);
    if (el) el.textContent = '$'+per.toFixed(2);
  });
}
function addItem() {
  const n=document.getElementById('r-iname').value.trim(), p=parseFloat(document.getElementById('r-iprice').value);
  if (!n||isNaN(p)||p<=0) return;
  tripItems.push({id:Date.now(),name:n,price:p,assignees:[]});
  document.getElementById('r-iname').value=''; document.getElementById('r-iprice').value='';
  renderItems();
}
function renderItems() {
  const container = document.getElementById('r-items-list');
  container.innerHTML='';
  tripItems.forEach(item => {
    const d = document.createElement('div');
    d.style.cssText='background:#13131A;border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:10px 12px';
    const row = document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:8px;margin-bottom:8px';
    const nameSpan=document.createElement('span'); nameSpan.style.cssText='flex:1;font-size:13px;font-weight:500'; nameSpan.textContent=item.name;
    const priceSpan=document.createElement('span'); priceSpan.style.cssText='font-family:monospace;font-size:13px;color:#9896A8'; priceSpan.textContent='$'+item.price.toFixed(2);
    const del=document.createElement('button'); del.textContent='×'; del.style.cssText='background:none;border:none;color:#6E6B80;cursor:pointer;font-size:16px;flex-shrink:0';
    del.addEventListener('click',()=>{ tripItems=tripItems.filter(i=>i.id!==item.id); renderItems(); });
    row.appendChild(nameSpan); row.appendChild(priceSpan); row.appendChild(del);
    const btns=document.createElement('div'); btns.style.cssText='display:flex;gap:6px;flex-wrap:wrap';
    PEOPLE.forEach(p => {
      const on=item.assignees.includes(p);
      const b=document.createElement('button');
      b.textContent=(on?'✓ ':'')+p;
      b.style.cssText='padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;background:'+(on?'rgba(48,209,88,0.15)':'rgba(255,255,255,0.05)')+';border:1px solid '+(on?'rgba(48,209,88,0.3)':'rgba(255,255,255,0.1)')+';color:'+(on?'#30D158':'#9896A8');
      b.addEventListener('click',()=>{
        if(item.assignees.includes(p)) item.assignees=item.assignees.filter(a=>a!==p); else item.assignees.push(p);
        renderItems();
      });
      btns.appendChild(b);
    });
    d.appendChild(row); d.appendChild(btns); container.appendChild(d);
  });
}

function tripPhoto(file) {
  const reader=new FileReader();
  reader.onload=function(e){
    document.getElementById('r-preview').src=e.target.result;
    document.getElementById('r-preview').style.display='block';
    document.getElementById('r-empty').style.display='none';
    const img=new Image();
    img.onload=function(){
      let{width:w,height:h}=img;
      if(w>1600||h>1600){if(w>h){h=Math.round(h*1600/w);w=1600;}else{w=Math.round(w*1600/h);h=1600;}}
      const c=document.createElement('canvas');c.width=w;c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      imgBase64=c.toDataURL('image/jpeg',0.88).split(',')[1];

      // ── SAVE TO LOCALSTORAGE IMMEDIATELY ──
      // Receipt photo is stored offline as soon as it's uploaded.
      // If AI scan fails, it can be retried later — photo is never lost.
      try {
        const pending = JSON.parse(localStorage.getItem('raven_pending_receipts') || '[]');
        const pendingId = 'pending_' + Date.now();
        pending.push({
          id: pendingId,
          tripId: TRIP_ID,
          tripToken: TRIP_TOKEN,
          imageBase64: imgBase64,
          mediaType: file.type || 'image/jpeg',
          savedAt: new Date().toISOString(),
          scanned: false
        });
        // Keep max 10 pending receipts (each ~200kb compressed)
        if (pending.length > 10) pending.shift();
        localStorage.setItem('raven_pending_receipts', JSON.stringify(pending));
        window._currentPendingId = pendingId;
      } catch(storageErr) { console.warn('Could not save receipt offline:', storageErr); }

      const st=document.getElementById('r-scan-status');
      st.style.display='block';
      st.innerHTML='<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);border-radius:8px"><div class="spinner"></div><span style="font-size:13px;color:#C084FC;font-weight:600">Waking up AI server...</span></div>';

      // Wake server then scan with retry (handles Railway cold starts)
      async function doScan(attempt) {
        if (attempt === 1) {
          // Ping server to wake from sleep
          try { await Promise.race([fetch(BACKEND+'/'), new Promise(r=>setTimeout(r,20000))]); } catch(e) {}
          st.innerHTML='<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);border-radius:8px"><div class="spinner"></div><span style="font-size:13px;color:#C084FC;font-weight:600">Scanning receipt with AI...</span></div>';
        } else {
          st.innerHTML='<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);border-radius:8px"><div class="spinner"></div><span style="font-size:13px;color:#C084FC;font-weight:600">Retrying... (attempt '+attempt+' of 3)</span></div>';
          await new Promise(r=>setTimeout(r,2000));
        }
        const controller = new AbortController();
        const timer = setTimeout(()=>controller.abort(), 60000);
        try {
          const r = await fetch(BACKEND+'/demo/scan-receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:imgBase64,mediaType:file.type||'image/jpeg'}),signal:controller.signal});
          clearTimeout(timer);
          const d = await r.json();
          if(d.success&&d.items&&d.items.length){
            if(!document.getElementById('r-name').value&&d.bill_name) document.getElementById('r-name').value=d.bill_name;
            const tot=d.total||d.items.reduce((s,i)=>s+i.price,0);
            document.getElementById('r-total').value=tot.toFixed(2); updateEven();
            tripItems=d.items.map((item,idx)=>({id:Date.now()+idx,name:item.name,price:parseFloat(item.price)||0,assignees:[]}));
            setSplit('itemized'); renderItems();
            st.innerHTML='<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(48,209,88,0.08);border:1px solid rgba(48,209,88,0.2);border-radius:8px"><span>✅</span><span style="font-size:13px;color:#30D158;font-weight:600">'+d.items.length+' items found! Photo saved 📸</span></div>';
            // Mark pending receipt as successfully scanned
            try {
              const pid = window._currentPendingId;
              if (pid) {
                const pending = JSON.parse(localStorage.getItem('raven_pending_receipts')||'[]');
                const idx = pending.findIndex(p=>p.id===pid);
                if (idx>=0) { pending[idx].scanned=true; localStorage.setItem('raven_pending_receipts', JSON.stringify(pending)); }
              }
            } catch(e) {}
          } else if (attempt < 3) {
            return doScan(attempt+1);
          } else {
            st.innerHTML='<div style="padding:10px 14px;background:rgba(255,107,53,0.07);border:1px solid rgba(255,107,53,0.25);border-radius:8px">'
              +'<div style="font-size:13px;color:#FF6B35;font-weight:600;margin-bottom:6px">AI could not read it — but your photo is saved!</div>'
              +'<div style="font-size:12px;color:#9896A8;margin-bottom:8px">You can enter amounts manually now, or tap Retry Scan later when the server is back.</div>'
              +'<button onclick="retryLastScan()" style="padding:6px 14px;background:rgba(255,107,53,0.12);border:1px solid rgba(255,107,53,0.3);border-radius:7px;color:#FF6B35;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer">↻ Retry Scan</button>'
              +'</div>';
          }
        } catch(e) {
          clearTimeout(timer);
          if (attempt < 3) return doScan(attempt+1);
          st.innerHTML='<div style="padding:10px 14px;background:rgba(255,107,53,0.07);border:1px solid rgba(255,107,53,0.25);border-radius:8px">'
            +'<div style="font-size:13px;color:#FF6B35;font-weight:600;margin-bottom:6px">⚠️ Server waking up — photo is saved!</div>'
            +'<div style="font-size:12px;color:#9896A8;margin-bottom:8px">Your receipt photo is stored on this device. Enter details manually or retry the scan.</div>'
            +'<button onclick="retryLastScan()" style="padding:6px 14px;background:rgba(255,107,53,0.12);border:1px solid rgba(255,107,53,0.3);border-radius:7px;color:#FF6B35;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer">↻ Retry Scan</button>'
            +'</div>';
        }
      }
      doScan(1);
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}

async function saveReceipt() {
  const name=document.getElementById('r-name').value.trim()||'Receipt';
  const paidBy=(document.getElementById('r-paidby')||{}).value||'';
  const btn=document.getElementById('r-save');
  btn.textContent='Saving...'; btn.disabled=true;
  let total=0, splits={};
  if(splitType==='even'){
    total=parseFloat(document.getElementById('r-total').value)||0;
    if(total<=0){btn.textContent='Save Receipt';btn.disabled=false;toast('Enter a total amount',false);return;}
    const per=total/PEOPLE.length; PEOPLE.forEach(p=>{splits[p]=per;});
  } else {
    PEOPLE.forEach(p=>{splits[p]=0;});
    tripItems.forEach(item=>{const as=item.assignees.length>0?item.assignees:PEOPLE;const sh=item.price/as.length;as.forEach(p=>{splits[p]=(splits[p]||0)+sh;});total+=item.price;});
    if(total<=0){btn.textContent='Save Receipt';btn.disabled=false;toast('Add at least one item',false);return;}
  }
  try{
    const r=await fetch(BACKEND+'/trip/'+TRIP_ID+'/receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,total,splits,token:TRIP_TOKEN,items:splitType==='itemized'?tripItems:[],paid_by:paidBy||null})});
    const d=await r.json();
    if(d.success){toast('✅ Receipt saved!');setTimeout(()=>location.reload(),1200);}
    else{btn.textContent='Save Receipt';btn.disabled=false;toast(d.error||'Error',false);}
  }catch(e){btn.textContent='Save Receipt';btn.disabled=false;toast('Network error',false);}
}
</script>
</body>
</html>`);
});


// ── TRIP COMMENT ──────────────────────────────────────────────────────────────
app.post('/trip/:tripId/comment', async (req, res) => {
  try {
    const { tripId } = req.params;
    const { token, author_name, body, gif_url } = req.body;
    const { data: trip } = await supabase.from('trips').select('share_token').eq('id', tripId).single();
    if (!trip || trip.share_token !== token) return res.json({ success: false, error: 'Invalid token' });
    if (!body?.trim() && !gif_url) return res.json({ success: false, error: 'Empty comment' });
    await supabase.from('trip_comments').insert({
      trip_id: tripId,
      author_name: author_name || 'Anonymous',
      body: body?.trim() || '',
      gif_url: gif_url || null,
      created_at: new Date().toISOString()
    });
    res.json({ success: true });
  } catch(err) { res.json({ success: false, error: err.message }); }
});

// ── TRIP SETTINGS ─────────────────────────────────────────────────────────────
app.post('/trip/:tripId/settings', async (req, res) => {
  try {
    const { tripId } = req.params;
    const { token, name, trip_date } = req.body;
    const { data: trip } = await supabase.from('trips').select('share_token').eq('id', tripId).single();
    if (!trip || trip.share_token !== token) return res.json({ success: false, error: 'Invalid token' });
    if (!name?.trim()) return res.json({ success: false, error: 'Name required' });
    const update = { name: name.trim() };
    if (trip_date) update.trip_date = trip_date;
    else update.trip_date = null;
    await supabase.from('trips').update(update).eq('id', tripId);
    res.json({ success: true });
  } catch(err) { res.json({ success: false, error: err.message }); }
});

// ── TRIP COVER PHOTO ──────────────────────────────────────────────────────────
app.post('/trip/:tripId/cover', async (req, res) => {
  try {
    const { tripId } = req.params;
    const { token, image } = req.body;
    const { data: trip } = await supabase.from('trips').select('share_token').eq('id', tripId).single();
    if (!trip || trip.share_token !== token) return res.json({ success: false, error: 'Invalid token' });
    if (!image) return res.json({ success: false, error: 'No image' });
    await supabase.from('trips').update({ cover_image: image }).eq('id', tripId);
    res.json({ success: true });
  } catch(err) { res.json({ success: false, error: err.message }); }
});

// ── ADD MEMBERS TO TRIP ────────────────────────────────────────────────────────
app.post('/trip/:tripId/add-members', async (req, res) => {
  try {
    const { tripId } = req.params;
    const { token, members } = req.body;
    const { data: trip } = await supabase.from('trips').select('*').eq('id', tripId).single();
    if (!trip) return res.json({ success: false, error: 'Trip not found' });
    if (trip.share_token !== token) return res.json({ success: false, error: 'Invalid token' });
    const existing = Array.isArray(trip.people) ? trip.people : JSON.parse(trip.people || '[]');
    const newPeople = [...existing];
    for (const m of (members || [])) {
      if (m && !newPeople.map(p => p.toLowerCase()).includes(m.toLowerCase())) {
        newPeople.push(m);
      }
    }
    await supabase.from('trips').update({ people: JSON.stringify(newPeople) }).eq('id', tripId);
    res.json({ success: true, people: newPeople });
  } catch(err) {
    console.error('Add members error:', err);
    res.json({ success: false, error: err.message });
  }
});

app.post('/trip/:tripId/join', async (req, res) => {
  try {
    const { tripId } = req.params;
    const { invite_token, user_email, display_name } = req.body;
    if (!invite_token || !user_email) return res.json({ success: false, error: 'Missing fields' });
    const { data: trip } = await supabase.from('trips').select('*').eq('id', tripId).single();
    if (!trip) return res.json({ success: false, error: 'Trip not found' });
    if (trip.invite_token !== invite_token) return res.json({ success: false, error: 'Invalid invite token' });

    // Add person's display name to the trip people array if provided and not already there
    const existing = Array.isArray(trip.people) ? trip.people : JSON.parse(trip.people || '[]');
    const newPeople = [...existing];
    if (display_name && !newPeople.map(p => p.toLowerCase()).includes(display_name.toLowerCase())) {
      newPeople.push(display_name);
    }

    // Store the joining user's email in a member_emails JSON array on the trip row itself
    // This avoids needing a separate trip_members table
    let memberEmails = [];
    try { memberEmails = Array.isArray(trip.member_emails) ? trip.member_emails : JSON.parse(trip.member_emails || '[]'); } catch(e) {}
    const emailLower = user_email.toLowerCase();
    if (!memberEmails.includes(emailLower)) memberEmails.push(emailLower);

    // Update people list and member_emails together
    await supabase.from('trips').update({
      people: JSON.stringify(newPeople),
      member_emails: JSON.stringify(memberEmails)
    }).eq('id', tripId);

    // Also try trip_members table if it exists — gracefully ignore if it doesn't
    try {
      await supabase.from('trip_members').upsert({
        trip_id: tripId,
        user_email: emailLower,
        joined_at: new Date().toISOString()
      }, { onConflict: 'trip_id,user_email' });
    } catch(e) { /* table may not exist yet, that's ok */ }

    res.json({ success: true, share_token: trip.share_token, trip_name: trip.name, people: newPeople });
  } catch(err) {
    console.error('Join trip error:', err);
    res.json({ success: false, error: err.message });
  }
});

app.post('/trip/:tripId/receipt', async (req, res) => {
  try {
    const { tripId } = req.params;
    const { name, total, splits, token, items, paid_by } = req.body;
    const { data: trip } = await supabase.from('trips').select('*').eq('id', tripId).single();
    if (!trip) return res.json({ success: false, error: 'Trip not found' });
    if (trip.share_token !== token) return res.json({ success: false, error: 'Invalid token' });
    await supabase.from('trip_receipts').insert({ trip_id: tripId, name: name||'Receipt', total: parseFloat(total)||0, splits: JSON.stringify(splits||{}), items: JSON.stringify(items||[]), paid_by: paid_by||null, created_at: new Date().toISOString() });
    const { data: all } = await supabase.from('trip_receipts').select('total').eq('trip_id', tripId);
    const newTotal = (all||[]).reduce((s,r) => s+parseFloat(r.total||0), 0);
    await supabase.from('trips').update({ total: newTotal, receipt_count: (all||[]).length }).eq('id', tripId);
    res.json({ success: true });
  } catch(err) { console.error('Trip receipt error:', err); res.json({ success: false, error: err.message }); }
});

// ── EDIT RECEIPT ──────────────────────────────────────────────────────────────
app.post('/trip/:tripId/receipt/:receiptId/edit', async (req, res) => {
  try {
    const { tripId, receiptId } = req.params;
    const { token, name, paid_by, total, splits } = req.body;
    const { data: trip } = await supabase.from('trips').select('share_token').eq('id', tripId).single();
    if (!trip || trip.share_token !== token) return res.json({ success: false, error: 'Invalid token' });
    const updates = {};
    if (name    !== undefined) updates.name    = name || 'Receipt';
    if (paid_by !== undefined) updates.paid_by = paid_by || null;
    if (total   !== undefined) updates.total   = parseFloat(total) || 0;
    if (splits  !== undefined) updates.splits  = JSON.stringify(splits);
    await supabase.from('trip_receipts').update(updates).eq('id', receiptId).eq('trip_id', tripId);
    // Recalculate trip total
    const { data: all } = await supabase.from('trip_receipts').select('total').eq('trip_id', tripId);
    const newTotal = (all||[]).reduce((s,r) => s + parseFloat(r.total||0), 0);
    await supabase.from('trips').update({ total: newTotal }).eq('id', tripId);
    res.json({ success: true });
  } catch(err) { console.error('Edit receipt error:', err); res.json({ success: false, error: err.message }); }
});

// ─── TRIP INFO (public — used by invite join banner) ─────────────────────────
app.get('/trip-info/:tripId', async (req, res) => {
  try {
    const { tripId } = req.params;
    const { token } = req.query;
    const { data: trip } = await supabase.from('trips').select('name, invite_token, people').eq('id', tripId).single();
    if (!trip) return res.json({ success: false });
    if (trip.invite_token !== token) return res.json({ success: false });
    const people = Array.isArray(trip.people) ? trip.people : JSON.parse(trip.people || '[]');
    res.json({ success: true, name: trip.name, people_count: people.length });
  } catch(err) { res.json({ success: false }); }
});

// ─── TRIP COVER IMAGE (served as JPEG for OG/iMessage preview) ───────────────
app.get('/trip/:tripId/cover-image', async (req, res) => {
  try {
    const { tripId } = req.params;
    const { data: trip } = await supabase.from('trips').select('cover_image').eq('id', tripId).single();
    if (!trip || !trip.cover_image) return res.status(404).send('No cover image');
    const buf = Buffer.from(trip.cover_image, 'base64');
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  } catch(err) { res.status(500).send('Error'); }
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

// ─── DEMO SCAN RECEIPT ────────────────────────────────────────────────────────
app.post('/demo/scan-receipt', async (req, res) => {
  try {
    const { image, mediaType } = req.body;
    if (!image) return res.json({ success: false, error: 'No image provided' });

    const validTypes = ['image/jpeg','image/png','image/gif','image/webp'];
    const mt = validTypes.includes(mediaType) ? mediaType : 'image/jpeg';

    const message = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mt, data: image } },
          { type: 'text', text: 'Parse this receipt image and return ONLY a JSON object with no markdown or extra text:\n{"bill_name":"Store name","items":[{"name":"Item","price":0.00}],"subtotal":0.00,"tax":0.00,"tip":0.00,"total":0.00}\nReturn your best attempt even if unclear. ONLY the JSON object.' }
        ]
      }]
    });

    const raw = message.content[0]?.text || '';
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error('Scan: no JSON in response:', raw.slice(0, 200));
      return res.json({ success: false, error: 'Could not read receipt — try a clearer photo' });
    }
    const parsed = JSON.parse(match[0]);
    console.log('Scan success:', parsed.bill_name, parsed.items?.length, 'items');
    res.json({ success: true, ...parsed });
  } catch(err) {
    console.error('Scan error:', err.status, err.message);
    if (err.status === 401) return res.json({ success: false, error: 'API key issue — contact support' });
    if (err.status === 429) return res.json({ success: false, error: 'Rate limited — wait a moment and retry' });
    if (err.status === 529) return res.json({ success: false, error: 'AI overloaded — retrying shortly' });
    res.json({ success: false, error: err.message || 'Scan failed' });
  }
});

app.get('/ping', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.get('/', (req, res) => {
  res.json({ status: 'RAVEN is live 🪶', version: '2.0.0', twilio: TWILIO_READY ? 'connected' : 'pending' });
});

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
    res.json({ success: true });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🪶 RAVEN SMS server running on port ${PORT}`));
