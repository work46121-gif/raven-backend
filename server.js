require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

// Sentry — backend error monitoring
// Run: npm install @sentry/node
// Replace YOUR_SENTRY_DSN with your DSN from sentry.io → Settings → Projects → Client Keys
let Sentry = null;
try {
  Sentry = require('@sentry/node');
  Sentry.init({
    dsn: process.env.SENTRY_DSN || 'YOUR_SENTRY_DSN',
    environment: process.env.NODE_ENV || 'production',
    release: 'raven@2.0.0',
    tracesSampleRate: 0.1,
  });
  console.log('✅ Sentry initialized');
} catch(e) {
  console.log('⚠️  Sentry not installed — run: npm install @sentry/node');
}

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

  // If bill.paid_by is set, look up that person's profile — they're who everyone needs to pay
  let payerProfile = null;
  const paidByName = bill.paid_by || null;
  if (paidByName) {
    const r = await supabase.from('profiles').select('first_name,venmo,cashapp,zelle,applepay').ilike('first_name', paidByName).maybeSingle();
    payerProfile = r.data;
  }
  const billPayerProfile = payerProfile || creatorProfile;
  if (billPayerProfile && paidByName) billPayerProfile.first_name = paidByName;

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
    const amount = parseFloat(p.amount || 0);
    if (myItems.length === 0) {
      if (amount <= 0) return '';
      return '<div style="margin-top:6px;background:rgba(255,255,255,0.03);border-radius:8px;padding:8px 10px"><div style="display:flex;justify-content:space-between"><span style="font-size:11px;font-weight:700;color:#F0EEF8">Total</span><span style="font-size:12px;font-weight:700;color:#30D158;font-family:monospace">$' + amount.toFixed(2) + '</span></div></div>';
    }
    const tax = parseFloat(bill.tax || 0);
    const tip = parseFloat(bill.tip || 0);
    const billSubtotal = items.reduce((s,i) => s + parseFloat(i.price||0), 0);
    const itemsTotal = myItems.reduce((s, i) => s + i.price / i.splitWith, 0);
    // Proportional tax/tip — person with bigger order pays more
    const proportion = billSubtotal > 0 ? itemsTotal / billSubtotal : (participantCount > 0 ? 1/participantCount : 0);
    const myTax = tax * proportion;
    const myTip = tip * proportion;

    let rows = myItems.map(i => {
      const share = (i.price / i.splitWith).toFixed(2);
      const split = i.splitWith > 1 ? ` <span style="color:#9896A8;font-size:10px">(÷${i.splitWith})</span>` : '';
      return `<div style="display:flex;justify-content:space-between;padding:3px 0"><span style="font-size:11px;color:#6E6B80">${i.name}${split}</span><span style="font-size:11px;color:#9896A8;font-family:monospace">$${share}</span></div>`;
    }).join('');

    let shared_rows = '';
    if (tax) shared_rows += `<div style="display:flex;justify-content:space-between;padding:2px 0"><span style="font-size:11px;color:#6E6B80">Tax</span><span style="font-size:11px;color:#9896A8;font-family:monospace">$${myTax.toFixed(2)}</span></div>`;
    if (tip) shared_rows += `<div style="display:flex;justify-content:space-between;padding:2px 0"><span style="font-size:11px;color:#6E6B80">Tip</span><span style="font-size:11px;color:#9896A8;font-family:monospace">$${myTip.toFixed(2)}</span></div>`;
    const divider = shared_rows ? `<div style="border-top:1px solid rgba(255,255,255,0.06);margin-top:4px;padding-top:4px">${shared_rows}</div>` : '';

    return `<div style="margin-top:8px;background:rgba(255,255,255,0.03);border-radius:8px;padding:8px 10px">${rows}${divider}<div style="border-top:1px solid rgba(255,255,255,0.08);margin-top:4px;padding-top:5px;display:flex;justify-content:space-between"><span style="font-size:11px;font-weight:700;color:#F0EEF8">Total</span><span style="font-size:12px;font-weight:700;color:#30D158;font-family:monospace">$${amount.toFixed(2)}</span></div></div>`;
  }

  const paidByLower = (bill.paid_by || '').toLowerCase();
  const participantsHTML = participants.length > 0 ? `
    <div style="max-width:800px;margin:20px auto 0;padding:0 20px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6E6B80;font-weight:600;margin-bottom:10px">Who owes what</div>
      ${paidByLower ? `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);border-radius:10px;margin-bottom:10px"><span style="font-size:18px">💳</span><div><div style="font-size:13px;font-weight:700;color:#C084FC">${bill.paid_by} paid the bill</div><div style="font-size:11px;color:#6E6B80">Everyone else owes them their share</div></div></div>` : ''}
      <div style="background:#0C0C12;border:1px solid rgba(255,255,255,0.07);border-radius:16px;overflow:hidden">
        ${participants.map(p => {
          const myItems = participantItems[p.name.toLowerCase()] || [];
          const safeName = p.name.replace(/"/g, '&quot;');
          const breakdownHTML = buildBreakdown(p, myItems, bill, participants.length);
          const isBillPayer = paidByLower && p.name.toLowerCase() === paidByLower;
          let statusEl, actionEl;
          if (isBillPayer) {
            statusEl = `<div id="pstatus-${p.id}" style="font-size:12px;color:#C084FC;margin-top:2px">💳 Paid the bill</div>`;
            actionEl = `<span style="font-size:20px">💳</span>`;
          } else if (p.paid) {
            statusEl = `<div id="pstatus-${p.id}" style="font-size:12px;color:#30D158;margin-top:2px">✅ Paid</div>`;
            actionEl = `<span style="font-size:18px">✅</span>`;
          } else {
            statusEl = `<div id="pstatus-${p.id}" style="font-size:12px;color:#6E6B80;margin-top:2px">Owes $${parseFloat(p.amount).toFixed(2)}</div>`;
            actionEl = `<button onclick="showPay(this)" data-pid="${p.id}" data-name="${safeName}" data-amount="${parseFloat(p.amount).toFixed(2)}" id="paybtn-${p.id}" style="padding:9px 18px;background:#30D158;border:none;border-radius:10px;color:#000;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;flex-shrink:0;margin-top:2px">💳 Pay</button>`;
          }
          return `<div id="prow-${p.id}" style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.05)">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
              <div style="min-width:0;flex:1">
                <div style="font-size:15px;font-weight:600;color:#F0EEF8">${p.name}</div>
                ${statusEl}
                ${breakdownHTML}
              </div>
              ${actionEl}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  const itemsListHTML = items.length > 0 ? `
    <div style="max-width:800px;margin:20px auto 0;padding:0 20px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#6E6B80;font-weight:600;margin-bottom:10px">Items</div>
      <div style="background:#0C0C12;border:1px solid rgba(255,255,255,0.07);border-radius:16px;overflow:hidden">
        ${items.map(i => `<div style="display:flex;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.05)"><span style="font-size:14px;color:#F0EEF8">${i.name}</span><span style="font-size:14px;color:#9896A8">$${parseFloat(i.price).toFixed(2)}</span></div>`).join('')}
        ${bill.tax ? `<div style="display:flex;justify-content:space-between;padding:11px 16px;border-bottom:1px solid rgba(255,255,255,0.05)"><span style="font-size:13px;color:#6E6B80">Tax</span><span style="font-size:13px;color:#6E6B80">$${parseFloat(bill.tax).toFixed(2)}</span></div>` : ''}
        ${bill.tip ? `<div style="display:flex;justify-content:space-between;padding:11px 16px;border-bottom:1px solid rgba(255,255,255,0.05)"><span style="font-size:13px;color:#6E6B80">Tip</span><span style="font-size:13px;color:#6E6B80">$${parseFloat(bill.tip).toFixed(2)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;padding:14px 16px"><span style="font-size:15px;font-weight:700;color:#F0EEF8">Total</span><span style="font-size:15px;font-weight:700;color:#30D158">$${parseFloat(bill.total || 0).toFixed(2)}</span></div>
      </div>
    </div>` : (bill.tax || bill.tip ? `
    <div style="max-width:800px;margin:20px auto 0;padding:0 20px">
      <div style="background:#0C0C12;border:1px solid rgba(255,255,255,0.07);border-radius:16px;overflow:hidden">
        ${bill.tax ? `<div style="display:flex;justify-content:space-between;padding:11px 16px;border-bottom:1px solid rgba(255,255,255,0.05)"><span style="font-size:13px;color:#6E6B80">Tax</span><span style="font-size:13px;color:#6E6B80">$${parseFloat(bill.tax).toFixed(2)}</span></div>` : ''}
        ${bill.tip ? `<div style="display:flex;justify-content:space-between;padding:11px 16px;border-bottom:1px solid rgba(255,255,255,0.05)"><span style="font-size:13px;color:#6E6B80">Tip</span><span style="font-size:13px;color:#6E6B80">$${parseFloat(bill.tip).toFixed(2)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;padding:14px 16px"><span style="font-size:15px;font-weight:700;color:#F0EEF8">Total</span><span style="font-size:15px;font-weight:700;color:#30D158">$${parseFloat(bill.total || 0).toFixed(2)}</span></div>
      </div>
    </div>` : '');

  const profileB64 = Buffer.from(JSON.stringify(billPayerProfile || {})).toString('base64');
  const paidByNameSafe = JSON.stringify(bill.paid_by || '');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <title>🪶 ${bill.name} — RAVEN</title>
  <meta property="og:title" content="🪶 ${bill.name} — Split bills free with RAVEN" />
  <meta property="og:description" content="Tap to see what you owe · Bill ID: ${billId} · Split bills free at ravensplit.com" />
  <meta property="og:image" content="https://ravensplit.com/raven-hero.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url" content="${baseUrl}/bill/${billId}" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;background:#06060A;color:#F0EEF8;min-height:100vh;padding-bottom:120px}
    .hdr{position:sticky;top:0;background:rgba(6,6,10,0.95);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,0.07);padding:0 20px;z-index:100}
    .hdr-i{max-width:800px;margin:0 auto;height:56px;display:flex;align-items:center;justify-content:space-between}
    .pm-row{display:flex;align-items:center;gap:14px;padding:14px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;text-decoration:none;margin-bottom:8px;-webkit-tap-highlight-color:transparent;width:100%;cursor:pointer}
    .pm-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:700;font-size:14px;color:#fff}
    .pm-info{flex:1;display:flex;flex-direction:column;gap:2px;text-align:left}
    .pm-info b{font-size:14px;font-weight:600;color:#F0EEF8}
    .pm-info span{font-size:11px;color:#6E6B80}
    .raven-footer{max-width:800px;margin:32px auto 0;padding:0 20px 60px;text-align:center}
    .raven-footer-inner{display:inline-flex;align-items:center;gap:8px;padding:10px 18px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:20px;text-decoration:none;transition:all 0.2s}
    .raven-footer-inner:hover{background:rgba(124,58,237,0.08);border-color:rgba(124,58,237,0.25)}
  </style>
</head>
<body>
  <div class="hdr"><div class="hdr-i">
    <div style="display:flex;align-items:center;gap:12px">
      <button onclick="history.back()" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#9896A8;padding:6px 12px;font-size:13px;cursor:pointer;font-family:inherit">← Back</button>
      <div style="font-size:18px;font-weight:900;letter-spacing:0.12em"><a href="https://ravensplit.com/" style="text-decoration:none;color:inherit">🪶 RAVEN</a></div>
    </div>
    <div style="font-size:11px;color:#6E6B80;background:rgba(255,255,255,0.05);padding:4px 10px;border-radius:20px;font-weight:600">${billId}</div>
  </div></div>

  <div style="max-width:800px;margin:20px auto 0;padding:0 20px">
    <div style="font-size:28px;font-weight:800;margin-bottom:6px">${bill.name}</div>
    <div style="display:flex;gap:12px">
      <span style="font-size:12px;color:#6E6B80">Total <strong style="color:#F0EEF8">$${parseFloat(bill.total||0).toFixed(2)}</strong></span>
      ${participants.length > 0 ? `<span style="font-size:12px;color:#6E6B80"><strong style="color:#F0EEF8">${participants.length}</strong> people</span>` : ''}
    </div>
  </div>

  ${receiptHTML}
  ${participantsHTML}
  ${itemsListHTML}

  <div style="max-width:800px;margin:24px auto 0;padding:0 20px 40px">
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
  <input type="hidden" id="paid-by-name" value="${bill.paid_by ? bill.paid_by.replace(/"/g,'&quot;') : ''}">

  <!-- Acquisition footer — every bill shared is a free ad -->
  <div class="raven-footer">
    <a href="https://ravensplit.com" class="raven-footer-inner">
      <span style="font-size:16px">🪶</span>
      <span style="font-size:12px;color:#6E6B80">Split bills instantly with <strong style="color:#C084FC">RAVEN</strong> — free to use</span>
      <span style="font-size:11px;color:#6E6B80">→</span>
    </a>
  </div>

  <div id="pmod" style="display:none;position:fixed;inset:0;z-index:999">
    <div onclick="closePay()" style="position:absolute;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(8px)"></div>
    <div style="position:absolute;bottom:0;left:0;right:0;display:flex;justify-content:center">
      <div style="background:#0C0C12;border:1px solid rgba(255,255,255,0.1);border-radius:24px 24px 0 0;padding:24px 20px 52px;width:100%;max-width:600px">
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

    // PostHog — track bill page views (acquisition metric)
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]);t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+" (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    posthog.init('YOUR_POSTHOG_KEY',{api_host:'https://us.i.posthog.com',person_profiles:'identified_only'});
    posthog.capture('bill_page_viewed', { bill_id: BID });

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
      // Use the paid_by name — that's who people are paying back
      const paidByName = document.getElementById('paid-by-name')?.value || '';
      const payeeName = paidByName || p.first_name || 'Bill Creator';
      document.getElementById('pname').textContent = payeeName;
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
        if(d.success){document.getElementById('cbody').value='';clearGif();toast('✅ Posted!');setTimeout(()=>loadC(),500);}
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

app.post('/trip/create', async (req, res) => {
  try {
    const { name, people, trip_date, cover_image, creator_email } = req.body;
    if (!name || !creator_email) return res.status(400).json({ error: 'name and creator_email required' });

    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const tripId = Array.from({length: 5}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const shareToken = Array.from({length:16}, () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random()*62)]).join('');
    const inviteToken = Array.from({length:12}, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random()*36)]).join('');

    const insertData = {
      id: tripId,
      creator_email,
      name,
      people: JSON.stringify(Array.isArray(people) ? people : []),
      share_token: shareToken,
      invite_token: inviteToken,
      total: 0,
      receipt_count: 0,
      status: 'active',
      created_at: new Date().toISOString()
    };
    if (trip_date) insertData.trip_date = trip_date;
    if (cover_image) insertData.cover_image = cover_image;

    const { error } = await supabase.from('trips').insert(insertData);
    if (error) return res.status(500).json({ error: error.message });

    res.json({ tripId, shareToken, inviteToken });
  } catch (err) {
    console.error('createTrip error:', err);
    res.status(500).json({ error: err.message });
  }
});

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
      : 'https://ravensplit.com/raven-hero.png';
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
    <a href="https://ravensplit.com/dashboard.html?join_trip=${tripId}&join_token=${trip.invite_token}" style="display:block;width:100%;padding:15px;background:#30D158;color:#000;border-radius:12px;font-size:15px;font-weight:800;text-decoration:none;margin-bottom:10px">🪶 Create Account &amp; Join Trip</a>
    <a href="https://ravensplit.com/dashboard.html?join_trip=${tripId}&join_token=${trip.invite_token}&signin=1" style="display:block;width:100%;padding:13px;background:transparent;border:1px solid rgba(255,255,255,0.12);color:#9896A8;border-radius:12px;font-size:14px;font-weight:600;text-decoration:none">Already have an account? Sign In</a>
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
        // NOTE: avatar_url intentionally excluded — it's base64 and would bloat the inline JSON blob
        if (name) memberPayProfiles[name] = { venmo: p.venmo||'', cashapp: p.cashapp||'', zelle: p.zelle||'', applepay: p.applepay||'', email: p.email||'', raven_id: p.raven_id||'' };
      });
    }

    // Strategy 2: try matching people array names against all profiles by first_name
    // (catches cases where member_emails isn't populated)
    if (people.length > 0) {
      const { data: profilesByName } = await supabase.from('profiles').select('first_name,venmo,cashapp,zelle,applepay,raven_id,avatar_url,created_at').in('first_name', people);
      (profilesByName || []).forEach(p => {
        if (p.first_name && !memberPayProfiles[p.first_name]) {
          memberPayProfiles[p.first_name] = { venmo: p.venmo||'', cashapp: p.cashapp||'', zelle: p.zelle||'', applepay: p.applepay||'', raven_id: p.raven_id||'' };
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
  const frontendUrl = 'https://ravensplit.com';
  const tripUrl   = `${frontendUrl}/trip/${tripId}?t=${trip.share_token}`;
  const inviteUrl = `${frontendUrl}/trip/${tripId}?t=${trip.invite_token}&invite=1`;

  // Build server-side HTML snippets safely (no user content in JS template literals)
  const avatarColors = ['linear-gradient(135deg,#7C3AED,#A855F7)','linear-gradient(135deg,#E8633A,#FF6B35)','linear-gradient(135deg,#0EA5E9,#7C3AED)','linear-gradient(135deg,#30D158,#0EA5E9)','linear-gradient(135deg,#F59E0B,#EF4444)','linear-gradient(135deg,#EC4899,#8B5CF6)','linear-gradient(135deg,#14B8A6,#3B82F6)','linear-gradient(135deg,#84CC16,#10B981)'];

  function esc(str) { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  const coverHTML = trip.cover_image
    ? `<div style="max-width:800px;margin:0 auto;padding:16px 20px 0"><div style="position:relative;width:100%;height:190px;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.07)"><img src="${baseUrl}/trip/${tripId}/cover-image" id="cover-img" style="width:100%;height:100%;object-fit:cover"><button id="cover-change-btn" style="position:absolute;bottom:10px;right:10px;padding:7px 14px;background:rgba(0,0,0,0.7);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;font-family:'Epilogue',sans-serif;font-size:12px;font-weight:600;cursor:pointer">📷 Change</button><input id="cover-upload" type="file" accept="image/*" style="display:none"></div></div>`
    : `<div style="max-width:800px;margin:16px auto 0;padding:0 20px"><div id="cover-empty" style="width:100%;height:100px;border:2px dashed rgba(124,58,237,0.3);border-radius:16px;display:flex;align-items:center;justify-content:center;gap:10px;cursor:pointer;background:rgba(124,58,237,0.03)"><span style="font-size:20px">🖼</span><span style="font-size:13px;color:#6E6B80;font-weight:500">Add a cover photo for this trip</span></div><input id="cover-upload" type="file" accept="image/*" style="display:none"></div>`;

  const visiblePeople = people.slice(0, 5);
  const overflowPeople = people.slice(5);
  const avatarRow = visiblePeople.map((p, i) =>
    `<div data-person-avatar="${esc(p)}" data-open-profile="${esc(p)}" title="${esc(p)}" style="width:32px;height:32px;border-radius:50%;background:${avatarColors[i%avatarColors.length]};border:2px solid #06060A;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0;margin-left:${i===0?'0':'-8px'};overflow:hidden;cursor:pointer">${esc(p[0].toUpperCase())}</div>`
  ).join('')
  + (overflowPeople.length > 0
    ? `<div id="avatar-overflow-btn" onclick="toggleAvatarOverflow()" title="Show ${overflowPeople.length} more" style="width:32px;height:32px;border-radius:50%;background:#22222E;border:2px solid #06060A;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#9896A8;flex-shrink:0;margin-left:-8px;cursor:pointer;position:relative;z-index:5">+${overflowPeople.length}</div>
     <div id="avatar-overflow-list" style="display:none;position:absolute;top:44px;left:0;background:#13131A;border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:8px;z-index:100;min-width:140px;box-shadow:0 8px 32px rgba(0,0,0,0.5)">
       ${overflowPeople.map((p,i) => `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'"><div style="width:24px;height:24px;border-radius:50%;background:${avatarColors[(i+5)%avatarColors.length]};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0">${esc(p[0].toUpperCase())}</div><span style="font-size:12px;color:#F0EEF8">${esc(p)}</span></div>`).join('')}
     </div>`
    : '');

  let countdownHTML = '';
  if (trip.trip_date) {
    // Pure date arithmetic — no timezone Date objects to avoid UTC/ET drift on Railway servers
    const now = new Date();
    // Get today's date in Eastern Time as YYYY-MM-DD string
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // en-CA gives YYYY-MM-DD
    const [ty, tm, td] = todayStr.split('-').map(Number);
    const [ry, rm, rd] = trip.trip_date.split('-').map(Number);
    // Compare as plain numbers — no timezone conversion needed
    const todayNum = ty * 10000 + tm * 100 + td;
    const tripNum  = ry * 10000 + rm * 100 + rd;
    // Days between: use UTC dates with same time to avoid DST issues
    const todayUTC = Date.UTC(ty, tm-1, td);
    const tripUTC  = Date.UTC(ry, rm-1, rd);
    const days = Math.round((tripUTC - todayUTC) / 86400000);
    const tripDateLabel = new Date(tripUTC).toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric', timeZone:'UTC' });
    if (days > 0) {
      const dueDateRow = trip.due_date
        ? `<div style="margin-top:6px;display:inline-flex;align-items:center;gap:6px;padding:5px 12px;background:rgba(255,107,53,0.07);border:1px solid rgba(255,107,53,0.2);border-radius:8px"><span style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#FF6B35">💰 Bill Due</span><span style="font-size:11px;color:#9896A8">${new Date(trip.due_date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span><span id="edit-due-date-btn" style="font-size:10px;color:#FF6B35;cursor:pointer;margin-left:4px;opacity:0.7">edit</span></div>`
        : `<div style="margin-top:6px;display:inline-flex;align-items:center;gap:6px;padding:5px 12px;background:rgba(255,255,255,0.03);border:1px dashed rgba(255,255,255,0.1);border-radius:8px;cursor:pointer" id="add-due-date-btn"><span style="font-size:10px;color:#6E6B80">+ Set bill due date</span></div>`;
      const endDateRow = trip.end_date
        ? `<div style="margin-top:4px;display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:rgba(110,107,128,0.08);border:1px solid rgba(110,107,128,0.2);border-radius:8px"><span style="font-size:10px;color:#6E6B80">🏁 Trip ends</span><span style="font-size:10px;color:#9896A8">${new Date(trip.end_date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span></div>`
        : `<div style="margin-top:4px;display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:rgba(255,255,255,0.02);border:1px dashed rgba(255,255,255,0.07);border-radius:8px;cursor:pointer" id="add-end-date-btn"><span style="font-size:10px;color:#6E6B80">+ Set trip end date</span></div>`;
      countdownHTML = `<div style="background:linear-gradient(135deg,rgba(124,58,237,0.12),rgba(48,209,88,0.08));border:1px solid rgba(124,58,237,0.22);border-radius:16px;padding:20px;text-align:center"><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:#C084FC;font-weight:700;margin-bottom:8px">✈️ Countdown to Trip</div><div style="font-size:72px;font-weight:900;line-height:1;color:#F0EEF8;margin-bottom:4px">${days}</div><div style="font-size:13px;color:#9896A8">day${days!==1?'s':''} to go · ${tripDateLabel}</div>${endDateRow}${dueDateRow}</div>`;
    } else if (days === 0) {
      countdownHTML = `<div style="background:linear-gradient(135deg,rgba(48,209,88,0.12),rgba(124,58,237,0.08));border:1px solid rgba(48,209,88,0.3);border-radius:16px;padding:20px;text-align:center"><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:#30D158;font-weight:700;margin-bottom:8px">✈️ Today's the Day!</div><div style="font-size:48px;font-weight:900;line-height:1;color:#30D158;margin-bottom:4px">🛫</div><div style="font-size:13px;color:#9896A8">${tripDateLabel}</div></div>`;
    } else {
      const ago = Math.abs(days);
      // Check if end_date has passed — if so, show "Trip Completed"
      let isCompleted = false;
      if (trip.end_date) {
        const [ey, em, ed] = trip.end_date.split('-').map(Number);
        const endNum = ey * 10000 + em * 100 + ed;
        isCompleted = todayNum >= endNum;
      }
      countdownHTML = isCompleted
        ? `<div style="background:rgba(48,209,88,0.08);border:1px solid rgba(48,209,88,0.3);border-radius:16px;padding:16px;text-align:center"><div style="font-size:13px;color:#30D158;font-weight:700;margin-bottom:4px">✅ Trip Completed</div><div style="font-size:12px;color:#6E6B80">${tripDateLabel} · ${ago} day${ago!==1?'s':''} ago</div></div>`
        : `<div style="background:rgba(48,209,88,0.06);border:1px solid rgba(48,209,88,0.18);border-radius:16px;padding:16px;text-align:center"><div style="font-size:13px;color:#30D158;font-weight:600">✅ Trip was ${ago>0?ago+' day'+(ago!==1?'s':'')+' ago':'today'} · ${tripDateLabel}</div></div>`;
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

    const personId = 'person-' + p.replace(/[^a-z0-9]/gi,'_');
    return `<div style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.05)" id="row-${personId}">
      <div style="display:flex;align-items:center;justify-content:space-between;${payerEntries.length>0?'margin-bottom:12px':''}">
        <div style="display:flex;align-items:center;gap:10px;cursor:pointer" data-open-profile="${esc(p)}" title="View ${esc(p)}'s profile">
          <div data-person-avatar="${esc(p)}" style="width:34px;height:34px;border-radius:50%;background:${avatarColors[i%avatarColors.length]};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;overflow:hidden">${esc(p[0].toUpperCase())}</div>
          <div>
            <div style="font-weight:600;font-size:14px;display:flex;align-items:center;gap:6px">${esc(p)} <span style="font-size:11px;color:#6E6B80;font-weight:400">›</span></div>
            <div class="person-status-display" style="font-size:11px;color:${amtOwed>0?'#FF9A3C':amtReceivable>0?'#A855F7':'#30D158'}">
              ${amtOwed>0 ? `owes $${amtOwed.toFixed(2)}` : amtReceivable>0 ? `collecting $${amtReceivable.toFixed(2)}` : 'all settled ✓'}
            </div>
          </div>
        </div>
        <div style="text-align:right">
          <div class="person-balance-display" data-original-owed="${amtOwed.toFixed(2)}" style="font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:700;color:${amtOwed>0?'#FF9A3C':amtReceivable>0?'#A855F7':'#9896A8'}">
            ${amtOwed>0 ? '-$'+amtOwed.toFixed(2) : amtReceivable>0 ? '+$'+amtReceivable.toFixed(2) : '$0.00'}
          </div>
        </div>
      </div>
      ${payerEntries.length>0 ? `<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:10px 12px">
        ${payBtnsHtml}
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06)">
          <button class="mark-settled-btn" data-person="${personId}" data-name="${esc(p)}" id="markpaid-${personId}" style="display:inline-flex;align-items:center;gap:7px;padding:8px 16px;background:rgba(48,209,88,0.08);border:1px solid rgba(48,209,88,0.2);border-radius:9px;color:#30D158;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer">✓ Mark as Settled</button>
        </div>
      </div>` : ''}
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
            const paidKey = esc(person) + '::' + esc(r.id || receiptId);
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
              ${payer ? `<div style="padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:8px;flex-wrap:wrap">${payButtonsHtml(payer, amount)}<button class="rcpt-mark-paid-btn" data-receipt-paid-key="${paidKey}" data-person-name="${esc(person)}" data-receipt-id="${esc(r.id||receiptId)}" data-amount="${parseFloat(amount).toFixed(2)}" style="padding:7px 14px;background:rgba(48,209,88,0.06);border:1px solid rgba(48,209,88,0.2);border-radius:8px;color:#30D158;font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;flex-shrink:0">✓ Mark as Paid</button></div>` : ''}
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

    const rTax = parseFloat(r.tax||0);
    const rTip = parseFloat(r.tip||0);
    const rSvc = parseFloat(r.service_fee||0);
    const totalsHtml = `
      ${payerBadgeHtml}
      <div style="background:rgba(48,209,88,0.04);border:1px solid rgba(48,209,88,0.12);border-radius:10px;padding:14px 16px">
        <div style="display:flex;flex-direction:column;gap:6px">
          ${items.length > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:#6E6B80"><span>Subtotal</span><span style="font-family:monospace">$${items.reduce((s,i)=>s+parseFloat(i.price||0),0).toFixed(2)}</span></div>` : ''}
          ${rTax > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:#6E6B80"><span>Tax</span><span style="font-family:monospace">$${rTax.toFixed(2)}</span></div>` : ''}
          ${rTip > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:#6E6B80"><span>Tip</span><span style="font-family:monospace">$${rTip.toFixed(2)}</span></div>` : ''}
          ${rSvc > 0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:#6E6B80"><span>Service Fee</span><span style="font-family:monospace">$${rSvc.toFixed(2)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;align-items:center;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08)">
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
          <button class="admin-delete-receipt-btn" data-receipt-id="${r.id}" data-receipt-name="${esc(r.name||'Receipt')}" onclick="event.stopPropagation();adminDeleteReceipt(this)" style="display:none;width:28px;height:28px;border-radius:50%;background:rgba(255,68,68,0.1);border:1px solid rgba(255,68,68,0.25);cursor:pointer;font-size:13px;align-items:center;justify-content:center;flex-shrink:0;color:#FF6B6B" title="Delete receipt">🗑</button>
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
    dueDate: trip.due_date || '',
    endDate: trip.end_date || '',
    creatorEmail: trip.creator_email || '',
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
<meta property="og:image" content="${trip.cover_image ? baseUrl+'/trip/'+tripId+'/cover-image' : 'https://ravensplit.com/raven-hero.png'}">
<meta property="og:image:width" content="800">
<meta property="og:image:height" content="400">
<meta property="og:url" content="${tripUrl}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="✈️ ${esc(trip.name)} — Trip Hub on RAVEN">
<meta name="twitter:description" content="${people.length} people · ${(receipts||[]).length} receipts · $${grandTotal.toFixed(2)} total">
<meta name="twitter:image" content="${trip.cover_image ? baseUrl+'/trip/'+tripId+'/cover-image' : 'https://ravensplit.com/raven-hero.png'}">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Epilogue:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--black:#06060A;--dark:#0C0C12;--dark2:#13131A;--border:rgba(255,255,255,0.07);--border2:rgba(255,255,255,0.12);--white:#F0EEF8;--muted:#6E6B80;--muted2:#9896A8;--green:#30D158;--purple:#7C3AED;--purple2:#A855F7;--orange:#FF6B35}
body{font-family:'Epilogue',sans-serif;background:var(--black);color:var(--white);min-height:100vh;padding-bottom:60px}@media(min-width:860px){.sec{max-width:820px;margin:0 auto}.hdr-i{max-width:820px!important}}
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
<script id="page-data" type="application/json">${pageData.replace(/<\/script>/gi, '<\\/script>')}</script>

<div class="hdr"><div class="hdr-inner">
  <a href="https://ravensplit.com/dashboard.html" style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:20px;text-decoration:none;color:#9896A8;font-size:13px;font-weight:600;transition:all 0.15s" onmouseover="this.style.color='#F0EEF8';this.style.borderColor='rgba(255,255,255,0.25)'" onmouseout="this.style.color='#9896A8';this.style.borderColor='rgba(255,255,255,0.1)'">← Dashboard</a>
  <a href="https://ravensplit.com/" style="font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:0.15em;text-decoration:none;color:#F0EEF8">🪶 RAVEN</a>
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
  <div style="display:flex;align-items:center;margin-top:14px;margin-bottom:6px;position:relative">
    ${avatarRow}
    <button id="open-add-members" style="width:32px;height:32px;border-radius:50%;background:#13131A;border:2px dashed rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;cursor:pointer;margin-left:4px;flex-shrink:0;font-size:14px;color:#6E6B80">+</button>
    <button id="open-invite" style="padding:5px 14px;margin-left:10px;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.25);border-radius:20px;color:#A855F7;font-family:'Epilogue',sans-serif;font-size:11px;font-weight:700;cursor:pointer">📨 Invite</button>
    <button id="chat-open-btn" onclick="initChatDb().then(openChat)" style="padding:5px 14px;margin-left:8px;background:rgba(0,140,255,0.1);border:1px solid rgba(0,140,255,0.25);border-radius:20px;color:#4DB8FF;font-family:'Epilogue',sans-serif;font-size:11px;font-weight:700;cursor:pointer;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;touch-action:manipulation;position:relative">💬 Chat</button>
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
  <div style="background:#13131A;border:1px solid rgba(255,255,255,0.1);border-radius:24px 24px 0 0;width:100%;max-width:480px">
    <div style="height:130px;background:linear-gradient(135deg,#7C3AED,#30D158);border-radius:24px 24px 0 0;position:relative">
      <button onclick="closeMemberProfile()" style="position:absolute;top:14px;right:14px;background:rgba(0,0,0,0.3);border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;line-height:1;z-index:1">✕</button>
      <div id="mp-avatar" style="position:absolute;bottom:-36px;left:24px;width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,#7C3AED,#30D158);border:4px solid #13131A;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:#fff;overflow:hidden"></div>
    </div>
    <div style="padding:48px 24px 32px">
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
    <div style="margin-bottom:16px"><div style="font-size:12px;color:#6E6B80;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em">Trip Start Date</div><input id="settings-date" type="date"></div>
    <div style="margin-bottom:16px"><div style="font-size:12px;color:#6E6B80;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em">🏁 Trip End Date <span style="font-weight:400;text-transform:none;font-size:11px;letter-spacing:0">(marks trip as completed)</span></div><input id="settings-end-date" type="date"></div>
    <div style="margin-bottom:16px"><div style="font-size:12px;color:#6E6B80;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em">💰 Bill Due Date <span style="font-weight:400;text-transform:none;font-size:11px;letter-spacing:0">(RAVEN sends reminders after this)</span></div><input id="settings-due-date" type="date"></div>
    <button class="btn-g" id="save-settings-btn" style="margin-bottom:10px">💾 Save Changes</button>
    <button class="btn-o" id="close-settings-btn">Cancel</button>
  </div>
</div>

<!-- ADD MEMBERS MODAL -->
<div class="modal-bg" id="add-members-modal">
  <div class="modal-box">
    <div class="handle"></div>
    <div style="font-size:26px;font-weight:800;margin-bottom:4px">Add Members</div>
    <div style="font-size:13px;color:#6E6B80;margin-bottom:16px;line-height:1.6">Enter a name or <span style="color:#A855F7;font-weight:700">@ravenid</span> — using a Raven ID links their account so the trip auto-appears in their hub.</div>
    <div style="display:flex;gap:8px;margin-bottom:14px">
      <input id="new-member-input" type="text" placeholder="Name or @ravenid" style="flex:1">
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
const CREATOR_EMAIL = D.creatorEmail || '';
let   PEOPLE     = D.people;
const PAY_PROFILES = D.memberPayProfiles || {};
const receiptsDataMap = {}; // keyed by receipt id — safe lookup, no user data in onclick
(D.receiptsData || []).forEach(r => { receiptsDataMap[r.id] = r; });

// Determine if current viewer is admin (creator) — checked after page loads
function checkIsAdmin() {
  try {
    const local = JSON.parse(localStorage.getItem('raven_profile') || '{}');
    // Compare stored email (set by dashboard.html on login) to trip creator email
    if (local.email && CREATOR_EMAIL && local.email === CREATOR_EMAIL) return true;
    // Fallback: check supabase session in localStorage (key contains 'auth-token')
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.includes('auth-token') || key.includes('supabase'))) {
        try {
          const val = JSON.parse(localStorage.getItem(key) || '{}');
          const email = val?.user?.email || val?.currentSession?.user?.email || '';
          if (email && email === CREATOR_EMAIL) return true;
        } catch(e) {}
      }
    }
    return false;
  } catch(e) { return false; }
}
let IS_ADMIN = false; // set after DOM loads

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
const DUE_DATE = D.dueDate || '';
const END_DATE = D.endDate || '';
if (DUE_DATE) { const dd = document.getElementById('settings-due-date'); if (dd) dd.value = DUE_DATE; }
if (END_DATE) { const ed = document.getElementById('settings-end-date'); if (ed) ed.value = END_DATE; }
// Wire up inline due date edit/add buttons
document.addEventListener('DOMContentLoaded', () => {
  const editBtn = document.getElementById('edit-due-date-btn');
  const addBtn  = document.getElementById('add-due-date-btn');
  if (editBtn) editBtn.addEventListener('click', () => openModal('settings-modal'));
  if (addBtn)  addBtn.addEventListener('click',  () => openModal('settings-modal'));

  // Show admin delete buttons if admin
  IS_ADMIN = checkIsAdmin();
  if (IS_ADMIN) {
    document.querySelectorAll('.admin-delete-receipt-btn').forEach(btn => {
      btn.style.display = 'flex';
    });
  }

  // Build saved receipts photo gallery — runs after DOM ready so it works on mobile too
  try { buildSavedReceiptsGallery(); } catch(e) { console.error('Gallery error:', e); }

  // Wire up "Mark as Settled" buttons via event delegation — safe for any name
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('.mark-settled-btn');
    if (btn) {
      const personId = btn.getAttribute('data-person');
      const personName = btn.getAttribute('data-name');
      if (personId && personName) markTripPersonPaid(personName, personId, btn);
      return;
    }
    // Per-receipt mark as paid
    const rcptBtn = e.target.closest('.rcpt-mark-paid-btn');
    if (rcptBtn) {
      const personName = rcptBtn.getAttribute('data-person-name');
      const receiptId  = rcptBtn.getAttribute('data-receipt-id');
      const amount     = rcptBtn.getAttribute('data-amount');
      if (personName && receiptId) markReceiptItemPaid(personName, receiptId, amount, rcptBtn);
      return;
    }
    // Open member profile on avatar/name click
    const profileEl = e.target.closest('[data-open-profile]');
    if (profileEl) {
      const name = profileEl.getAttribute('data-open-profile');
      if (name) openMemberProfile(name);
    }
  });
});

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

// ── SAVED RECEIPTS — build gallery from localStorage photos ──
function buildSavedReceiptsGallery() {
  try {
    const pending = JSON.parse(localStorage.getItem('raven_pending_receipts') || '[]');
    const mine = pending.filter(p => p.tripId === TRIP_ID);
    if (mine.length === 0) return;
    // Inject saved receipts section before the receipts accordion
    const section = document.createElement('div');
    section.className = 'sec';
    section.style.marginTop = '16px';
    const unscanned = mine.filter(p => !p.scanned);

    // Header row — clicking toggles body
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;cursor:pointer';
    const labelHtml = '📸 Saved Receipt Photos (' + mine.length + ')' +
      (unscanned.length > 0 ? ' <span style="font-size:10px;background:rgba(255,107,53,0.15);color:#FF6B35;border-radius:6px;padding:2px 8px;font-weight:700">'+unscanned.length+' unscanned</span>' : '');
    header.innerHTML =
      '<div class="sec-lbl" style="margin-bottom:0">' + labelHtml + '</div>' +
      '<div style="font-size:12px;color:#6E6B80;background:rgba(255,255,255,0.05);padding:4px 10px;border-radius:8px;user-select:none"><span id="saved-receipts-toggle">▾ Show</span></div>';

    // Body — hidden by default
    const body = document.createElement('div');
    body.id = 'saved-receipts-body';
    body.style.display = 'none';

    // Photo grid
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px';
    mine.forEach(r => {
      const d = new Date(r.savedAt);
      const label = d.toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'America/New_York'});
      const cell = document.createElement('div');
      cell.style.cssText = 'position:relative;border-radius:10px;overflow:hidden;cursor:pointer;border:2px solid ' + (r.scanned ? 'rgba(48,209,88,0.4)' : 'rgba(255,107,53,0.4)');
      cell.innerHTML =
        '<img src="data:' + (r.mediaType||'image/jpeg') + ';base64,' + r.imageBase64 + '" style="width:100%;aspect-ratio:3/4;object-fit:cover;display:block">' +
        '<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.7);padding:4px 6px">' +
          '<div style="font-size:9px;color:#fff;font-weight:600">' + (r.scanned ? '✅' : '⏳') + '</div>' +
          '<div style="font-size:8px;color:#9896A8">' + label + '</div>' +
        '</div>';
      cell.addEventListener('click', () => viewSavedReceipt(r.id));
      grid.appendChild(cell);
    });
    body.appendChild(grid);

    if (unscanned.length > 0) {
      const retryBtn = document.createElement('button');
      retryBtn.style.cssText = 'width:100%;padding:10px;background:rgba(255,107,53,0.1);border:1px solid rgba(255,107,53,0.3);border-radius:10px;color:#FF6B35;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer';
      retryBtn.textContent = '↻ Retry scanning ' + unscanned.length + ' pending photo' + (unscanned.length>1?'s':'');
      retryBtn.addEventListener('click', retryPendingScans);
      body.appendChild(retryBtn);
    } else {
      const doneMsg = document.createElement('div');
      doneMsg.style.cssText = 'font-size:12px;color:#30D158;text-align:center;padding:6px 0';
      doneMsg.textContent = 'All photos scanned ✅';
      body.appendChild(doneMsg);
    }

    // Toggle on header click
    header.addEventListener('click', () => {
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      const tog = document.getElementById('saved-receipts-toggle');
      if (tog) tog.textContent = open ? '▾ Show' : '▴ Hide';
    });

    section.appendChild(header);
    section.appendChild(body);
    // Insert before the All Receipts section
    const receiptsSec = document.getElementById('receipts-body');
    if (receiptsSec) receiptsSec.closest('.sec').parentNode.insertBefore(section, receiptsSec.closest('.sec'));
  } catch(e) { console.error('Saved receipts gallery error:', e); }
}

function viewSavedReceipt(id) {
  try {
    const pending = JSON.parse(localStorage.getItem('raven_pending_receipts') || '[]');
    const r = pending.find(x => x.id === id);
    if (!r) return;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.96);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px';
    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.1);border:none;color:#fff;width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:16px';
    closeBtn.textContent = '\u2715';
    closeBtn.addEventListener('click', () => overlay.remove());
    const img = document.createElement('img');
    img.src = 'data:' + (r.mediaType||'image/jpeg') + ';base64,' + r.imageBase64;
    img.style.cssText = 'max-width:100%;max-height:72vh;border-radius:12px;object-fit:contain';
    const statusEl = document.createElement('div');
    statusEl.style.cssText = 'margin-top:12px;font-size:13px;color:#9896A8';
    statusEl.textContent = r.scanned ? '\u2705 Successfully scanned' : '\u23f3 Not yet scanned';
    const delBtn = document.createElement('button');
    delBtn.style.cssText = 'margin-top:14px;padding:10px 24px;background:rgba(255,68,68,0.12);border:1px solid rgba(255,68,68,0.3);border-radius:10px;color:#FF6B6B;font-size:13px;font-weight:700;cursor:pointer';
    delBtn.textContent = '\ud83d\uddd1 Remove from saved photos';
    delBtn.addEventListener('click', () => {
      if (delBtn.dataset.confirming === '1') {
        try {
          const all = JSON.parse(localStorage.getItem('raven_pending_receipts') || '[]');
          localStorage.setItem('raven_pending_receipts', JSON.stringify(all.filter(x => x.id !== id)));
        } catch(e) {}
        overlay.remove();
        toast('Photo removed \u2713', true);
        const old = document.getElementById('saved-receipts-section');
        if (old) old.remove();
        buildSavedReceiptsGallery();
      } else {
        delBtn.dataset.confirming = '1';
        delBtn.textContent = '\u26a0\ufe0f Tap again to confirm';
        setTimeout(() => { if (delBtn.dataset.confirming==='1'){delBtn.dataset.confirming='';delBtn.textContent='\ud83d\uddd1 Remove from saved photos';} }, 3000);
      }
    });
    overlay.appendChild(closeBtn);
    overlay.appendChild(img);
    overlay.appendChild(statusEl);
    overlay.appendChild(delBtn);
    document.body.appendChild(overlay);
  } catch(e) {}
}

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

// ── AVATAR OVERFLOW TOGGLE ──
function toggleAvatarOverflow() {
  const list = document.getElementById('avatar-overflow-list');
  const btn = document.getElementById('avatar-overflow-btn');
  if (!list) return;
  const isOpen = list.style.display !== 'none';
  list.style.display = isOpen ? 'none' : 'block';
  if (btn) btn.style.background = isOpen ? '#22222E' : 'rgba(124,58,237,0.2)';
}
// Close overflow on outside click
document.addEventListener('click', function(e) {
  const list = document.getElementById('avatar-overflow-list');
  if (!list || list.style.display === 'none') return;
  if (!e.target.closest('#avatar-overflow-btn') && !e.target.closest('#avatar-overflow-list')) {
    list.style.display = 'none';
    const btn = document.getElementById('avatar-overflow-btn');
    if (btn) btn.style.background = '#22222E';
  }
});

// ── PER-RECEIPT MARK AS PAID — subtracts from running balance ──
// Tracks paid amounts per person client-side keyed by TRIP_ID
function getReceiptPaidMap() {
  try { return JSON.parse(localStorage.getItem('raven_rcpt_paid_' + TRIP_ID) || '{}'); } catch(e) { return {}; }
}
function saveReceiptPaidMap(map) {
  try { localStorage.setItem('raven_rcpt_paid_' + TRIP_ID, JSON.stringify(map)); } catch(e) {}
}

function markReceiptItemPaid(personName, receiptId, amount, btn) {
  if (!btn) return;
  if (btn.dataset.confirming === '1') {
    // Confirmed — mark this receipt as paid for this person
    const map = getReceiptPaidMap();
    const key = personName + '::' + receiptId;
    if (!map[key]) {
      map[key] = parseFloat(amount) || 0;
      saveReceiptPaidMap(map);
    }
    // Update button
    btn.textContent = '✅ Paid';
    btn.style.background = 'rgba(48,209,88,0.15)';
    btn.style.borderColor = 'rgba(48,209,88,0.4)';
    btn.disabled = true;
    btn.dataset.confirming = '';
    // Recalculate and update this person's top-level balance display
    updatePersonBalanceDisplay(personName);
    toast(personName + ' paid $' + parseFloat(amount).toFixed(2) + ' ✓', true);
    return;
  }
  btn.dataset.confirming = '1';
  btn.textContent = '⚠️ Tap again to confirm';
  btn.style.borderColor = 'rgba(48,209,88,0.5)';
  setTimeout(() => {
    if (btn.dataset.confirming === '1') {
      btn.dataset.confirming = '';
      btn.textContent = '✓ Mark as Paid';
      btn.style.borderColor = 'rgba(48,209,88,0.2)';
    }
  }, 3000);
}

function updatePersonBalanceDisplay(personName) {
  const personId = 'person-' + personName.replace(/[^a-z0-9]/gi, '_');
  const row = document.getElementById('row-' + personId);
  if (!row) return;

  // Sum all paid receipt amounts for this person
  const map = getReceiptPaidMap();
  let paidSoFar = 0;
  Object.entries(map).forEach(([key, amt]) => {
    if (key.startsWith(personName + '::')) paidSoFar += amt;
  });

  // Find original owed amount from DOM
  const amtEl = row.querySelector('[data-original-owed]');
  const originalOwed = amtEl ? parseFloat(amtEl.getAttribute('data-original-owed')) : 0;
  const remaining = Math.max(0, originalOwed - paidSoFar);

  // Update displayed balance
  const displayEl = row.querySelector('.person-balance-display');
  const statusEl  = row.querySelector('.person-status-display');
  if (displayEl) {
    displayEl.textContent = remaining > 0 ? '-$' + remaining.toFixed(2) : '$0.00';
    displayEl.style.color = remaining > 0 ? '#FF9A3C' : '#9896A8';
  }
  if (statusEl) {
    statusEl.textContent = remaining > 0 ? 'owes $' + remaining.toFixed(2) : 'all settled ✓';
    statusEl.style.color = remaining > 0 ? '#FF9A3C' : '#30D158';
  }
}

// Restore per-receipt paid states on load
(function restoreReceiptPaidStates() {
  const map = getReceiptPaidMap();
  Object.keys(map).forEach(key => {
    const btn = document.querySelector('[data-receipt-paid-key="' + key + '"]');
    if (btn) {
      btn.textContent = '✅ Paid';
      btn.style.background = 'rgba(48,209,88,0.15)';
      btn.style.borderColor = 'rgba(48,209,88,0.4)';
      btn.disabled = true;
    }
  });
  // Update all person balances
  const people = D.people || [];
  people.forEach(p => updatePersonBalanceDisplay(p));
})();
  if (!btn) btn = document.getElementById('markpaid-' + personId);
  if (!btn) return;
  if (btn.dataset.confirming === '1') {
    // Second tap — mark as settled
    btn.textContent = '✅ Settled';
    btn.style.background = 'rgba(48,209,88,0.15)';
    btn.style.borderColor = 'rgba(48,209,88,0.4)';
    btn.disabled = true;
    btn.dataset.confirming = '';
    // Update the status row text
    const row = document.getElementById('row-' + personId);
    if (row) {
      const statusEl = row.querySelector('[style*="owes $"]');
      if (statusEl) { statusEl.textContent = 'all settled ✓'; statusEl.style.color = '#30D158'; }
      const amountEl = row.querySelector("[style*='font-family:']") || row.querySelector(".person-amount");
      if (amountEl) { amountEl.textContent = '$0.00'; amountEl.style.color = '#9896A8'; }
      // Hide pay slots
      row.querySelectorAll('.pay-slot').forEach(s => s.style.display = 'none');
    }
    // Store in localStorage so it persists across page refresh for this session
    try {
      const key = 'raven_settled_' + TRIP_ID;
      const settled = JSON.parse(localStorage.getItem(key) || '[]');
      if (!settled.includes(personName)) settled.push(personName);
      localStorage.setItem(key, JSON.stringify(settled));
    } catch(e) {}
    toast(personName + ' marked as settled ✓', true);
    return;
  }
  // First tap — confirm state
  btn.dataset.confirming = '1';
  btn.textContent = '⚠️ Tap again to confirm';
  btn.style.background = 'rgba(48,209,88,0.15)';
  btn.style.borderColor = 'rgba(48,209,88,0.5)';
  setTimeout(() => {
    if (btn.dataset.confirming === '1') {
      btn.dataset.confirming = '';
      btn.textContent = '✓ Mark as Settled';
      btn.style.background = 'rgba(48,209,88,0.08)';
      btn.style.borderColor = 'rgba(48,209,88,0.2)';
    }
  }, 3000);
}

// Restore settled states from localStorage on page load
document.addEventListener('DOMContentLoaded', function() {
  try {
    const key = 'raven_settled_' + TRIP_ID;
    const settled = JSON.parse(localStorage.getItem(key) || '[]');
    settled.forEach(personName => {
      const personId = personName.replace(/[^a-z0-9]/gi,'_');
      const btn = document.getElementById('markpaid-' + personId);
      if (btn) {
        btn.textContent = '✅ Settled';
        btn.style.background = 'rgba(48,209,88,0.15)';
        btn.style.borderColor = 'rgba(48,209,88,0.4)';
        btn.disabled = true;
        const row = document.getElementById('row-' + personId);
        if (row) row.querySelectorAll('.pay-slot').forEach(s => s.style.display = 'none');
      }
    });
  } catch(e) {}
});
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
  const actEl=document.getElementById("mp-actions"); if(actEl){actEl.innerHTML="";if(prof?.raven_id){const addBtn=document.createElement("button");addBtn.style.cssText="width:100%;padding:13px;background:rgba(124,58,237,0.12);border:1px solid rgba(124,58,237,0.3);border-radius:12px;font-family:inherit;font-size:14px;font-weight:700;color:#A855F7;cursor:pointer";addBtn.textContent="👥 Add Friend on RAVEN";addBtn.onclick=()=>{window.open("https://ravensplit.com/dashboard.html","_blank");toast("Search for @"+prof.raven_id+" in Friends");closeMemberProfile();};actEl.appendChild(addBtn);}const closeBtn=document.createElement("button");closeBtn.style.cssText="width:100%;padding:13px;background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:12px;font-family:inherit;font-size:14px;color:#6E6B80;cursor:pointer";closeBtn.textContent="Close";closeBtn.onclick=closeMemberProfile;actEl.appendChild(closeBtn);}
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
    const dueDate = document.getElementById('settings-due-date')?.value || null;
    const endDate = document.getElementById('settings-end-date')?.value || null;
    const r = await fetch(BACKEND+'/trip/'+TRIP_ID+'/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TRIP_TOKEN,name,trip_date:date||null,due_date:dueDate||null,end_date:endDate||null})});
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
document.getElementById('share-invite-btn').addEventListener('click', function() {
  var tripMsg = 'Join ' + TRIP_NAME + ' on RAVEN - Split bills free with RAVEN | ravensplit.com';
  if (navigator.share) {
    navigator.share({ title: tripMsg, url: INVITE_URL }).catch(function() {
      navigator.clipboard.writeText(INVITE_URL).then(function(){toast('Invite link copied!');});
    });
  } else {
    navigator.clipboard.writeText(INVITE_URL).then(function(){toast('Invite link copied!');}).catch(function(){prompt('Copy:',INVITE_URL);});
  }
});

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
    // Editable name input — clearly styled so it's obvious it's editable
    const nameInput=document.createElement('input');
    nameInput.type='text';
    nameInput.value=item.name;
    nameInput.placeholder='Item name';
    nameInput.style.cssText='flex:1;font-size:13px;font-weight:500;background:#0C0C12;border:1px solid rgba(255,255,255,0.15);border-radius:7px;color:#F0EEF8;font-family:inherit;padding:6px 10px;outline:none;min-width:0';
    nameInput.addEventListener('focus',()=>{ nameInput.style.borderColor='rgba(124,58,237,0.6)'; });
    nameInput.addEventListener('blur',()=>{ nameInput.style.borderColor='rgba(255,255,255,0.15)'; item.name=nameInput.value.trim()||item.name; });
    nameInput.addEventListener('input',()=>{ item.name=nameInput.value; });
    const priceSpan=document.createElement('span'); priceSpan.style.cssText='font-family:monospace;font-size:13px;color:#9896A8;flex-shrink:0'; priceSpan.textContent='$'+item.price.toFixed(2);
    const del=document.createElement('button'); del.textContent='×'; del.style.cssText='background:none;border:none;color:#6E6B80;cursor:pointer;font-size:16px;flex-shrink:0';
    del.addEventListener('click',()=>{ tripItems=tripItems.filter(i=>i.id!==item.id); renderItems(); });
    row.appendChild(nameInput); row.appendChild(priceSpan); row.appendChild(del);
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
  const isPNG = file.type === 'image/png';
  const outputType = isPNG ? 'image/png' : 'image/jpeg';
  const quality = isPNG ? 1.0 : 0.92;
  const reader=new FileReader();
  reader.onload=function(e){
    document.getElementById('r-preview').src=e.target.result;
    document.getElementById('r-preview').style.display='block';
    document.getElementById('r-empty').style.display='none';
    const img=new Image();
    img.onload=function(){
      let{width:w,height:h}=img;
      if(w>2048||h>2048){if(w>h){h=Math.round(h*2048/w);w=2048;}else{w=Math.round(w*2048/h);h=2048;}}
      const c=document.createElement('canvas');c.width=w;c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      imgBase64=c.toDataURL(outputType,quality).split(',')[1];

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
          try { await Promise.race([fetch(BACKEND+'/'), new Promise(r=>setTimeout(r,20000))]); } catch(e) {}
          st.innerHTML='<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);border-radius:8px"><div class="spinner"></div><span style="font-size:13px;color:#C084FC;font-weight:600">Scanning receipt with AI...</span></div>';
        } else {
          st.innerHTML='<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);border-radius:8px"><div class="spinner"></div><span style="font-size:13px;color:#C084FC;font-weight:600">Retrying... ('+attempt+' of 3)</span></div>';
          await new Promise(r=>setTimeout(r,2000));
        }
        const controller = new AbortController();
        const timer = setTimeout(()=>controller.abort(), 60000);
        try {
          const mt = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
          const r = await fetch(BACKEND+'/demo/scan-receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:imgBase64,mediaType:mt}),signal:controller.signal});
          clearTimeout(timer);
          const d = await r.json();

          // Full success — got items
          if (d.success && d.items && d.items.length > 0) {
            if (!document.getElementById('r-name').value && d.bill_name) document.getElementById('r-name').value = d.bill_name;
            const tot = d.total || d.items.reduce((s,i)=>s+i.price,0);
            document.getElementById('r-total').value = tot.toFixed(2); updateEven();
            if (d.tax > 0) { /* store tax for display — add to total field note */ }
            tripItems = d.items.map((item,idx)=>({id:Date.now()+idx,name:item.name,price:parseFloat(item.price)||0,assignees:[]}));
            setSplit('itemized'); renderItems();
            st.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(48,209,88,0.08);border:1px solid rgba(48,209,88,0.2);border-radius:8px"><span>✅</span><span style="font-size:13px;color:#30D158;font-weight:600">'+d.items.length+' items found'+(d.tax>0?' · Tax $'+parseFloat(d.tax).toFixed(2):'')+'! Photo saved 📸</span></div>';
            try { const pid=window._currentPendingId; if(pid){const pending=JSON.parse(localStorage.getItem('raven_pending_receipts')||'[]');const idx=pending.findIndex(p=>p.id===pid);if(idx>=0){pending[idx].scanned=true;localStorage.setItem('raven_pending_receipts',JSON.stringify(pending));}} } catch(e) {}
            return;
          }

          // Partial success — got total but no line items
          if (d.success && d.total > 0 && (!d.items || d.items.length === 0)) {
            if (!document.getElementById('r-name').value && d.bill_name) document.getElementById('r-name').value = d.bill_name;
            document.getElementById('r-total').value = parseFloat(d.total).toFixed(2); updateEven();
            setSplit('even');
            st.innerHTML = '<div style="padding:10px 14px;background:rgba(255,152,0,0.07);border:1px solid rgba(255,152,0,0.25);border-radius:8px"><div style="font-size:13px;color:#FFA726;font-weight:600;margin-bottom:4px">⚠️ Scanned total: $'+parseFloat(d.total).toFixed(2)+' — line items unclear</div><div style="font-size:12px;color:#9896A8">Total filled in. Add items manually or split evenly.</div></div>';
            return;
          }

          // Server error
          if (d.error && (d.error.includes('API key') || d.error.includes('Rate limit'))) {
            st.innerHTML = '<div style="padding:10px 14px;background:rgba(255,107,53,0.07);border:1px solid rgba(255,107,53,0.25);border-radius:8px"><div style="font-size:13px;color:#FF6B35;font-weight:600">⚠️ '+d.error+'</div></div>';
            return;
          }

          // Retry
          if (attempt < 3) return doScan(attempt+1);

          st.innerHTML = '<div style="padding:10px 14px;background:rgba(255,107,53,0.07);border:1px solid rgba(255,107,53,0.25);border-radius:8px">'
            +'<div style="font-size:13px;color:#FF6B35;font-weight:600;margin-bottom:6px">Still could not scan — enter manually or try again later</div>'
            +'<div style="font-size:12px;color:#9896A8;margin-bottom:8px">Your photo is saved. Enter details manually or retry.</div>'
            +'<button onclick="retryLastScan()" style="padding:6px 14px;background:rgba(255,107,53,0.12);border:1px solid rgba(255,107,53,0.3);border-radius:7px;color:#FF6B35;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer">↻ Retry Scan</button>'
            +'</div>';
        } catch(e) {
          clearTimeout(timer);
          if (attempt < 3) return doScan(attempt+1);
          st.innerHTML = '<div style="padding:10px 14px;background:rgba(255,107,53,0.07);border:1px solid rgba(255,107,53,0.25);border-radius:8px">'
            +'<div style="font-size:13px;color:#FF6B35;font-weight:600;margin-bottom:6px">⚠️ Server waking up — photo is saved!</div>'
            +'<div style="font-size:12px;color:#9896A8;margin-bottom:8px">Enter details manually or retry.</div>'
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
    if(d.success){
      toast('✅ Receipt saved!');
      // Reset form for next receipt — then reload to show updated totals
      document.getElementById('r-name').value='';
      document.getElementById('r-total').value='';
      document.getElementById('r-preview').style.display='none';
      document.getElementById('r-empty').style.display='block';
      document.getElementById('r-scan-status').style.display='none';
      document.getElementById('r-scan-status').innerHTML='';
      const paidByEl=document.getElementById('r-paidby'); if(paidByEl) paidByEl.value='';
      tripItems=[]; imgBase64=null; splitType='even';
      setSplit('even'); renderItems();
      setTimeout(()=>location.reload(),1200);
    } else{btn.textContent='Save Receipt';btn.disabled=false;toast(d.error||'Error',false);}
  }catch(e){btn.textContent='Save Receipt';btn.disabled=false;toast('Network error',false);}
}

// ── GROUP CHAT ──
const SUPABASE_URL_CHAT = 'https://ffjpzkpdumdcwnakpaje.supabase.co';
const SUPABASE_KEY_CHAT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmanB6a3BkdW1kY3duYWtwYWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5ODc4OTcsImV4cCI6MjA4ODU2Mzg5N30.JtDLVu4K1TJ8emcN_mvSHBu6e0y8-jPQv-ypoc9p0RU';
let chatDb = null;
let chatChannel = null;
let chatReadChannel = null;
let chatGifUrl = null;
let chatGifTimer = null;
let chatGifPanelOpen = false;

async function initChatDb() {
  return new Promise(function(resolve) {
    if (chatDb) { resolve(); return; }
    if (window.supabase && window.supabase.createClient) {
      try { chatDb = window.supabase.createClient(SUPABASE_URL_CHAT, SUPABASE_KEY_CHAT); } catch(e) {}
      resolve(); return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    s.onload = function() {
      try { chatDb = window.supabase.createClient(SUPABASE_URL_CHAT, SUPABASE_KEY_CHAT); } catch(e) {}
      resolve();
    };
    s.onerror = function() { console.warn('Supabase CDN blocked'); resolve(); };
    document.head.appendChild(s);
  });
}

function openChat() {
  const modal = document.getElementById('chat-modal');
  if (!modal) { console.warn('chat-modal not found in DOM'); return; }
  modal.style.display = 'flex';
  const titleEl = document.getElementById('chat-trip-title');
  if (titleEl) titleEl.textContent = '✈️ ' + TRIP_NAME;
  const memberCount = document.getElementById('chat-member-count');
  if (memberCount) memberCount.textContent = D.people.length + ' members';
  clearUnreadBadge();
  loadChatMsgs();
  setTimeout(function() { const inp = document.getElementById('chat-input'); if (inp) inp.focus(); }, 100);
}

function closeChat() {
  document.getElementById('chat-modal').style.display = 'none';
  if (chatChannel && chatDb) { chatDb.removeChannel(chatChannel); chatChannel = null; }
  if (chatReadChannel && chatDb) { chatDb.removeChannel(chatReadChannel); chatReadChannel = null; }
}

function showUnreadBadge() {
  const btn = document.getElementById('chat-open-btn');
  if (!btn || btn.querySelector('.chat-unread-dot')) return;
  const dot = document.createElement('span');
  dot.className = 'chat-unread-dot';
  dot.style.cssText = 'position:absolute;top:-3px;right:-3px;width:9px;height:9px;border-radius:50%;background:#FF4444;border:2px solid #06060A;pointer-events:none';
  btn.appendChild(dot);
}

function clearUnreadBadge() {
  const btn = document.getElementById('chat-open-btn');
  if (!btn) return;
  const badge = btn.querySelector('.chat-unread-dot');
  if (badge) badge.remove();
  try { localStorage.setItem('raven_chat_seen_' + TRIP_ID, Date.now().toString()); } catch(e) {}
}

async function checkUnreadChatMessages() {
  if (!chatDb) return;
  try {
    const lastSeen = parseInt(localStorage.getItem('raven_chat_seen_' + TRIP_ID) || '0');
    const lastSeenIso = new Date(lastSeen || 0).toISOString();
    const { data } = await chatDb.from('trip_messages')
      .select('id, user_id')
      .eq('trip_id', TRIP_ID)
      .gt('created_at', lastSeenIso)
      .limit(5);
    const hasUnread = (data || []).some(function(m) { return m.user_id !== (window._ravenUserId || '__none__'); });
    if (hasUnread) showUnreadBadge();
  } catch(e) {}
}

async function loadChatMsgs() {
  if (!chatDb) { await initChatDb(); }
  const container = document.getElementById('chat-msgs');
  container.innerHTML = '<div style="text-align:center;color:#6E6B80;font-size:12px;padding:30px 0">Loading...</div>';
  try {
    const { data } = await chatDb.from('trip_messages').select('*').eq('trip_id', TRIP_ID).order('created_at', { ascending: true }).limit(100);
    container.innerHTML = '';
    if (!data || data.length === 0) {
      container.innerHTML = '<div id="chat-empty" style="text-align:center;color:#6E6B80;font-size:12px;padding:30px 0">No messages yet. Say hi! 👋</div>';
    } else {
      data.forEach(function(msg) { appendMsg(msg, false); });
      container.scrollTop = container.scrollHeight;
      // Mark last message as read
      markRead(data[data.length - 1].id);
    }
  } catch(e) { container.innerHTML = '<div style="text-align:center;color:#FF4444;font-size:12px;padding:20px 0">Could not load messages</div>'; }

  if (chatChannel) { chatDb.removeChannel(chatChannel); }
  chatChannel = chatDb.channel('trip-chat-' + TRIP_ID)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trip_messages', filter: 'trip_id=eq.' + TRIP_ID }, function(payload) {
      const modal = document.getElementById('chat-modal');
      const chatOpen = modal && modal.style.display === 'flex';
      if (chatOpen) {
        appendMsg(payload.new, true);
        markRead(payload.new.id);
      } else {
        // Chat is closed — show unread dot if message is from someone else
        if (payload.new.user_id !== (window._ravenUserId || '__none__')) {
          showUnreadBadge();
        }
      }
    })
    .subscribe();

  // Subscribe to read receipts updates
  if (chatReadChannel) { chatDb.removeChannel(chatReadChannel); }
  chatReadChannel = chatDb.channel('trip-reads-' + TRIP_ID)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_message_reads', filter: 'trip_id=eq.' + TRIP_ID }, function() {
      refreshReadReceipts();
    })
    .subscribe();
}

async function markRead(msgId) {
  if (!chatDb || !window._ravenUserId || !window._ravenFirstName) return;
  try {
    await chatDb.from('trip_message_reads').upsert({
      trip_id: TRIP_ID,
      user_id: window._ravenUserId,
      first_name: window._ravenFirstName,
      last_read_msg_id: msgId,
      updated_at: new Date().toISOString()
    }, { onConflict: 'trip_id,user_id' });
  } catch(e) {}
}

async function refreshReadReceipts() {
  if (!chatDb) return;
  try {
    const { data } = await chatDb.from('trip_message_reads').select('*').eq('trip_id', TRIP_ID);
    if (!data) return;
    // Find the last message el and update its read receipt row
    const msgs = document.getElementById('chat-msgs');
    const allMsgEls = msgs.querySelectorAll('[data-msg-id]');
    if (!allMsgEls.length) return;
    const lastMsgEl = allMsgEls[allMsgEls.length - 1];
    let readEl = lastMsgEl.querySelector('.read-receipt');
    if (!readEl) {
      readEl = document.createElement('div');
      readEl.className = 'read-receipt';
      readEl.style.cssText = 'font-size:10px;color:#6E6B80;margin:2px 4px 0;display:flex;align-items:center;gap:3px;flex-wrap:wrap;';
      lastMsgEl.appendChild(readEl);
    }
    const others = data.filter(r => r.user_id !== (window._ravenUserId || ''));
    if (others.length === 0) { readEl.innerHTML = ''; return; }
    const names = others.map(r => (r.first_name || '?').split(' ')[0]);
    readEl.innerHTML = '<span style="opacity:0.5">Read by</span> '
      + others.map(r => {
          const firstName = (r.first_name || '?').split(' ')[0];
          const colors = ['#7C3AED','#30D158','#0A84FF','#FF6B35','#F59E0B'];
          const bg = colors[firstName.charCodeAt(0) % colors.length];
          const initials = firstName[0].toUpperCase();
          return '<span style="display:inline-flex;align-items:center;gap:3px">'
            + '<span style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:' + bg + ';color:#fff;font-size:8px;font-weight:700">' + initials + '</span>'
            + '<span style="color:#9896A8">' + firstName + '</span>'
            + '</span>';
        }).join('<span style="color:#4A4760;margin:0 2px">·</span>');
  } catch(e) {}
}

function makePfp(name, avatarUrl) {
  const colors = ['#7C3AED','#E8633A','#0EA5E9','#30D158','#F59E0B','#EC4899','#14B8A6'];
  const bg = colors[(name||'').charCodeAt(0) % colors.length];
  const initial = (name||'?')[0].toUpperCase();
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'width:28px;height:28px;border-radius:50%;background:' + bg + ';flex-shrink:0;position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff';
  wrapper.textContent = initial;
  if (avatarUrl) {
    const img = document.createElement('img');
    img.src = avatarUrl;
    img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%';
    img.addEventListener('error', function() { this.style.display = 'none'; });
    wrapper.appendChild(img);
  }
  return wrapper;
}

function appendMsg(msg, scroll) {
  const empty = document.getElementById('chat-empty');
  if (empty) empty.remove();
  const container = document.getElementById('chat-msgs');
  const isMe = msg.user_id === (window._ravenUserId || '');
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const firstName = (msg.sender_name || 'Member').split(' ')[0];
  const avatarUrl = msg.avatar_url || '';

  const outer = document.createElement('div');
  outer.setAttribute('data-msg-id', msg.id || '');
  outer.style.cssText = 'display:flex;flex-direction:column;align-items:' + (isMe ? 'flex-end' : 'flex-start') + ';gap:2px;margin-bottom:4px';

  // Name label
  const nameLabel = document.createElement('div');
  nameLabel.style.cssText = 'font-size:10px;color:#9896A8;font-weight:600;margin-' + (isMe ? 'right' : 'left') + ':36px;text-align:' + (isMe ? 'right' : 'left');
  nameLabel.textContent = firstName;
  outer.appendChild(nameLabel);

  // Bubble row (pfp + bubble)
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:flex-end;gap:6px;' + (isMe ? 'justify-content:flex-end' : '');

  const pfpEl = makePfp(firstName, avatarUrl);

  // Bubble
  const bubble = document.createElement('div');
  bubble.style.cssText = 'max-width:75%;padding:' + (msg.gif_url || msg.photo_url ? '4px' : '9px 13px') + ';border-radius:' + (isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px') + ';background:' + (isMe ? '#0A84FF' : '#1A1A24') + ';color:#F0EEF8;font-size:13px;line-height:1.5';

  if (msg.gif_url) {
    const img = document.createElement('img');
    img.src = msg.gif_url;
    img.style.cssText = 'max-width:200px;border-radius:10px;display:block';
    bubble.appendChild(img);
  } else if (msg.photo_url) {
    const img = document.createElement('img');
    img.src = msg.photo_url;
    img.style.cssText = 'max-width:200px;border-radius:10px;display:block;cursor:zoom-in';
    img.addEventListener('click', function() { openChatPhotoLightbox(this.src); });
    bubble.appendChild(img);
  } else {
    bubble.textContent = msg.message || '';
    bubble.style.wordBreak = 'break-word';
  }

  if (isMe) { row.appendChild(bubble); row.appendChild(pfpEl); }
  else       { row.appendChild(pfpEl);  row.appendChild(bubble); }
  outer.appendChild(row);

  // Timestamp
  const ts = document.createElement('div');
  ts.style.cssText = 'font-size:10px;color:#6E6B80;margin:1px ' + (isMe ? '36px 0 0' : '0 0 0 36px') + ';text-align:' + (isMe ? 'right' : 'left');
  ts.textContent = time;
  outer.appendChild(ts);

  container.appendChild(outer);
  if (scroll) container.scrollTop = container.scrollHeight;
}

// ── CHAT GIF ──
function toggleChatGifPanel() {
  chatGifPanelOpen = !chatGifPanelOpen;
  const panel = document.getElementById('chat-gif-panel');
  panel.style.display = chatGifPanelOpen ? 'block' : 'none';
  if (chatGifPanelOpen) document.getElementById('chat-gif-search').focus();
}
function searchChatGifs(q) {
  clearTimeout(chatGifTimer);
  const container = document.getElementById('chat-gif-results');
  if (!q.trim()) { container.innerHTML = '<div style="color:#6E6B80;font-size:12px;padding:8px">Type to search...</div>'; return; }
  container.innerHTML = '<div style="color:#6E6B80;font-size:12px;padding:8px">Searching...</div>';
  chatGifTimer = setTimeout(function() {
    fetch(BACKEND + '/gif-search?q=' + encodeURIComponent(q))
      .then(function(r) { return r.json(); })
      .then(function(d) {
        const gifs = d.gifs || [];
        if (!gifs.length) { container.innerHTML = '<div style="color:#6E6B80;font-size:12px;padding:8px">No results</div>'; return; }
        container.innerHTML = '';
        gifs.forEach(function(g) {
          const url = g.preview || g.full || ''; if (!url) return;
          const img = document.createElement('img');
          img.src = url;
          img.style.cssText = 'height:70px;width:auto;border-radius:6px;cursor:pointer;object-fit:cover;border:2px solid transparent;flex-shrink:0';
          img.addEventListener('mouseover', function() { this.style.borderColor = '#0A84FF'; });
          img.addEventListener('mouseout',  function() { this.style.borderColor = 'transparent'; });
          img.addEventListener('click', function() {
            chatGifUrl = g.full || url;
            document.getElementById('chat-gif-preview').src = chatGifUrl;
            document.getElementById('chat-gif-preview-wrap').style.display = 'flex';
            chatGifPanelOpen = false;
            document.getElementById('chat-gif-panel').style.display = 'none';
            document.getElementById('chat-gif-search').value = '';
            container.innerHTML = '';
          });
          container.appendChild(img);
        });
      }).catch(function() { container.innerHTML = '<div style="color:#FF6B6B;font-size:12px;padding:8px">Error</div>'; });
  }, 400);
}
function clearChatGif() {
  chatGifUrl = null;
  document.getElementById('chat-gif-preview-wrap').style.display = 'none';
  document.getElementById('chat-gif-preview').src = '';
}

// ── CHAT PHOTO ──
function openChatPhotoPicker() {
  document.getElementById('chat-photo-input').click();
}
async function handleChatPhoto(input) {
  const file = input.files[0]; if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('Photo must be under 5MB', false); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    document.getElementById('chat-photo-preview').src = e.target.result;
    document.getElementById('chat-photo-preview-wrap').style.display = 'flex';
    window._chatPhotoData = e.target.result; // base64 data URL
  };
  reader.readAsDataURL(file);
  input.value = '';
}
function clearChatPhoto() {
  window._chatPhotoData = null;
  document.getElementById('chat-photo-preview-wrap').style.display = 'none';
  document.getElementById('chat-photo-preview').src = '';
}

async function sendChat() {
  if (!chatDb) await initChatDb();
  const { data: { session } } = await chatDb.auth.getSession();
  if (!session) { toast('Please sign in to chat'); return; }
  window._ravenUserId = session.user.id;

  // Always prefer localStorage profile for name + avatar
  try {
    const lp = JSON.parse(localStorage.getItem('raven_profile') || '{}');
    if (lp.first_name) window._ravenFirstName = lp.first_name;
    if (lp.avatar_url) window._ravenAvatarUrl = lp.avatar_url;
  } catch(e) {}
  const firstName = window._ravenFirstName || session.user.user_metadata?.full_name?.split(' ')[0] || session.user.email?.split('@')[0] || 'Member';
  const avatarUrl = window._ravenAvatarUrl || '';
  window._ravenFirstName = firstName;

  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  const gifUrl = chatGifUrl;
  const photoData = window._chatPhotoData || null;

  if (!message && !gifUrl && !photoData) return;

  input.value = ''; input.style.height = 'auto';
  clearChatGif();
  clearChatPhoto();

  await chatDb.from('trip_messages').insert({
    trip_id: TRIP_ID,
    user_id: session.user.id,
    sender_name: firstName,
    avatar_url: avatarUrl || null,
    message: message || '',
    gif_url: gifUrl || null,
    photo_url: photoData || null,
    created_at: new Date().toISOString()
  });
}

function openChatPhotoLightbox(src) {
  let lb = document.getElementById('chat-photo-lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'chat-photo-lightbox';
    lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:20px';
    lb.addEventListener('click', function() { this.remove(); });
    const img = document.createElement('img');
    img.id = 'chat-lightbox-img';
    img.style.cssText = 'max-width:100%;max-height:90vh;border-radius:12px;object-fit:contain;box-shadow:0 20px 60px rgba(0,0,0,0.8)';
    lb.appendChild(img);
    document.body.appendChild(lb);
  }
  document.getElementById('chat-lightbox-img').src = src;
  lb.style.display = 'flex';
}

// Init chat db on load + seed user identity from localStorage profile
initChatDb().then(async function() {
  if (!chatDb) return;
  try {
    // Pull from localStorage first (fastest, always available)
    try {
      const lp = JSON.parse(localStorage.getItem('raven_profile') || '{}');
      if (lp.first_name) window._ravenFirstName = lp.first_name;
      if (lp.avatar_url) window._ravenAvatarUrl = lp.avatar_url;
    } catch(e) {}
    // Then confirm user_id from session
    const { data: { session } } = await chatDb.auth.getSession();
    if (session?.user) {
      window._ravenUserId = session.user.id;
      // Only fall back to session metadata if localStorage didn't have a name
      if (!window._ravenFirstName) {
        window._ravenFirstName = session.user.user_metadata?.full_name?.split(' ')[0] || session.user.email?.split('@')[0] || 'Member';
      }
    }
    // Check for unread messages
    checkUnreadChatMessages();
  } catch(e) {}
});

</script>

<!-- ── GROUP CHAT MODAL ── -->
<div id="chat-modal" style="display:none;position:fixed;bottom:24px;right:24px;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 100px);background:#0C0C12;border:1px solid rgba(0,140,255,0.3);border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,0.7);z-index:1000;flex-direction:column;overflow:hidden">
  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#13131A;border-bottom:1px solid rgba(255,255,255,0.07);flex-shrink:0">
    <div>
      <div style="font-size:13px;font-weight:700;color:#F0EEF8" id="chat-trip-title">Group Chat</div>
      <div style="font-size:10px;color:#6E6B80" id="chat-member-count"></div>
    </div>
    <button onclick="closeChat()" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:50%;width:28px;height:28px;color:#9896A8;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center">×</button>
  </div>
  <!-- Messages -->
  <div id="chat-msgs" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;min-height:0">
    <div id="chat-empty" style="text-align:center;color:#6E6B80;font-size:12px;padding:30px 0">No messages yet. Say hi! 👋</div>
  </div>
  <!-- GIF panel -->
  <div id="chat-gif-panel" style="display:none;background:#13131A;border-top:1px solid rgba(255,255,255,0.07);padding:8px 12px;flex-shrink:0">
    <input id="chat-gif-search" type="text" placeholder="Search GIFs..." oninput="searchChatGifs(this.value)" style="width:100%;padding:8px 12px;background:#1A1A24;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#F0EEF8;font-size:12px;outline:none;margin-bottom:6px">
    <div id="chat-gif-results" style="display:flex;gap:6px;flex-wrap:wrap;max-height:120px;overflow-y:auto">
      <div style="color:#6E6B80;font-size:12px;padding:4px">Type to search...</div>
    </div>
  </div>
  <!-- Previews -->
  <div id="chat-gif-preview-wrap" style="display:none;align-items:center;gap:8px;padding:6px 12px;background:#13131A;border-top:1px solid rgba(255,255,255,0.07);flex-shrink:0">
    <img id="chat-gif-preview" src="" style="height:60px;border-radius:8px">
    <button onclick="clearChatGif()" style="background:rgba(255,68,68,0.15);border:1px solid rgba(255,68,68,0.3);border-radius:6px;color:#FF6B6B;font-size:11px;padding:4px 8px;cursor:pointer">✕ Remove</button>
  </div>
  <div id="chat-photo-preview-wrap" style="display:none;align-items:center;gap:8px;padding:6px 12px;background:#13131A;border-top:1px solid rgba(255,255,255,0.07);flex-shrink:0">
    <img id="chat-photo-preview" src="" style="height:60px;border-radius:8px;object-fit:cover">
    <button onclick="clearChatPhoto()" style="background:rgba(255,68,68,0.15);border:1px solid rgba(255,68,68,0.3);border-radius:6px;color:#FF6B6B;font-size:11px;padding:4px 8px;cursor:pointer">✕ Remove</button>
  </div>
  <!-- Input row -->
  <div style="padding:10px 12px;border-top:1px solid rgba(255,255,255,0.07);flex-shrink:0;background:#0C0C12">
    <div style="display:flex;gap:6px;align-items:flex-end">
      <!-- GIF button -->
      <button onclick="toggleChatGifPanel()" title="GIF" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:10px;width:34px;height:34px;color:#9896A8;cursor:pointer;font-size:11px;font-weight:700;flex-shrink:0;display:flex;align-items:center;justify-content:center">GIF</button>
      <!-- Photo button -->
      <button onclick="openChatPhotoPicker()" title="Photo" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:10px;width:34px;height:34px;color:#9896A8;cursor:pointer;font-size:16px;flex-shrink:0;display:flex;align-items:center;justify-content:center">📷</button>
      <input id="chat-photo-input" type="file" accept="image/*" style="display:none" onchange="handleChatPhoto(this)">
      <!-- Text input -->
      <textarea id="chat-input" placeholder="Message the group..." rows="1" style="flex:1;background:#1A1A24;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:9px 12px;color:#F0EEF8;font-family:'Epilogue',sans-serif;font-size:13px;resize:none;outline:none;max-height:80px;line-height:1.5;transition:border 0.2s" onfocus="this.style.borderColor='rgba(0,140,255,0.4)'" onblur="this.style.borderColor='rgba(255,255,255,0.1)'" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChat()}" oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"></textarea>
      <!-- Send button -->
      <button onclick="sendChat()" style="background:#0A84FF;border:none;border-radius:12px;width:34px;height:34px;color:#fff;font-size:18px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center">↑</button>
    </div>
  </div>
</div>

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
    const { token, name, trip_date, due_date, end_date } = req.body;
    const { data: trip } = await supabase.from('trips').select('share_token').eq('id', tripId).single();
    if (!trip || trip.share_token !== token) return res.json({ success: false, error: 'Invalid token' });
    if (!name?.trim()) return res.json({ success: false, error: 'Name required' });
    const update = { name: name.trim() };
    if (trip_date) update.trip_date = trip_date; else update.trip_date = null;
    if (due_date)  update.due_date  = due_date;  else update.due_date  = null;
    if (end_date)  update.end_date  = end_date;  else update.end_date  = null;
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

    // Load current member_emails
    let memberEmails = [];
    try { memberEmails = Array.isArray(trip.member_emails) ? trip.member_emails : JSON.parse(trip.member_emails || '[]'); } catch(e) {}

    for (const m of (members || [])) {
      if (!m) continue;
      const clean = m.trim();

      // Check if input looks like a raven_id (@handle or handle)
      const isRavenId = /^@?[a-z0-9_]{2,30}$/i.test(clean) && !clean.includes(' ') && !clean.includes('@');
      const ravenHandle = clean.replace(/^@/, '').toLowerCase();

      // Try to look up the user by raven_id first
      let resolvedName = clean;
      let resolvedEmail = null;
      if (isRavenId) {
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('first_name, last_name, email, raven_id')
            .eq('raven_id', ravenHandle)
            .maybeSingle();
          if (profile) {
            resolvedName = profile.first_name || clean;
            resolvedEmail = profile.email || null;
          }
        } catch(e) {}
      }

      // Add display name to people array if not already there
      if (!newPeople.map(p => p.toLowerCase()).includes(resolvedName.toLowerCase())) {
        newPeople.push(resolvedName);
      }

      // Add email to member_emails so their Trip Hub auto-loads this trip
      if (resolvedEmail && !memberEmails.includes(resolvedEmail.toLowerCase())) {
        memberEmails.push(resolvedEmail.toLowerCase());
      }
    }

    await supabase.from('trips').update({
      people: JSON.stringify(newPeople),
      member_emails: JSON.stringify(memberEmails)
    }).eq('id', tripId);

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
    const { name, total, splits, token, items, paid_by, tax, tip, service_fee } = req.body;
    const { data: trip } = await supabase.from('trips').select('*').eq('id', tripId).single();
    if (!trip) return res.json({ success: false, error: 'Trip not found' });
    if (trip.share_token !== token) return res.json({ success: false, error: 'Invalid token' });
    const tripReceiptRow = { trip_id: tripId, name: name||'Receipt', total: parseFloat(total)||0, splits: JSON.stringify(splits||{}), items: JSON.stringify(items||[]), paid_by: paid_by||null, created_at: new Date().toISOString() };
    if (parseFloat(tax) > 0) tripReceiptRow.tax = parseFloat(tax);
    if (parseFloat(tip) > 0) tripReceiptRow.tip = parseFloat(tip);
    if (parseFloat(service_fee) > 0) tripReceiptRow.service_fee = parseFloat(service_fee);
    await supabase.from('trip_receipts').insert(tripReceiptRow);
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

// ─── DELETE RECEIPT (admin only — verified by share token) ───────────────────
app.post('/trip/:tripId/receipt/:receiptId/delete', async (req, res) => {
  try {
    const { tripId, receiptId } = req.params;
    const { token } = req.body;
    const { data: trip } = await supabase.from('trips').select('share_token,creator_email').eq('id', tripId).single();
    if (!trip || trip.share_token !== token) return res.json({ success: false, error: 'Invalid token' });
    await supabase.from('trip_receipts').delete().eq('id', receiptId).eq('trip_id', tripId);
    // Recalculate trip total and receipt count
    const { data: remaining } = await supabase.from('trip_receipts').select('total').eq('trip_id', tripId);
    const newTotal = (remaining||[]).reduce((s,r) => s + parseFloat(r.total||0), 0);
    await supabase.from('trips').update({ total: newTotal, receipt_count: (remaining||[]).length }).eq('id', tripId);
    res.json({ success: true });
  } catch(err) { console.error('Delete receipt error:', err); res.json({ success: false, error: err.message }); }
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

// ── RAVEN OG IMAGE — generates branded social preview card ───────────────────
app.get('/raven-og-image', (req, res) => {
  // Serve the actual raven mascot as a JPEG — iMessage requires a real image, not SVG
  const RAVEN_OG_JPEG_B64 = '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lGyejIlCLlzNaozrlDgl2XJ7d6be3N1eXH2i7YPJsRMqgXCqoVRhQB0A/rUssR3l3OO4pqXfl7v9HVye5rGSRoi/oGi2errftea5Z6atlZvcqLgnNw64xEgHVjn9KyTLOkUlvGwMTurMNo+8M4569zW74j0OwsNTa10jxBbazbLDDJ9rtonij3vGrPGFcA5RiUJ6EqSOKxJA6IYAOc8H0pSjZWtqCld3uV5HIwpODnkURxSu2EBqQWzKPMfrU9vfx26PG9tHIWOQSOVPsayUU37+hpfTQbeX17cRWlrdXG6Ozi8mBdoGxNxbHA5+ZicnJ5qq6u4MiqxQEKWxxn0z6024dpWDdPaovMm2GLzG8sndtzxn1x61nJlLYd5jrhgwznPTpV//AImmu39xcMkt3dy77iZlUZIHLMQMACs8LnqcY9qkWSaFm8iZ13goxUkZU9R9KhdmP0GyEDkHJp9pfXdk0zWzIpmgkhfdGrfIwwwGQcHHQjkdqgbIxxj6U5ecnGeD/Kj0AZh1AbHBppc8/wCFB46U5ULnApdRirPOLVrUFfLaQSEbBncAQOeuME8ZxSLnO3oTT1iAyrevFKVCuozz61VmxaCMrI6MGAYNx9adczTy7YXcFUd2UAAYLYz/ACpJPvJn+9SyBS3bqaHtZBoJHJtOMdKfIxYZzTFhaT7q8VHIHTjOKLtKwtGyWW9nmMfmvnyoliXCgYUdBx169TzTkuGdCN1VgpY8ckinEMOMEUrvoNpMRmOc56e1PvLq4vbuW6uSrSyuWchQoJPsAAPwqMlj17Ur/eP1pajQ3tig9frUiQyyIXVDhepqOk00IfdTz3FxJNMwZ3OWIUAZ+g4pgDfWlYHcTRnHFFgGEjPPFTebJNK0kpBYhRwAOAMDp7VGQM06NdrN+FCuUtySiiimMKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAntwNhJ9amKg9qjtRmM/71T4APHStYq6MpPUZtAPSpFnljG0OQD2zSHGaTnIxVptbEOzDk/M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/u88HvVieC6thEJoHj82JJkDD7yN0b6EVXKMedpzn0rkla2hul3G5wOBQ+S5LHv0pfLfoEOfpU1zbz29xJb3ETxSxsUdGXBVh1BFRZlJq5XbAHWgA9MYqWSJ9mdppgD91NOzFe46VVWQhmqVdsYQrzznmm3drc29w8FxA6SocMrDBHFL5MoiVtjdcdKpXTJZXuGDyMxPJNNXH8qdLDICSyEH6U6a1ubOUw3dvJDJtV9jrtO1hlTj0III+tS73uXGw2iiipLCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKANbSU3WzEf89D/ACFakOQcCqWhKDZv6+Yf5CtGNCDx0rvpR91M4qj95lqINwKuwr05qrCv44FXYRnHsa64I5Z66ndfDDwdp/izWZpvEWoS6d4b0S3Opa7fRAGSG0VguyIHgzSuyxRj+8+eimvT/En7VMGi3VhLDoVrZ22jx/ZfD3huA5ttJtRypyD887feeQ/MzEk9q8dXVUXwN/wjVjdSW899qovdRcISZYoYttsinphXkmcg9yp5xXI6z4OgvnWbT9TnglKhX887w57nIAIz6c1vGdSneVNXZFoT92b0PSPFP7UHxQ8YTLHJq7WkM2/IeQnbzycDJAx3rl4vF9yY5Dd+OjG68hVPBH+z9459sVxVz4A8eW0JuNNh/tKLYQ7afJ5jqvcNGMOPfiuUlhvYJWglhkilj4dGBVgfcHkVzTxuIT9650ww1J/DY9wPxF063vLVJfihq8kScs8NjI64PYBinT1q9c/E7wzcq0L/ABa8e4DEgLYRqrfQGcnFfP5lmA2ursO2e1J5qhiRnHYGs3j6nX9S/qkD6b8MfFDw/aRpJb/HLxnpU1u3JGjrISD3P7/kewr0zR/2ifElijfZv2rr3ykYeUbvw3LJkdj8spx9K+FvOycM2QTz6VattTmtS32aeSMn+63GPoetXHMGt/zJlg09j9DNM/aH+ON5CZvDf7UHw71OFVJKavZzWpA9w0bCtI/E79o6+g8y40f4B+Mf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FGY96FQSGU4IYEkH6cVxsq3k6Ms8bS8BVL5JUDoB7dsV0fivT7l76e3t72e+W0iQRSqucxHnc5B4+8BxWHHbaeNHur251eaPUoriJLez+zFkmiIbfIZM/KVIXC4Oc9sV3U48tNc2rOCo7zdjKkgkXK/Z+nB5qj8QPD2p+HLyxttVt1hlubOK8RVfd+7ljV0z6HawyO1dBGmiPoV9LeHUf7W82EWXlsn2fy+fN83Pzbvu7ccdc1zPjlQL63lXVBfCWFJCwVlEbFVzFhv7p+X044qZXuCVkc3RRRUDCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAPRvhyudCnP8A09t/6AldWIWPIFct8NiBoc4P/P23/oCV2aMgXrzX0uES9jH0PAxTtVkVliYVat4O5phcAggVNHLgZ/OupJXOaTdixJAFTIIqvtYHmn+czgDtTSwJFUZq5NGhJGBVqSIswUDGahtm3Oo21pXLxmcyR2wiBwQgYkD8TzWsI6GcpWZA0QjwDipLcHzF+ozSt+7dhImTVixeKOeN5YBKgYFo9xXcPTI5FapWZLd0IhYttA/GrcCEPgGoEIHIXH41ZicAD5OR79a1jYyZft5HSKUo2CRg8ds0sWQeKWCeEW00ZtFd3C7HLkeXzzx3z70sZ9APzrQyRpW885hSDzSY8mQKegOMZ/KtewaEGMH52HzewxWHF94fJtBHHNdn4As/C+p+IbKw8U6q2k6ftkE92mXbO1ivHbJwtbU5cruznrbHV3/jGTUtL05YrFUisCIy23hmxnH5Uvjjxzd+P9VtdQn021s0tLeO3VbeMKNo7nHU1wvnJDfSJBKZIBIQuDjeAevtxWrp15HDcxyGBZUDDMb5w3PQkc11+0U3qcH1aEPeS1L0S7jubk5zk9a8wt/AEmh/EjX7DSd9ta65ZQaxp06D/UXcLhXwO5UlWx3B9DXpkcu9zhAgJ7EnFTTaf9ruLO6DL5tlOJUySAw6MmR2YcemQKwr0o1GpPdM6MPXlR5o90Zfinwx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1OfN6mj4X8ZXHh2fbN5/2eRWidEch0U9cHuOhx6810lzdxX0wk/tASW9yB9nuP4Hz/yzk9HHr+NecK3ln7Ldg9flcc8f1Fb0UWpaLai4to0nsblAZI3w4x+H5+orirQpz0no+56mDrVqfwaxW6PQPDnhhNS1JNMlYx3DsrGPyiVbkdXH3SR0cfjX6F/EL4DeE/2ZvhFoPi7TpZ9a1W6uYhqCX1yVt7lGj3eWYxwcY4YfN3z2r80dG8XgSJbNdzRLH/x7uWzLEPQMPvr7Hmu08afFX4l+JdJtdI1bxdqOo2toitbRS3jyIABgNHuPGOnqOlfL4/AYyviqfJPlinr5n1FDFUPZKpB2tuu+mx7j4lutB+Is8d7pt19gEeUNrMcrAzHOMD7qn1GQf0ryzxf8KtM1aR4b5Ps18gwlzDjkdiezr+tea6J45vI7lIZrme0vIxsBXow9NpOD9OPb0r1DT/iPYNpkN1IdstqwQA5kUyeqbh26mN/wJr7PLZyoP2dT3ofij47N4U8WnVorlqL7meU+OfhN40+HQt21/SkudPvYBdQzw5ZGjJxkj70bf55rhZXXakMFxK8CZKRyHPlk9cducDkdcV9bReJLnxhEuoanqn9psyeX5jDgL/dC9FA9K8O+NPhTR/Dt9p97pVoLZtR84zIn3MpswQO33zmvbxeBhTpe2ov3T5rCY2c6nsaytI82oooryT1QooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD6f8A2XtB8Tah4Cv7/RYJGhTV5Y3YA43CGE4/Iivc7fw/4mFuJruNgR2B5qj/AME/28f6Z8D9a1rR/C9lrPh9/FVxbTK8oSVJxaWhbGRjG1k79c19Hya14cuYpX1HwVrWmsoO9xZtNCD/AL6ZFff5VO2Eh6H51m9WSxlRJdTxPTIdQZQh85SOpxXT2+irNat5rzFs5ztrtNBufBWvXJttElaa5U8wrEd/5V21p4Du7mJ400m/XdyC1swFelKrGC948ec5N6I8i0/w+kcglhkY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3F3SMK31Fz8pkfOfWtKPV5o02CZsfWorzRtLLf6HdeU/Xa3SsW+ttStDlwSvYrzWNbDSXmdFDFK512meIGt3O51UEYyUDA1ieJVWaY3EaQENzmM4z+FYcdxdsQofrVtopXCiWQcj0rzPYqnU5keusW6tL2bMx2O49R24NNUkkAMRVqa2RGI3E1ZsLa0k3rJE8jY+UA4ro50kcMaUpy3MuXIYjcD7ikhl8tslc46VPMh8xgse3B6VCFyM45rRLmRlL3ZDnmMpJLGog2DgNn8KeNvQD8qAischcYp25UQ5ObLlvqkyxC3k2vH/AHSOlDQblEkQcgnpjp+NVowFcMAPSut0bxU9laG2ls4JlXkEqMiuaq3TV4K534dRrPlqysjnYbS5nYLvKD1fgCte3jOlESC8hkbGQyPjFQ61rVtqkxkWy8l+h8s4FYxeVWypP480kpVFroW506D93XzNpdWW2u0voNUliuEbcGBOVPsc1JP4qklkeeTUbiaZzl2Zidx9TmuYl8523Ec1CQwOCDmto0I7mE8bNJpI6g+LLgkA4Y+9PHi+5A2snHs1criTGKNreldMLx0TOCpPn3R0E2vG6PzTFM+q1RvJDIVJmEmM9B06Vm4f3qaIEZzWibMkkiSiiigoKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA+jv2cFZvA9782F/taXP/AH5hr1y1W2juQ/LEe1eRfs43EMfge+jkYhjqspx7eTDXrFtcxg8bevWv0XKl/sdP0Pisxv8AWZ+psf2nsbENueO+KkW6knGNgBNZRvT5uEUEnippJpI8MZAgPXFejc81qxuWt5c2oDm8cBf4Nxx+VdronxhvtBtPsiWdvcRkYIdATj615UL+BMhpy31qGXWbaPhcE/WplGMlaRLp8256NN4E+DvxPvZL7xD5WnXkxyT9zmuf+JX7O/hfwP4b/tbwXq0eoyAZWEsDn6EVyA1jzSQ7gLXQaHe7tqfamdSeVY5GKwnhYVX2LjKrQ1UnbsZfgXxV4sud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';
  const buf = Buffer.from(RAVEN_OG_JPEG_B64, 'base64');
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=604800'); // 1 week
  res.setHeader('Content-Length', buf.length);
  res.end(buf);
});

// ── FRIEND INVITE PAGE — rich iMessage/OG preview ────────────────────────────
app.get('/friend-invite/:ravenId', async (req, res) => {
  try {
    const { ravenId } = req.params;
    const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    // Look up the person's profile
    const { data: profile } = await supabase.from('profiles')
      .select('first_name,last_name,avatar_url,raven_id')
      .eq('raven_id', ravenId.toLowerCase())
      .maybeSingle();

    const name = profile ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') || ('@' + ravenId) : ('@' + ravenId);
    const dashboardUrl = 'https://ravensplit.com/dashboard.html?add=' + encodeURIComponent(ravenId);
    const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : `https://raven-backend-production-fb1f.up.railway.app`;

    // OG image: use Railway-served raven card (works immediately without file upload)
    const ogImage = `${baseUrl}/raven-og-image?name=${encodeURIComponent(name)}&id=${encodeURIComponent(ravenId)}`;

    // Avatar HTML for the invite page
    const avatarHtml = profile?.avatar_url
      ? `<img src="${esc(profile.avatar_url)}" style="width:90px;height:90px;border-radius:50%;object-fit:cover;border:3px solid #30D158;display:block;margin:0 auto 16px">`
      : `<div style="width:90px;height:90px;border-radius:50%;background:linear-gradient(135deg,#7C3AED,#30D158);display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:800;color:#fff;margin:0 auto 16px">${esc(name[0]?.toUpperCase()||'R')}</div>`;

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(name)} wants to be your RAVEN friend 🪶</title>
<meta property="og:title" content="🪶 ${esc(name)} wants to connect on RAVEN">
<meta property="og:description" content="@${esc(ravenId)} invited you to be RAVEN friends. Split bills, track trips & settle up instantly.">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="1024">
<meta property="og:image:height" content="1024">
<meta property="og:url" content="${baseUrl}/friend-invite/${esc(ravenId)}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="🪶 ${esc(name)} wants to connect on RAVEN">
<meta name="twitter:description" content="Tap to add @${esc(ravenId)} as a RAVEN friend">
<meta name="twitter:image" content="${ogImage}">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'Helvetica Neue',sans-serif;background:#06060A;color:#F0EEF8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{background:#0C0C12;border:1px solid rgba(255,255,255,0.1);border-radius:24px;padding:40px 32px;max-width:380px;width:100%;text-align:center;box-shadow:0 40px 80px rgba(0,0,0,0.6)}
.raven-logo{font-size:44px;margin-bottom:8px}
.brand{font-size:13px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#6E6B80;margin-bottom:32px}
.invite-text{font-size:17px;font-weight:600;color:#F0EEF8;margin-bottom:6px}
.raven-id{font-size:14px;color:#A855F7;font-weight:600;margin-bottom:28px}
.btn-accept{display:block;width:100%;padding:16px;background:#30D158;color:#000;border:none;border-radius:14px;font-size:16px;font-weight:800;text-decoration:none;letter-spacing:0.02em;margin-bottom:12px;transition:opacity 0.15s}
.btn-accept:hover{opacity:0.9}
.btn-secondary{display:block;width:100%;padding:14px;background:transparent;color:#6E6B80;border:1px solid rgba(255,255,255,0.1);border-radius:14px;font-size:14px;font-weight:600;text-decoration:none}
.divider{height:1px;background:rgba(255,255,255,0.07);margin:24px 0}
.footer{font-size:12px;color:#4A4760;line-height:1.6}
</style>
</head>
<body>
<div class="card">
  <div class="raven-logo">🪶</div>
  <div class="brand">RAVEN</div>
  ${avatarHtml}
  <div class="invite-text">${esc(name)} wants to be your RAVEN friend</div>
  <div class="raven-id">@${esc(ravenId)}</div>
  <a href="${dashboardUrl}" class="btn-accept">🪶 Accept &amp; Add Friend →</a>
  <a href="https://ravensplit.com/dashboard.html" class="btn-secondary">Sign in to existing account</a>
  <div class="divider"></div>
  <div class="footer">
    RAVEN splits bills with AI, tracks group trips, and settles up instantly.<br>
    No app download required.
  </div>
</div>

</body>
</html>`);
  } catch(err) {
    res.redirect('https://ravensplit.com/dashboard.html');
  }
});

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

    console.log('Scan request: mediaType=' + mt + ' imageSize=' + Math.round(image.length * 0.75 / 1024) + 'KB');

    // MAX POWER: claude-opus-4-5 with extended thinking for best accuracy
    // Falls back to sonnet if opus unavailable
    const modelsToTry = ['claude-opus-4-5', 'claude-sonnet-4-6'];
    let lastError = null;
    let raw = '';

    const receiptPrompt = `You are an expert receipt OCR system. Examine this receipt image with extreme care.

Your job: Extract EVERY purchased item and return ONLY a valid JSON object. No markdown fences, no explanation, no surrounding text — just the raw JSON.

EXTRACTION RULES:
- Include ALL food, drink, and product line items with their exact prices
- For combo meals: list as one item with the combo price
- For quantity items (e.g. "2x Burger $10.00"): list once with total price OR split into separate items — your choice
- For Costco/warehouse: item# then name then price — use the name only, drop the item#
- EXCLUDE: subtotals, tax lines (unless no line items found), tip lines, payment lines (VISA/CHIP/CASH), "APPROVED", "CHANGE DUE", "AMOUNT TENDERED", barcodes, member numbers, store addresses, cashier names, transaction IDs, category codes (E/A/S)

TOTALS: Extract subtotal (items before tax), tax amount, tip if shown, and grand total separately.

IMPORTANT: If the image is blurry or partially obscured, do your best — extract what you can see clearly.

Return EXACTLY this JSON structure (no other text):
{"bill_name":"Exact Restaurant/Store Name from top of receipt","items":[{"name":"Item Name","price":0.00}],"subtotal":0.00,"tax":0.00,"tip":0.00,"total":0.00}`;

    for (const model of modelsToTry) {
      try {
        console.log('Trying model:', model, 'imageSize:', Math.round(image.length * 0.75 / 1024) + 'KB');

        const msgParams = {
          model,
          max_tokens: 8000,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mt, data: image } },
              { type: 'text', text: receiptPrompt }
            ]
          }]
        };

        // Use extended thinking on opus for max accuracy
        if (model.includes('opus')) {
          msgParams.thinking = { type: 'enabled', budget_tokens: 4000 };
          msgParams.max_tokens = 12000;
        }

        const message = await getAnthropic().messages.create(msgParams);

        // Extract text content (skip thinking blocks)
        const textBlock = message.content.find(b => b.type === 'text');
        raw = textBlock?.text || '';
        console.log('Model', model, 'responded, length:', raw.length);
        console.log('First 300 chars:', raw.slice(0, 300));
        lastError = null;
        break;
      } catch(modelErr) {
        console.error('Model', model, 'failed:', modelErr.status, modelErr.message?.slice(0,150));
        lastError = modelErr;
        if (modelErr.status === 401) break;
        // If thinking not supported, retry same model without it
        if (modelErr.message?.includes('thinking') || modelErr.message?.includes('extended')) {
          try {
            console.log('Retrying', model, 'without extended thinking...');
            const message2 = await getAnthropic().messages.create({
              model, max_tokens: 8000,
              messages: [{ role: 'user', content: [
                { type: 'image', source: { type: 'base64', media_type: mt, data: image } },
                { type: 'text', text: receiptPrompt }
              ]}]
            });
            const tb2 = message2.content.find(b => b.type === 'text');
            raw = tb2?.text || '';
            lastError = null;
            break;
          } catch(e2) { lastError = e2; }
        }
      }
    }

    if (lastError) {
      if (lastError.status === 401) return res.json({ success: false, error: 'API key invalid — check ANTHROPIC_API_KEY in Railway' });
      if (lastError.status === 429) return res.json({ success: false, error: 'Rate limited — try again in a moment' });
      return res.json({ success: false, error: 'AI unavailable: ' + (lastError.message || 'unknown') });
    }

    if (!raw) return res.json({ success: false, error: 'AI returned empty response' });

    // Extract JSON — handle markdown fences and surrounding text
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error('No JSON found. Full response:', raw);
      // Last resort: try to extract just a total from the text
      const totalMatch = raw.match(/total[:\s]*\$?([\d,]+\.\d{2})/i);
      if (totalMatch) {
        const total = parseFloat(totalMatch[1].replace(',',''));
        console.log('Extracted total from text:', total);
        return res.json({ success: true, bill_name: 'Receipt', items: [{ name: 'Total', price: total }], subtotal: total, tax: 0, tip: 0, total });
      }
      return res.json({ success: false, error: 'Could not parse receipt' });
    }

    let parsed;
    try { parsed = JSON.parse(match[0]); }
    catch(e) {
      console.error('JSON parse failed:', e.message, match[0].slice(0, 300));
      return res.json({ success: false, error: 'Receipt data malformed' });
    }

    if (!parsed.items || !Array.isArray(parsed.items)) parsed.items = [];

    // If no items but have total, make one item
    if (parsed.items.length === 0 && (parsed.total > 0 || parsed.subtotal > 0)) {
      const amt = parsed.total || parsed.subtotal;
      parsed.items = [{ name: parsed.bill_name || 'Receipt', price: amt }];
    }

    console.log('Scan success:', parsed.bill_name, parsed.items.length, 'items, total:', parsed.total);
    res.json({ success: true, ...parsed });

  } catch(err) {
    console.error('Scan top-level error:', err.status, err.message);
    res.json({ success: false, error: err.message || 'Scan failed' });
  }
});

// ── REMIND UNPAID — send email reminders to participants who haven't paid ──────
app.post('/remind-dashboard', async (req, res) => {
  try {
    const { billId, userEmail } = req.body;
    if (!billId) return res.json({ success: false, error: 'No bill ID' });

    const { data: bill } = await supabase.from('bills').select('*, participants(*)').eq('id', billId).single();
    if (!bill) return res.json({ success: false, error: 'Bill not found' });
    if (bill.creator_phone !== userEmail) return res.json({ success: false, error: 'Not authorized' });

    const unpaid = (bill.participants || []).filter(p => !p.paid);
    if (unpaid.length === 0) return res.json({ success: true, sent: 0, message: 'Everyone has paid!' });

    const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : `https://raven-backend-production-fb1f.up.railway.app`;
    const billUrl = `${baseUrl}/bill/${billId}${bill.share_token ? '?t=' + bill.share_token : ''}`;

    let sent = 0, skipped = 0;

    for (const p of unpaid) {
      const isEmail = p.phone && p.phone.includes('@') && !p.phone.startsWith('unknown_');
      if (isEmail) {
        // Check email is confirmed in Supabase Auth
        let confirmed = false;
        try {
          const { data: au } = await supabase.auth.admin.getUserByEmail(p.phone);
          confirmed = !!(au?.user?.email_confirmed_at);
        } catch(e) { confirmed = true; }

        if (!confirmed) { skipped++; continue; }

        const html = `<div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;background:#06060A;color:#F0EEF8;border-radius:16px;padding:32px 28px">
          <div style="text-align:center;margin-bottom:24px"><div style="font-size:36px">🪶</div><div style="font-size:20px;font-weight:800;letter-spacing:0.1em">RAVEN</div></div>
          <h2 style="font-size:20px;margin-bottom:8px">Hey ${p.name} 👋</h2>
          <p style="color:#9896A8;font-size:15px;line-height:1.7;margin-bottom:20px">You still owe <strong style="color:#30D158">$${parseFloat(p.amount).toFixed(2)}</strong> for <strong style="color:#F0EEF8">${bill.name}</strong>.</p>
          <a href="${billUrl}" style="display:block;text-align:center;background:#30D158;color:#000;font-weight:800;font-size:16px;padding:16px;border-radius:12px;text-decoration:none;margin-bottom:20px">💳 Pay Now →</a>
          <p style="color:#6E6B80;font-size:12px;text-align:center">Sent via RAVEN by ${bill.creator_phone}</p>
        </div>`;

        if (process.env.RESEND_API_KEY) {
          try {
            const r = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RESEND_API_KEY}` },
              body: JSON.stringify({ from: 'RAVEN <reminders@ravensplit.com>', to: [p.phone], subject: `🪶 Reminder: You owe $${parseFloat(p.amount).toFixed(2)} for ${bill.name}`, html })
            });
            const rd = await r.json();
            if (rd.id) { sent++; continue; }
          } catch(e) {}
        }
        console.log(`[NEEDS RESEND_API_KEY] Email to: ${p.phone} | ${bill.name} | $${p.amount}`);
        sent++;
      } else if (p.phone && !p.phone.startsWith('unknown_') && /^\+?[\d]{7,}/.test(p.phone.replace(/[\s\-()]/g,''))) {
        await sendSMS(p.phone, `🪶 RAVEN Reminder: Hey ${p.name}, you owe $${parseFloat(p.amount).toFixed(2)} for ${bill.name}. Pay: ${billUrl}`);
        sent++;
      } else { skipped++; }
    }

    console.log(`Reminders: ${sent} sent, ${skipped} skipped for bill ${billId}`);
    res.json({ success: true, sent, skipped, total: unpaid.length });
  } catch(err) {
    console.error('Remind error:', err);
    res.json({ success: false, error: err.message });
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

// Sentry error handler — must be after all routes, before app.listen
if (Sentry) {
  Sentry.setupExpressErrorHandler(app);
}

// Generic error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🪶 RAVEN SMS server running on port ${PORT}`));
