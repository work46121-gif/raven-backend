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

  const participantsHTML = participants.length > 0 ? `
    <div style="max-width:800px;margin:20px auto 0;padding:0 20px">
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
    .hdr-i{max-width:800px;margin:0 auto;height:56px;display:flex;align-items:center;justify-content:space-between}
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
      // "Pay [creator name]" not "Pay [participant name]"
      const creatorName = p.first_name || 'Bill Creator';
      document.getElementById('pname').textContent = creatorName;
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
    ? `<div style="max-width:800px;margin:0 auto;padding:16px 20px 0"><div style="position:relative;width:100%;height:190px;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.07)"><img src="data:image/jpeg;base64,${trip.cover_image}" id="cover-img" style="width:100%;height:100%;object-fit:cover"><button id="cover-change-btn" style="position:absolute;bottom:10px;right:10px;padding:7px 14px;background:rgba(0,0,0,0.7);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;font-family:'Epilogue',sans-serif;font-size:12px;font-weight:600;cursor:pointer">📷 Change</button><input id="cover-upload" type="file" accept="image/*" style="display:none"></div></div>`
    : `<div style="max-width:800px;margin:16px auto 0;padding:0 20px"><div id="cover-empty" style="width:100%;height:100px;border:2px dashed rgba(124,58,237,0.3);border-radius:16px;display:flex;align-items:center;justify-content:center;gap:10px;cursor:pointer;background:rgba(124,58,237,0.03)"><span style="font-size:20px">🖼</span><span style="font-size:13px;color:#6E6B80;font-weight:500">Add a cover photo for this trip</span></div><input id="cover-upload" type="file" accept="image/*" style="display:none"></div>`;

  const avatarRow = people.map((p, i) =>
    `<div data-person-avatar="${esc(p)}" onclick="openMemberProfile('${esc(p)}')" title="${esc(p)}" style="width:32px;height:32px;border-radius:50%;background:${avatarColors[i%avatarColors.length]};border:2px solid #06060A;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0;margin-left:${i===0?'0':'-8px'};overflow:hidden;cursor:pointer">${esc(p[0].toUpperCase())}</div>`
  ).join('');

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
      const dueDateRow = trip.due_date ? `<div style="margin-top:10px;display:flex;align-items:center;justify-content:center;gap:6px;padding:6px 14px;background:rgba(255,107,53,0.07);border:1px solid rgba(255,107,53,0.2);border-radius:8px;display:inline-flex"><span style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#FF6B35">💰 Bill Due</span><span style="font-size:11px;color:#9896A8">${new Date(trip.due_date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span><span id="edit-due-date-btn" style="font-size:10px;color:#FF6B35;cursor:pointer;margin-left:4px;opacity:0.7">edit</span></div>` : `<div style="margin-top:10px;display:inline-flex;align-items:center;gap:6px;padding:5px 12px;background:rgba(255,255,255,0.03);border:1px dashed rgba(255,255,255,0.1);border-radius:8px;cursor:pointer" id="add-due-date-btn"><span style="font-size:10px;color:#6E6B80">+ Set bill due date</span></div>`;
    countdownHTML = `<div style="background:linear-gradient(135deg,rgba(124,58,237,0.12),rgba(48,209,88,0.08));border:1px solid rgba(124,58,237,0.22);border-radius:16px;padding:20px;text-align:center"><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:#C084FC;font-weight:700;margin-bottom:8px">✈️ Countdown to Trip</div><div style="font-size:72px;font-weight:900;line-height:1;color:#F0EEF8;margin-bottom:4px">${days}</div><div style="font-size:13px;color:#9896A8">day${days!==1?'s':''} to go · ${tripDateLabel}</div>${dueDateRow}</div>`;
    } else if (days === 0) {
      countdownHTML = `<div style="background:linear-gradient(135deg,rgba(48,209,88,0.12),rgba(124,58,237,0.08));border:1px solid rgba(48,209,88,0.3);border-radius:16px;padding:20px;text-align:center"><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:#30D158;font-weight:700;margin-bottom:8px">✈️ Today's the Day!</div><div style="font-size:48px;font-weight:900;line-height:1;color:#30D158;margin-bottom:4px">🛫</div><div style="font-size:13px;color:#9896A8">${tripDateLabel}</div></div>`;
    } else {
      const ago = Math.abs(days);
      countdownHTML = `<div style="background:rgba(48,209,88,0.06);border:1px solid rgba(48,209,88,0.18);border-radius:16px;padding:16px;text-align:center"><div style="font-size:13px;color:#30D158;font-weight:600">✅ Trip was ${ago>0?ago+' day'+(ago!==1?'s':'')+' ago':'today'} · ${tripDateLabel}</div></div>`;
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
<script id="page-data" type="application/json">${pageData}</script>

<div class="hdr"><div class="hdr-inner">
  <a href="https://work46121-gif.github.io/raven-site/dashboard.html" style="display:flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:20px;text-decoration:none;color:#9896A8;font-size:13px;font-weight:600;transition:all 0.15s" onmouseover="this.style.color='#F0EEF8';this.style.borderColor='rgba(255,255,255,0.25)'" onmouseout="this.style.color='#9896A8';this.style.borderColor='rgba(255,255,255,0.1)'">← Dashboard</a>
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
    <div style="margin-bottom:16px"><div style="font-size:12px;color:#6E6B80;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em">Trip Date</div><input id="settings-date" type="date"></div>
    <div style="margin-bottom:16px"><div style="font-size:12px;color:#6E6B80;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em">💰 Bill Due Date <span style="font-weight:400;text-transform:none;font-size:11px;letter-spacing:0">(RAVEN sends reminders after this)</span></div><input id="settings-due-date" type="date"></div>
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
if (DUE_DATE) { const dd = document.getElementById('settings-due-date'); if (dd) dd.value = DUE_DATE; }
// Wire up inline due date edit/add buttons
document.addEventListener('DOMContentLoaded', () => {
  const editBtn = document.getElementById('edit-due-date-btn');
  const addBtn  = document.getElementById('add-due-date-btn');
  if (editBtn) editBtn.addEventListener('click', () => openModal('settings-modal'));
  if (addBtn)  addBtn.addEventListener('click',  () => openModal('settings-modal'));
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
(function buildSavedReceiptsGallery() {
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
})();

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
    const dueDate = document.getElementById('settings-due-date')?.value || null;
    const r = await fetch(BACKEND+'/trip/'+TRIP_ID+'/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TRIP_TOKEN,name,trip_date:date||null,due_date:dueDate||null})});
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
    const { token, name, trip_date, due_date } = req.body;
    const { data: trip } = await supabase.from('trips').select('share_token').eq('id', tripId).single();
    if (!trip || trip.share_token !== token) return res.json({ success: false, error: 'Invalid token' });
    if (!name?.trim()) return res.json({ success: false, error: 'Name required' });
    const update = { name: name.trim() };
    if (trip_date) update.trip_date = trip_date; else update.trip_date = null;
    if (due_date)  update.due_date  = due_date;  else update.due_date  = null;
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
  const RAVEN_OG_JPEG_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAJ2BLADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8uqKXbRtrUBKKdgUYoAbRg06igBNtG2looAMCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooopgFFFFABRRRQAUUUUgCiiigAooooAKKKKACiiigAoxRRQAm2jbS0UANop1GBQA2il20lABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFABY8An6UAFFSJbyyfcid/91SaaY3U4KkH0Ip2YrobRS7G/un8qXy3/un8qBjaKd5b/wB1vyo8t/7p/KgBtFO8t/7p/Kk2N/dP5UAJRS7G/un8qNp9D+VACUU4RueisfwpTDIOqN+VFmK6GUU7y3P8LflR5Mn9xvyosFxtFSG2lAB8p8Hodp5pPIk/55v/AN8mizC6GUVILaY9InP/AAE1KNLvWt3nFpOYEYI0oibarHOATjGTg8e1Oz7BdFaipPs03/PJ/wDvk0fZpj/yyf8A75NKzC6I6KsR6ddzBjHazOFGWKxk4+tQmNwcFWB9CKdmF0Nop3lPt3bG25xnHGaTY390/lSGJRSlSM5BGPanz2s1rKY5oZIZAASkilSARkcH1BB/GgCOil2n0NOjgkmlSKON3kchVRVJLE9AB3oAZRU13ZXFhcPb3MEtvPGcPFKhVlPuDyKh2n0NABRUkdvLKkjpE7pGAzsqkhATgE+nPFR7T6GgAoowfSpPs0wRH8p9j52ttOGx1x60WbAjoqT7NLnHlPn/AHTSfZ5c48t8/wC6aLMV0MorRh8OatcadLqEWl3sthE4jkukt3MSORkKWxgE+lVJ7K4tZGjmglhkU4ZJEKkH0INNxktWhKSeiZDRT/s8vleb5b+Xu2b9pxuxnGfXFN2N/dP5UrMoSinLE7khUZiASQBngdTSbG/un8qLAJRRtPoale0nSCOZoZFhkJCSFSFYjrg98ZGfrQBFRQVI6gilVGdgqqWYnAAHJNACUU+aCS3leKWNo5EYq6OpBUjqCOxplIAopyxO0buEYomNzAcLnpk0zNAC0UmR60rKUxuBGRkZ7j1oAKKKVEaQ4RSxyF+UZ5PQUwEooPBIPUdqXafQ/lQAlFOWN3DFVZgoyxA6DpzSCNj0Un8KAEooIK9Rj60rIyorlSEbO1iODjrikAlFJuHqKMj1FAC0UMpTG4FcjIz3HrSZHrQAtFJuHqKUgqcEYPXBoAKKKKAHUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUU7AFFFFFgCiiinYAooopgFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFKwBRRRSsAUUUUAFFFFIAooooAKKKKACiiigBNtJg06igBtFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABUkH3z9KjqW3ba54zxVLcT2LlpfPaEhe9QyMZXLngmn+YMg7elSPcI6gBMVturNnPs72LFjpU18haNSQKrTQvBIY2HzZxXU+GPEMGnW8iSIpJHese+1GOTUPNWMFc5rpcKagnfUxU5OTVtDNZTGcMCM0g5571o6rfx6iUKRCMqMHHes7GOD1rnlFX0ZqpXWqDrTcZNOxQBnmosXcaRim7QaloCZNUhNjrfCtzV/datbz+aJRMAPJ2Y25zzuzz06Y71SVOfTNTiFsZI4rRXM2MjjDGpBGCfelt0y5H86sw24Z8EZ55qkhNkQQFQCfpQYtpr2LxX4R8AWnwo8N6lo2rTXXiy4Mg1KxYYWEA/Lj1zXlcluAcY4963lS5dzKNRSRXjj24NSfaZEgeESOImYM0YY7SR0JHTIyfzqRITIyqqkseAB1NRyRAkgjFHwj3InjwoJPWrelaTLq10lvAV8x+BvcKPxJp1tpVxexzvDGZI7ePzJTn7q5xn8zVNyUU4JH0ppW1ktAeuxqRa/b6bo91YmEid2IMqP19jXJSfMxOevNXruMEA8nNMjsJZra5nUJstwrOGcKcMwUYB5bk9unWsqs5Tsn0LglHXuLY6JcX9he3sRi8m0KebukVW+YkDCk5PTnHSqsVtPLHNcwxuUttpkkXomThSfxpjRMuMjBPIpQRErp8rl8c45XnPFc7s7aGyuiOQtK5kkk3vISWJOTnPJNWAsFtBKJoxNNLGjROk3+rOcncO/HGO1QMR5eNvOetOgiZ5o8RedyPkP8XtxUNWKGIhxv2kqOp7UhY7kZCVYHOQcY9KtRzvDaSwrM4ikkDPbLnYSoO1j6kZOPqaYqoI0Gz5wxJfd1Hpj+vvUlFaWaS4cySyPLIfvO7FifxNKARxjBqVxJcMCRu2IAAB0UfT+dNAJBON2BzSGRgsNwDMAR8wB4P19aI4tzBQDuPQZqza2ktwzrGpOVOcDORjmrVxbOSzXL+ZMQoDnk4AwAD6Yx+VaKEmr9CXJbGe0JSRkPJBwSpyKtKXEUavMfLUkqmSQvTPHbP61PKgedsRrEvTy0zgY+tX9L0u1vr6CG+vP7OtCW8y68oybPlJHyjk5IA/Gtowaehk5LqLepZhYGs7kyMUy6yjYUYds9/wrNDqx3Bjv6ge9RFVEi7lJTPzAcHFJEhDkjIq3Jt7CjGyNux8QavpVlqFlbX89vbXyCK6gik+SVQQcMOnUD8qy7hSBmRioxxVkTRJamMxnzS2d49PTFV5I/MTJOQKtttWuQkk7lQmVoPLEjmHfvEW47d2MbsdM44zVjTLe2bULVdQeS3sjIonliTcypn5iB3OO1Rb5InzHxj1rXB0y+0G2jEN5/bguJGnneRTbmDauxVTGQ4bcSScEEccVkldmlzM1QW6apd/2VLObIO6xPL8rtHyBux3I6is9yVAUnJPTBq9cQGBiEPUEdKhFkVUlutRJNvQaaRBHA8jcZHqfSpLmSSOOOF5XaKMsUQsSqk4zgds+3WnQX8tozeU2MjDehFVbhjMcseSazbjbTc01vqPZDJEZRgIpCnLDOT7d6gDlSpDMGBzkHGKb5ZyfbinqnHIrFllu2t5L/7VKZkBiQzSNNJhn57Z5ZjmqjnJ+XrQyjd6ZNMIJOev0oEPW4mjt5oVmdYZCpkjViFfBOMjvjJx9ajOVPDA/Q08g7Gz0qLHYdKTARs471I8kkxXfIz7VCLuYnCjoB7U5Idy805QoxnjinZhcZGu8HnFOiLR+YUdlIIxg45zwaEwxbFEZ5k+oqtgIxkMWJyc96mSXIxmkVfMOF606W2MS5JpJNaoTa2I2meISBXZQ42sAcbhkHB9eRSRzsG71HtJJHOanezmiiWRkKq3QkUWb2G7DJXLHIJx9aa8srxRRtIzRpu2IWOFyecDtmkIxj3oYYUd6nUaGjOKD2xUttbm4kKggcd6Y6FGKntSaaQdQld5Nm52baoUbjnA9B7U0KcdaVgPl+lGcUWEMY84IqVXaR2LuXOAMk54xwKZinouCfoKEND6KKKZQ6iiinYAoooosAUUUU7AFFFFFgCiiimAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUrAFFFFKwBRRRSAKKKKACk20tFADcYop1IVoASijGKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAqW2++fpUVTWv+sP0prcT2LGM0EYHtTqM8itrGNxuCOlKAeSetBFOAyKYaBnFO3hxhhz60mzJzijbQJjgmD0pzxbRmljfbweRTpCWIBPydyO1UtSbkGKUD/Oakuoo45mWKTzE7NjGah24NKwaEw4I9qne5YxqueMdKgDDAFPAyF9hVJ2ECE9jg+1TQOS4yxVc8kUiIWPy4GKkaFoSAykHryK0Se5LfQ07Ro5HhjluPKhJ+aTaW2D1wOarffY4JNQBuF7VPGdoD5BGelbp3M7FzStNu9S1C3tLKCS5vZ5BHDDEMs7noB75qSK1sWs79rm4lt7+IqIbcRblkO4hwzZ+Uj6HNRxzgEONwOOCrYwexqJWCpKCgYtjDN1H0+tXpclXYkNw0QaMhkRxnIHX0/WqNwQw6VfmkMsS7pN20YVT2HpSyRWkukqNksV55rt9oLbo2QIMIFAzu3ZO7OMEVEk3oUtNWZMjqkgCsXXjBIxWh4l8J6l4di0mfUbdIY9UtFvrUrMkhaEkgMQpJU5B4bB9qseGNCvvFGsWXh/TTCLrU5kt4zdSJEm4n5d0jcIPUkisvUrR7O9mtnCiSBzE2xtwLKcHBHB5HUVm4+7cpP3rIpsbVbVsSSvciTAjZMJsx1znOc9qr+QzhGX5txwBxnP0rqvBdtps2qywahpcuqNPbyxWsUdwIds5U7HYnghSMleM+tZMNkB+8SWFTGnmAsM5PZcY6/pWbi2jRSsynMuZYxJCsK7QpEfoOCevXg1s67NojCCLSoriOOONUeef70rdS+3+HsMAkcZzzWZPM0kMUQVVjhyFwoBOTk5OMn8enSnExPZSBpyJ1KCOIR5Vgc7iWzxjA7c59qV3FNJbj3tczNhLtg5Ga0NNljtLmC581lmjlDBWhDqVx6E888Y9Kl0a/udFvo721dY51DKrMgcAMpVvlPB4JplxFbQ37JbyNc2qP8Au3lTYzr7jJxWajoW2UgonaNFj2ucg4PX8K0tT0pbOGAqySkAiUx/MqnJxz7j+VQgGQjEagtjAQd60dH0m3nvZBqd0+nRLGX3GBpHc/3VXjk88kgcVpCF9LakylbUv+DdHtdYj1SCbVLfTJIrYzxG5yqTsuSY93QMR0z1OBWDLIrD5QxPXBHStaFNkb+YiOyKFSDkbRz8xI79DRc6YbSe4jaSO5+zPh5YGDQuPY8E5OfwrokvdUUYr4my54M8HTeL/F+maGt1Fby31wkH2qRgY13Y5z3x3r1b9pL9nK4+AMujWVxrVlrEd7C0oubKMgcEfKcn8fxrxJWZLoywDYS+5CgKhfYc8V0/iDxZqfifR9OtL66a5FqzJGZW6A46k11U5UlTkpfF0OarGq60ZRfu9UcLL/rAMYOOc1NZsDICFbIOc9hU/kefeMGA5zwpCg49+3SrAu5LzHmhFkEaRR7ECqqr6gDk47nnrmvP1vc9C2hc1LTxqdmmoQ3v2vU7ieUzWKwv5kaKqt5pbG0hiWGByNuT1FZFzEsEpjVnKcfM6bT09MmvoTw1+zjaXfwWvviBqnj3TtHuDbSNY6MjA3N0yttMZG4EZ9geK8EmtCrvkoTtPEnp7e9Sq8KspQhutynRlCKlLqVnmt/7NMZLLMkoZBt4YEYbP5D86qxSsJchiCPark0cPlr8jBs5JzxjH881C8EltCZkjZkY4DkcE1Uk0yNCW3eGZ5ftEgiCxswLA/MeyjHc+/FUrqcSKQpKqOgx1pPMy7NJIGLAnJGefSobmUSoqgY2jis5T0KUStjJ6/jip5orVbC3kjuS9yzuskHlkbFGNrbuhzk8Dpj3quzAgADkdaRgAgOfWue6NbMBg8An3rs9U8DWuj+AtD8Rp4gsLq91C5libSIuZ7YR4IeTths8VxRG7qdo9fWlDlMbeMetc1SMpuPLK1t/M3pyjCMlKN7lvWrn7dq95ceasxlmZ/MSIRBsnOQg+6PbtVIYPenSOZHLEAEknApqLlgCQue56Vuc5ct1tzpl80t35c6+WIrfyi3nAk7ju6Lt4PPXNUAAR96n5BjceuP50gAA75z29KGwsNzz96prlIlEOyfzsxgt8hXY3OV5649femNEwRXKkKe5FKEMjAKO3NPXYWg63RCQN5DE+lS2sUEsxV5jFGZFDOVyFGeTgc8UyCPZMg75pF+7L/vVa80S/InSKNLiRY5t6KxCyBSAwzwcfrSTrvfazHHbiqQkZG4yKmW6LDawyKSktgs73LMEcMKTOZgrKgKKUJ3nI49uMnn0qa91abU4UikcBIxhVAqhtGSM8dqmjVcZI5q4ydrIlpbsrMADyae0UIghZJ98j7t8ewjy8Hjnvkc8dKdJFucntUbuqqMD1rNqxd77DZCEPykg1GcHvSHJNO8tgM4OKl6lD5Y0jWIrMJCyZYBSNhyflOevbkcc1GRk9acRwOO1MxUvTYAIwKl53crt+UcZ/WojTogcnJz0oRSJKKKKYx1FFFWAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFKwBRRRUgFFFFABSFaWigBtFOIzSEUAJRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABU1r/AKw/SoamtOZD9Kpbky2LeaAvOaWlOBW5iNx2NLwKUDIp22kDG7vzpQN3vShfanbeenNMm40DHWlDEHHb0p4FAX1oQEtglu95CtwWSEuA5HUDPOK7H4v6T4M0vxHbxeCNRu9S0prWN5JbtArrKV+dfoD3rixGT04pxj5yea6IzSg423MZRvNSvsRLGce1PEZJqRFx0qYyO0KRHbsUlh8ozk479e1SkU2RrlGHtV+/vp9VlSW4fe4UIDgDgDiqoQ+lWrYiKVHMaSgH7kgyp+taxT2Idt2QBcgAipIodzYHSrLL5pBMaLgY+RcA1NFARzjAPtWqjqQ5Egt0SNdvJI5q1aafFfSQQtcQ28kkqxfvMgAE/fZugAoFs4tgxCbd23r83r+XvViOYmzngNvA29lYSFPnXAIwD6HPP0FdMYq92YttrQj8QeFZ9H8RT6T5lvdTxSeWZbaUPE/urdCKw5bZkfG3PUdK37CE7pV2RtuQgGTHy4OeM9+MfjULWsqFZvLBjLkDI+UkYJGPxFKUFLVIcZNKzMKSBl2F0JQ55Axk/WpZWt7q3srcWscEkRYSToSXmy2RuBOBtHAxiti8hWeYsEVS7FtiJtAyemP5e1MutPWK3gdZkeRzuaFQdyY6ZOMcj0J96hwa9ClJP1PQfgj8ArT4v6hrVrL4nsfDosbOS6il1AhUnK5IjByMMa8lvLY288kIwVRiMgdcVuLPe/2dLCrhInlBMajBJGec+nJ71HZaPNqF4nlhtilTI393Jxn8/wA6mUVJJQQRck25M5+KHEqnyxIoYEqw+VvY+1aUlqmoapbSXEbyRbY1dQNgAAwFGOwGBk8+tdDGt14ehu7R7C3le7QLunjDyRANnKHPytxg+2RVa8kbUfs+Y4rOFVSNpI48ZOOWb1J61DpxitzSM23ojmZt7yzCdRPKyeUrSkkx7SMFcegGPTBqez0hrxkChS/Cqo4zWwNCuGuhC6NvU7BEEy57jA981s6bBLo19FcahbFEj+/Cyr5jYOMAMOp6cj3pQptvYtz6HPWnh2e3iNyIRIoAUsSdsJP3SxHAPHAqxPa20ULGSbfeKN4ZiXaVs9x/DjkjPWuq8YeNdR8R2NjZPa21hp9nGPslnp8IijBP/LR+7SY/iPNcrFZyIscu8vfMxXaU+6oxg7u5/wAK6ZqFPSGplHmlrIm0KfT7RL9NWE8sU0e+FbYqredghSxIPy8nKjGc1n38TyzRCVQmFEYwoGAOwq/AvkJcK9pHM7KTk/w46kc9RTrOzIubXzERYt/LqBIRyCeB1+lc8pacrOiMLu6KS6JGXlJkCKD8iMDuYHkdOBVzUdOtEsLYwgRSBQsitlix5JkB6DsNtXWkS3u7liAuxmYRyxhd7E8DAxjrn2xVi51uWTRUtvsmn3LzszHFuTLAcbRhvcDI6jn1rF1YxWhsqbk9TmYNDutat7t7O3jZdPhe7uJWZVJj3KCTk/NgsMAc81nWcaK0gJTfwFyec57f/Xq1NulOBtVSMAkAANjpV/R9fudLsdVtra3tfK1GJYJPMt1Z1UENlGPKHI5I61jUrfyouFPXVko1Z2tUgl3MY4ysTE5xls/hVDxCzNKJ5FRWuTvMcKhEAHQBR0q0lpN5RdoCSU/u89e1VvF9vZ6dqCxWVy19EYUZpWiKYcqCyqDz8pOM98HtT9tCSfcbpTVr7GPcGIRock5yCG7Y6VpXfi6GbwpDog0+BDDcNP8AbFZ/MfcANrDO3AxwQM8msee+ZbA25t4jvcSGYpmTjPAbsOeR3wPSqXls+DsOPXbWLqtXswVO7V0NOxmIC9qY0G7HFa2lrcCVxArRhomjJCcsp4I/EV3uh/CPxJrdlHeadoN/fRE/LLb2ruuR2yBXl1sVTofG7HqUMHUxF3FHlwhQSKduVHHNaWm39voNzb3UMC3d5bz+YjTqDDgYx8h6nOevHtV3xJpl7ZaldC7tmiuPNbzEMWza2eRtwMc54rGuJZWso4fs8Y2uz+aI/wB42QOC3cDHA7ZNbwnGrG6ehzVIToys1qVZ5Iri7klKFVdi20t0z71A4TjGRngk84pxRx/yzPr0pjFg27y8gEHaRwfatlZI5ndu7EcKkjbW3gEgHGM++Ka2Hxzk4p8u6aaWQQCNSxJVFwqZPT29qah+YcCmIti3tRaTM0jiYBRGmMhufmye2BVRUAPGSatLdCO1uIfIhcybD5rKd8eDn5eeM9DVYc4wMmnKxK8zZn12+1XRNP0i4lU2NgztAgRQVLnLZOMn8aqpFHACB6VWYyRIDsAzVi6uzdRwYt4oNkSoTECPMIz87ZP3jnn6Ct+bq9zK3bYgg2tOpbpu5p32bZLPGeCGz+FRQyYmUYHX0rTEiySLMIlkMLhWRhw47ZqY6ocnYptYKbffnkVQ27XHsa0JZ2XcCgXOe3A9qrooyWZRj+dKSWlgjfqTeQr4IrUi05DbljycVmQ3uxJgIo2LqACy8pyDlfQ8Y+lWotQYxlRitIOJEkyjcnYSoqo4yKsXD5cnApktxvghjEUS7N3zqvzPk5+Y98dBWEtWax0RFAqmUbvu96355LJbFVQAyVhoQq9FJpGfB5UGqhPlQSjzMeWBbpxUEgAbip5Jd4jHlom1dpKjG7nqff8AwFQM3J4FZstDKenU/QU3t0qTeHckIqcAYXp0qShaKKKBjqKKKsAooooAKKKKACiiigAooooAKKKKACilwaNpoASinbaMCnYBtFPxRRYBuKMGnUU7AN2mjbTqKLAJto20tFFgE20baWiiwCbaNtLRRYBNtJtNOoosA3BoxTqKLAMop9GBSsAyinbaTbRYBKKXBpKQBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRSsAUUUVIBRRRQAEZppGKdRQA2igjFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAVPZjMp+lQVYsjiVv92qW5Mti3g5pdvHSlXrTwK3MGMAp4pQmTzSladhCgUAUqrkU9U54p2JY1Uz1pxQAinquOKXbk5IqrBctaZpVzq1wILSB7iY8hI1LGnarbRW968UIlVFwCJgAwOOQce+a6z4UfEm++FPiiHW7G2t7qWNWXyrlN6MCMHiuf17U21/Wbu/kjWKS5kaUogwASc4FdPLDk0epheXPa2hlKvGKeEIx61YjgPpWjFp1xBbRXRhdIWf5Jtvylgex9eP0pRhcJSSM2OJ+o/lVq3gJKgDn3q+sXmMzONxY5JPXNXdM0ebUb62tLePzZ55FijTIG5icAZPH510Qpu5jKZQSzfC5HXpV6K1byihJC5yB23VoGweFykibXUkEehBrRhilETAEjeuxlwMFcg4/SuyFLU55VOxlR2TC0M4VNgl2YLAnOM/d6496k02xWeTy3URIDuaYKWKr9PSujg8PyfYI7iS3YW0spjW4HQkYLADvgEH8a6Dwp8O9S8T3FzHpOnPqCRhjJKfkECDnzHbO1AAOSxxXUqPVnO6pwsWnyXVzK0MSopDNtXoB3Azz/Wkl09lPKKWydwIx2r2fw/+z54v8QTeZ4f8I6rrNmr7l1GOJ4rWVewRpAu7n+Lv2r1jwp+w946k0+XWtdZdE+zr5q2ttENQvZT6LGrBM8/xPQ1SgveY+acn7qPmTw9oukaZZy3OtB7uSSKaK2tbKURzwzgDZLISp+TJPyjk4PTrXLX1oXlUGKJNsaqfs4wGx/EeuSe9fZGhfsUa74nunOpfavDtrg5vdUlie4c9mMMRfH0Mgrj/ABz+ybF4O1RbebxxZLblcr5mm3LzEZxnbErrj0ywrJzhLRGkI1E+ZngvgCC10rWI9Svksry307defYtQZliuSv8AyzGByxJGF745qLW9YfVta1K+srWPTI9Rcs1pa8JgtkKB6A444r6T1D9jfxLbaPfWGjxXHiN3mhBuI4IrNY/l37kaeZcqwYDIH8J9K8t8QfAy+8DX9xY6rOLTUEx8nlTXOzrkfuYmU5z1DcUOpBR5UzRUpuXM0eRz6c9xFJMZQ9wsgURtnzJM5yQMcgY5Oe4qOCxlnuoYoYRNLwAAN2SeMV3s/gS7W5t4LRri/dVIxFazQtEffzFXrmup8P8Aw8TSWW91iCcWUWwukMX7512jcoI6KOm4/hmop0o1na5U5yoq9hvwF8Hpa/EGykvILd5LGcTTT3MwWC2RGyzsehAGf0xk0/4laAvjz4ua7qmiW11faVql632KZINnmDpJ8uDhVALeoAz1NN8V6vp0PjG1u9E0PZoERjxpl4jeVOQvPmf3jk+tS+HvD3iPxvr+l2Xhaym0+6eVre3t7KRg+985YndkcEgscALxXZUrUKEHBvRHNRoV8RUVVJ3aNv4sXnww074YaXoPhizSLxDZJFJdapPCyS3wZTvKZzwTgjdjAxgda8n+F2q6R4X8eaJqviHTk1XSLaZJZ7YbWLx9xt6E+x/Guq8WfDHWPAk5a7Qf2vE3lT2cse6WNmQ7shgVZcEgNzzyOlcdpfg66iuFle0kOMbY3XP4n6HHHevFrY+k5KcFoe1Qy2rCDpSbbZ03xYTTviH4l1bxN4a0eHQvDtxcziztZV2D92ke5Fx8u47gcD3ry/7IN8LEsjGQAxIPlXnAwSf8+tfRHgT4Wa74x1YtYxM+qyytMAkYQKxAJ2IBtBPIwB2q144/Z01PwHAv9saU9rc3bZheVAiovO5uevUYxXg18xpubu9T6bD5TVVNWX+Z4PdWG9ruB1k+xxyEyyKFJLDOBkHHX0JofTXs9GbU0t4Wgt5UUofv5IYjA7j1Priuyl8NR2N80LK9zaI7CFwiqznsSM98D6dq+jvBTfDrQfgN4x0LxNa6efGk0SPp8ckO+RY2RWTDDhTyTyc+teRi8c6STgr3Z30cv35kfD1xCba20+YQJKbmMsiIysygMVwwH3eQTg9Rg1a8PzWrTwLJFscZcqwUAAdSSa6TWbe0jkkSytBNJtZkwu8Y7kjHIxmuN1C23wWsREY8tMKY4yC2Tk7jj5iM4/DArthUU47Hn1acqFS107H0/wCOvjh8NNW+A+i+FdL8NrZeKLdoftOq/Z0XzSudx3j5jnPf0r5d8WzW+na3c2y3KX6RylVu7Vt0Uv8AtKTg4/CotQ0+4spljnhlgZ41lRWGDtYZU/Q1JrfhPUtEt7ePVbOe0F3Al7amVCPMjcZVwR1BFc+Fw1HCpxUnq76jxGIq10tNjKv55I9KSd7a4FkZ/KEhQbfMC5259cHOPQ1STU4ViUgSqzHAULnI/OtGW1mtbdLxmeaGGZCDIu6MSbeAVPGSF79QKxbiFmlMyJsGeccc9fwrvcactjg5qkHqdFpGoW1vMCfMVguT8uMjPTrX6J/sufta/Dv4e/CXT9I1i8ura8hmldo47cuACQRyDX5oWljPcJLJFHI6xx73ZVJ2jIGT6DJAzVlNSkhixnan3d3OK+bzfJqWaQVObaS10PaweYKlFwqK6Z3fxn8Xab4j8c67qFnK729zezSxlkOSrOSD+RrzeaaNbVXDScsQQV4HTH51HdPLJNu27h1BIzmnXGm3sWiw38kDCynlkijmyMM6gFh68bh+de3hMLGhTVPsjzsbjJV6jkZ004bPX8qrysABt3HPXIocEHvk1ZYpJaQwpbhZlY7pA5zJnGBjtj+tdyVjy5SbKcz/ADyfMzBjznjP1FJEqKGLZzj5cCreraZc6Rqt1Y3kRguraVopYsg7WHUZHH5VXBbzPnBbjBxwafqTuMAZix6k+tLCuHDMMqDzir9ppN5eWN/dRW7yW1osZuJgOItzbVJ+p4plu8kZ8lD+7kI3D1NXFXabJb0sTzhLy2byIm/djLZ9KzpGeNVDD+Hj6Vrv5toZUQFVkG0j1HpVK8sJ0MRlTykeMSKxIxtOcH9DW8rmUbbFOBC8q7Rk5ycelamkzQxPIsrA7nXB/hHPc1mO2BsiBC9z3ai1glubmOGJTJJIwRUHViTgCsoScHoXJcyLV9dvJNJEQEjBJxiqcjbmAAwBUwyS0UwI2kjd3U56fSmPbzW5BIHP3WyMEeook23cFZaERViG2jGBzn60xZmTIPWrAtp5UlcbSEXc3zAcZA9eetVcZPtUPyLVgJL57U9Aqld3K55qMBgenFTyWk0NtbzSJtim3GM5HzYOD9OfWpQ9CKdgZDsBAqPJFOb25pnWkBIzYA+lNPQ5FSTwSQiIuhTegdc91PQ0zt1oAY3tTk/pQyHgk5BpxTYcHrgZosUgooopDHUUuKMGrASil20u2nYBtFOwKXFFgGUuDTqKdgG7aXbS0UWATApaKKYBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAm0Um2nUUrANpKfSYFKwDaKXFJSAKKKKACiiigAooooAKKKKACiiigAoooqbAFFFFIApCKWigBtFOIzTelABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABViw5mP8Au1Xq1p3+vP8Au/1FVHcmWxcUZOR2pwp23NLsrpOYf2NBGT70oXIqZIsH3qkrktjEQipFjqdYdwwKmjtiDzWqiQ5FTyyD0pwiJI7Ve+z88dKcIO2MVaiRzEcNurxvubawHyjHXmnJDzwOaspD7dqsx2vHTP4VqoGbkV4rYkjiraQttUc464zxVi2ttxrWeyiMUPlo4YLhyxyC2TyPQYxXVGmYSmjNhhyOnFaVhYmSVPmCc/ePQVas7AzOFC/gBXoPhr4V69rur6dptlp0s81+cQNEpdWwpZuncAEkdeK7KdLqctSrbQ4u203OCVzXa+Gfhh4g8Wazpuk6Rod7eX+oxLPawRQtmWIkr5oJ42ZB+c8cHmvoTwN8Ofhb8CYxq/xf1Oyv9a2D7N4bhk+0JCQRmeXbw45BEeeAGzzwPa9I/a28D+JBc23hi4jnso7AR32pBI7WWRd6xRQITjBdn2r/AAxrub+EVnKvyycYK4Kk5q7djiPhz+wHY6Le2DfELxHE00qmYaForFmIGM+ZN2AyAdg56Bq+gJviV8OPg3br4a0jS9N0jRbaITXb4RRGN23c6nluQfnc9RgZPFedeGfHum/Fi1s7TRdbvfA2n2koeaDTpIkOpLnCO8zAyCAkEIuQ0gy3C4rkPEfgXV/i74x1JdQ0e2tNF05xaNf3V7YWNxf+XykS7ELonOcE5G7kZrm9+q71XodCUaa9xHoepftgeFrp3gg8R21laXMzRQvdwPNcXCdB5MJwQuP4ioHoD1qx4h/aE8MR6VJqH27xB4kWOLbb2Oj27tJI+QoVVU9R3ZiMd65DRfgciWCrJovg/wAGWiEqtzp15HfXBLcDOYFDN/wI/Q15h4s/ZhbVddJl8YeNNbVFYJJBa2togUckIoAbb/wECumFCk1ZLUl1JJ6nWa38TfDHi2OSfxTpus+GIEVfs1p4lu4lE8g/uweeXkb1JUDjtXEeKvirpXw583XdB8TaHrV6y/vYGdQV9FSNpXQY9k4rzbxL8P8Aw74Ks55Es9Vuox8s0+p3LRlT3y0MTceuSK0vh7f6dqCWVmPiD8MNLt0+UrqMUrSInqWmi+ZgP7tVODgrM2jJPY6W5+Pviz4vaZCi6/4msFuSBJbeG9FaRk9vPLIrk/7IruPhJ4Ot9E1NLq5t/H+pXrsHMmragkZU543Q+cDg++c1uaV4p+GHhazRbn4+pEQMNb6TdokeB/cHk7gPavK/Gvhz4ea79svdH8Y+MtQSYGWcQy3KQspOct8q4Gea4uVS2OlSfY93+K8/gTXbNl8R2Hh5pXZgrXAjSRWxg72QkbvY14Vr+s+Ari2h0bT9dtI4pVij+a6UjcNq/fUMAOBx0HoK+efHfw58N6Hrr3Flb6RdaZEyK9xHqtzI7k9WMQO/PPOQOlaHg3xVpvhHU9Rg8PWHh3VYfNLDfHdJJKMcFdzg8+hHWvMxEp049kevhFCU7NXOj8WeDpLHWLlLG3v2hWVl+2zr58LKOjI6rjH4Vv8AgvWbv4e2U9xa6m1lqsSxXFndCxKsrK+SoduxBPOOcYrpNA+J1vr14IB8LYJLhoSUmtNbe1YoB8x+cEDvwRUXiTwE2sxR3MXhXWtGFzslWR5LTUl2hcDa8Tq23vjb1rgliIV1yyu0erHDSovnhuXb7x5oHxP0bUtR13Xr201rSrJI7GG7jSb7c/O5dyquz5vXOAetef6V4ht7uLdG9sl4rOptmH7zaoByCRgliSAo5yO1W7r4c3VhpMl1Hreijyd+bYXSx3DBxgqyOBj6E8Vyc3hyTRNWitp1MN1MY55IWh3BVI3LscEllIOT6+vFcfPCo3Hsd1P2tFp3tc+tv2V/GFhp+oWOqaiyWVgZjGjyqVYsoy3HsMZ54yK9I/aw1vTfG6W1vYX9pHc2aFZVujgxsSMKR2yDkV8j22tHwhZa7p+jpNf2ur2/2u0gsZCPsRwfNRxggkKMsvQDBzXI33jzULa6im1B4531OCMwpeN9pbeDs8zII2MMcAg8cYr52eCVWo6q0PoFWgqsa9R+8lbyLNzaSaZNdX2qw2v2SyvxbSWkTqbic4LFo0I+4ABlyNvI6mvNfHPiu4fxC1w9ov2uVj58avl1kBxhzjGTjOBxipvid4i1PVtWh1C8vJLy7ZAjXbsrM+3gZZQOMDhewrhNQe6tkU3MrJ5zEtCRhiOG3fjXs0KKa5pHh4zFzcnFFizumuZ7m5eIeV5bRMXmChGfhW9SAecAVmW0kTpcBLwzX6uqW0EcbnzWLYyDxgjggEc1Zbw3e30V3qFtYXSaemZIHZh8o3YXJ/ix3xVBLEQTztcXKJL80iz7WZncDgDpgE9TXdBQbsmeLPnSuyHVJr1b1kmW6jvRlJhKfm3jqD9Peq/i7XLHUtUtX04X6afFbwRmG7uTI28IPMKnGFUtkgY4BFMu7c3Fz99VDsTmQ7QDjJzknFMCaTN9hilS5tgu77XcriQscnZ5aHaAMYByeTz7VbUYu6RjeUlZmfNceYHXzHW3dy3lNJkgDpn1Iz1rPmQYwpYtkkknjHatHUtJuNOjgF3A0PnRrcRbh9+Nh8rD2OKl+0aT/wAI5JbCynfWRciRLxZMRCDadyFMZJ3YIbPAzxQ5rRpEqG6bMopKgAV2VivzANiozBI6yYyY0XJG7OD60AAqzEjpjHembBj92SAw+YZ/nWurRjonqQMWH3mOOnNPM8f2ZkZWLfwFTgA8dR34zVudTa3aoJYLtIj8j4JjYde4BIqj5Z8sOMbix4Hari7ES1KzghzwM09RtQHeC2fu+nvUgiBZ2kYgkEg4zk/570wRHaDgg5x0oJGMm6bA5JbFNZSJDu459asJbSNe7EB3b8DPTOakWxka5ZNuTkgnHH4U7aD1C3hkeCYKWCcbhnrzxkVo6RpcMokkmk2BR8qgcsfQVZ0rTpZxMqQu2Avy7Sc813938MPEOleCX8Qz6Ldppc4WJL1oGEW4ngBsY7GplWp0nHna1NaeHqVYycVsea6pI8ibpHLuo2jPYelYztJIAuSR2Ga3762KQkMPn7isZrclkVfnZlztHauicru6OWMeVaoq7T0xljxgVIkC7whwWyNxzwoqXATckbDcPvy9gPQVXeXGEThAfz9zWVktWVvoiQXiW5KpEjY6s3epItTZgUFvCR1+ZMgVRKk5o3YXA6d/ehTZLijQ/tYxh1S3typA5MQ9ajOrSf8APGD6eWKpj7rDHGP601gOi0e0k+o1GKLbapIf+WMA/wC2Ypp1KQhf3cHU8eWKqhDzmpBDuCnHrS55ByxJf7RlGcRQf9+xTf7Uk4HlQf8AfsVFswSO3pUbKO5xS52PlTLUt/K235YunZBUTX0oH3I/++BTGIAXrnFRqMyDPSnzMSSRZ+3TFB8kZGP7gpbq9lvpQ8wXcFCjaoXgDHb6U9zFHEMYJ9Kq5ySacm9rhFK97C0UUVkaktFFFbAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRRYAooop2AKKKKLAFFFFFgCiiiiwBRRRRYAoooosAUUUUrAFFFFABRRRQAUUUUAFFFFABRRRQAUYzRRQAhWkp1FKwDKKcVpMYpWASiiikAUUUUAFFFFABRRRQAUUUUrAFFFFSAUdaKKAGkYop3WmkYoAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAq1pwzOf93+oqrVzS/+Phv90/zFVHcmXws0VAx61Iq5OMUoU5qWJADXWkcjYJFVmOHPWnRw4xVqOI+lbxiZOQxIcdqnjh3EcVPDbF+3NadrphJyRW8YNmLnYz47YtxjFWYtPLYr6G+D/wCxP8UPjAsF3p+gNpGiyYP9ra2TbQFfVQRvf/gK496+l9H/AOCd/wAPPBNtHN448e3mq3QIElroyJawg+nmPub+VapwTtu/IzfM9T88bTR5ZnWOOJ5HboqKWJ/AVfPhu8WVI/sk/mM2wRmM7t2M7dvXOO1fpz4b+Ff7PGgXdtFoXhKLU9RgIliur/UZnfcp+9ncBXmXxM+Kt34J8S6nF4Um1DRo4+fsyyWktvkn70exNwU8j5m3Ctkpfy29TNq/U+N/DHwl8Y+J18zR/CGuanEMHzLbTpWTB/2tuP1r6H8Nfshw6focFx4t1G48P6iyNvt5LuBFV8/LwQTgjgg9wea4rx98d/GXiLTFj1G8uEiYsQ97qbxEpn7oUHI+v5V5NeePbBGuTqIk1BriMbPK1cs0Df3g0wPPtjij2jg9dB+zUvM971TwB8Mvh/qVol3Nrer3L5/d2yoIXfHC+YwC9fcj1q3f/tJ6TY6XdaXojah4VkQ+U8VusUVwg2ld25lxu56g/pXy7d+JGvNKuLnw/feKIFspVd4rm6iurRWPQkjbjPPY1ga7PcSvbXl3qVpfyXCDeLHIlVupDq64OOhxUyxDcXY0jQimm0eg6x4D8A+ILZ7i58UeIotRJeSR7lornzD1OVG08+oJ715r4y8Ov8Ol0u80vWYdd0HUomltriJWjYYPzRyofusD15INYepalEjtbWbzmEtvh87YGRiOcjkYz0wam86x/sMW10JLmeQbl/dhPJY46Hd3PtiuOU4zeiszsimtzpfBfx48ReFLibULa5eXVmXFvdSncLZyMNIqHjftAUE/dHTtW1oXiqabT49QvddvNU1S5md2tXmdUgJO4u394sc/nnnFePtbx2t9JFHJ5iq2A2eteifDrTP7Xv8AD/cjUFjn3wP517uU0XiqsactTjxTVOLkj2/wr8UfGdy0KafqF1ptmj5U2zEbG/vE9Sfck11OqePPiHp9xaXU3iXxHceewYGC42OVzggEL7EV7R+zN+z7b+NPKa+U4JAEeOAo6cdM+9fSHxM/ZQ0ePwzvtBJBLbp8kscjZXnJ4zjqSePWvt8RXy/BVVhKvxPyPiXjas3KpSg3CO7Phf4h/Gu01hI1tLm8a6cqjPqIAy4HH71FHJPB3Ag1w2gfHzR/DMktvNoen6jYmUvcaTqgCzWsn8TW9wFK4J5CsMemK0PjX8Mm0q8kSZ4Y4Y3Nuyx5V52Clh8o5JPTPrXzTrt6mmarDc2N28823DiVc89lJ78eteBm+H+qe9HY+kwFWOJgpI+0fAcnwm8YrDqVtdW9okmZQ0kKwz20h/5ZsFT5zk9QwrzHxtZ+H5tS1KOHU/E6W8AK/aGufssSkdm8xjz6eteEaN8Q72yuXksbWKFpF+9bnyCD7kYB/LNd7pniuXUSlnqF1NrgupgzWDKXZXx98b1Yk9sg1817SNRWPWUXBi+DtCsrrxVp7KZrlpWcm5vt92x2jI2hODn3r1bxN+09b3NgllrHhzQr3ySDFLHoEdtJ8vAyyEE++T9a5n4V+MfBfw88VX0yaL4lh1+Fh5Mtrcb/ACQQQ4ZCDknIxzgDOa09b8aXnjO+uUTXr2Ezq0X2R9IRlXPXLRtu/TNcs6cXB8r1OylUlGeuxnaV8S7PxLq8s9pAmkmZPkht7lYliYDOVV23AHGDhu/Q12Gn/GzWINCTytUvLSzspVa4juoF1S1iDnAUsERoiSDgh+T0rxbxN4Cv9Hhlm1FLM3BOYxNBIkjp2IyQR+RrN0LxBdaY8sJt7h7Scqk8ETA7gDlcoeGwen6V8tiY1IX6M+qw9SM7J7H0W/iTT9e09pv7SurdryTELXMk0dvIR2iMuFPPbcSKQeHpTdS3cF1dpqCxIPN1NCNnbCybsZwMAEdDxT/g3anUbaW08Palo89uytcT6LqjSKrPjlXgP3Sf7wUj1NfUXwK+FGk+N1l0S/sv+EfughlbTmdpo8esLMfud9vbtXiVcdKm7SV/M+ghhaUYOpKdktz5tvdT0az0izisNJvINTa2lhvLnds3yuMFkAbAGMr7qTXlc2l2NtpdxAYbq41SV4pYJrV1MCR4O8HPzb+g4xjBr7h+K/7PZ8PXl3baesl3BBGkkkohGFXk8nHHGehrJ+HmreHPCXwv8VWNxHZXGr21kTYvPboZ4cgggPt45II+teT/AGpCEfdTep6FTCKtTVWk7rTbzPknw34EutS0q8vNQ0+81XT9Fkiub7S7JozLLab/AN4d2cpjgZ7A1mfEfXvAWu6Jfarb2N1YeIrm92ppqIpgtbUKBHh+7AAKeueta81/4i07U9XmsLmbTUv7eSCaSCTBuY2OWibH3txrl7j4d6zqHiLStKCGzS5Ad5ZUE8UY2MWcLHuJwqnPfI6V6tOrGclKUvxPIr0ZU4tJX+RpS/F+10L4WWfgdvD9hciGX7fNdS5aVmbouVPAVSOM8E143q9/DcSGMxNHhmY7gAcYzj8hW5YWdxdXryvZXmsTNub7PGJAbmFVJdiwBbAC5JHQA+lYd9LHJqkk1vbmW1DGQQudxK46E45x647V6dKFOi24ddTxa06lWKU3sN1Ww0h9FtJ4WvZNXD5uInUeUse0bW3Ak53HGOwAzyawEh86TDGQjPznr/k1uajoF7pczR3cCRFrVJ1X7wIPQDB7+tQxW1vHpt+tzujvSsZto4UVg5LDcGPYBcnjnOBXZzXPPcUjOnk07+zpo2F010H/AHJKrgDA+VuenXp7VsaHbvoWlzatbThML5U1wjAOQ45giBHLFeXbGFHHepfD2hWFxcyXGryT22mWY3zpaoGmlYj5Yk7At03HhRk89Kz/ABTrZ8S3yTtYppOmRYitrW1BZbeP0GT8zHGSx5J/KlJufuJadWJLkXO3r2J9K8Q6TPdCLVUvLbSzGwItdjNvx8uA2Bim6r4s0i/muL2DSkskLJFBaK4faiqASxJzzjP1JrlfmwUBIXBIz9KgSMu23G76VqqNPTQzderrqdO+r2ktsZhZlcc4wMAVPcav4ffwcsqeeNfF8ymEIPJFt5Yw2f72/P4Vha7JaxSR29peNcwKvLeUUXPoAeT6c1kuo8gPvw27Hl47Y65rf2VJbROf2tV7yNSDVFuJ1ijgZmcgKBjOamOqxWl0sUsbkI4EoBHGDyB+FY0JMR81HMbL90jk57VCQWYmRzuzk5GTmp9nTS1Q/a1O52Gu65o6+IL0aTBcS6UZj9nFwwWTZ2DYzUWnXaXIlnaJ1jU7RtPQkHHOMVzbNE06rGHUbuWbnj6VYtbqdhJbxOVhLBmXdhSR0Jq+Sm9WiPa1Fomd14a1e2smuZZRIEjCbtjDP3uwPU17N4t/auu/E3wIsvhm2mRQ6VaTLMtyGJmIVmYA84z81fMsLMwkCviQAZJ+6ozSfaGYEFiIOjMer/SuKtgKNeUZSjtqjvpY+pSi4vU0ry5s5vNYeaqDqzYxWbqEtgYYRZLPDGYx58k2MlsnO3Hbpx1qrd3Jk4K7Yx91B/WqVxcvIY95BAXCqOwr0IuMVZI8+Tc3djLqeJ/ljRo4x29fc1DAYTPH5xk8ncN5jA3bc84zxnHrTCc8YpABkVDdyUrCsUy2N23PGetMIHvTiB+NLGm+QKeCfWla49h8Itjb3XnGcTbR5AQKVLbhnfnkDbnGO+KgAU8c5qxLblGZBg/Tmowhgf5xj2puLQrroJlRgc8VM8kCQQeWZTKd3mhgAoOeNp78dc1XJyc9KGf5Vxz1qb2HuBZC3OTTSF9/ypdvFMFIC1dG1HkeR5x/dL5nmhR8/OduP4emM81GBGcHDdcUjKcJx2p6R7VBbpmqW5LI5ygkbG7FE3k+b+4aRk2rkyAA7sfN07Zzj2pLpVMrbOBTEGPyFJ7lIdRRRUlktFFFbAFFFFABRRRQAUUUUWAKKKKdgCiiiiwBRRRTAKKKKVx2Ciiii4WCiiii47BRRRRcLBRRRRqFgoooo1CwUUUUahYKKKKLhYKKKKLhYKKKKLisFFFFMLBRRRSsIKKKKLAFFFFIAooooAKKKKACiiigBCtNp9BGaVgGUUpGKSpAKKKKACiiigAooooAKKKKVgCiiipAKKKKAGkYop3WmkYoAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACruk/8fDf7h/mKpVd0kZuGx/cP8xVx+JEy2ZspjjmrMEfOarxcEZq9CMdq74q5wssRpmrkEOcZFQwqQBXV+B/CN9448R2WjaeYo57hjuuLhtsNvEoLSTSN/CiIGZj6D1xXVFHMzo/g58HPEXxk8UJonhyzWaZU865up38u2tIgcGWaQ8Io/MngAmv0b+Bf7NXgH4L2UOow2MfjnxSo3f2zqMIFrE3/AE7wtkADs7ZY+1fKGnfHbwb8LtBt9D0EzWvhC2lDySYCXmv3K/8AL1cDqIv7kWcKuO+a5zxf+3h4l8QhbLRIWt4GBEZjOwLzjr04rq9nFpOpKy7f5mL5r+6j9DPGniTX9WD3Fz4gjtLZSNttAQSR6da+ZviP4f1HxB9oNrqxvZpwSAzkIrA8KAD196+VD8cfH+sIJLjU43AIj/fTdB0AY4AwfrWpp/xy8X2eqpEfEXh+0aJDzLeIFVh/31mumFSjCNk9CPZzvc9gm+DfxE1KVWt7iVYSoDTRy7EA7DPc1wXjX9mzxH4etLrV5tTee+cHfbPcs7TjtwQQDn1qndftK+P5oY/L+IfhRI1OdsU75zn/AK5Yrr9B/aE8ezR4fXfAOuwSpu8i+v0DMR14MYH4UOdGW9x2qo+Y9a1HX9NRYntWsBnOZrQ8kd9yrg1Rm8d67avJNLJbSKQAZW02PJHQZJWvsax+J2oXw8yT4afDfVZ5/mKR61bguf8AcLjn8BTNRvLfVY5Pt37KUN47AnztDvF5+hSQ/mK450lupM3hUezSPh9PG4snP/Etiuoy28gxhVZ8dTxj6DFSeKPFkGppst5rmGLy0JgbaAHC442cfjX1jrth8HQ8i698BPiNoSDaVaCaSVQe+QQQK5DUrH9k6fykvNP+IuhuSQ4kiiTYffK81zShK1uY6FOO/Kz5STUpDMv+kShvu5D4Jz7kUk0skz/vJPMfpy4bIr6H1H4KfBPxLrUY8LfEq70HRkTMl14jgR5JJOyRRoQSB/EzED0zXI63+zlqtxC9z4W8Q6F4wthM0IXSrry5XKjJxE+DgAjJGR2zXN7CovM1VWD8jzKLTJkso7vy3EJbG8rgV3/w51NraTyVYL5jqyqcnc4PA/nWFYWs2jWM+jaxpssV8XLxiQfIqheSCOrdhzgZNUraWfSLhW+5g7cKT7g19HlOI+q1Y1DjxMPaxcT9Tv2V/jLa+HkSKYCOaNhvQ8EetfRnxJ/aH0u48OzQ2ZEZdfmd2H5Cvx58GfFW50RlkUxyKBsWKRW+TI42sMHHHTPaul1/48317DJDG0VvFJHsYvlucDOCxJBOM8dzX2uKwuXY2ssbN+8j4dYHGUuehSnaE9z1v4t/FrUNI1C71KyuI2ninWXy54w67xkKCOzDng44xXzPBo+l6zqVpe61bIVuZiWVPkUqScnj3zxWTq3i1tXuzJLM8zOPnkY8g54J9aueLPHWsjQdOtp7RILWZcJdeSsZkRTyV7j/AHsfSvEzbGUqzb6I+lwOFeGgoRPYvh38O/CNvZ3mpw+EYbwb1Ypf6iMLHnjKseOBk9/1qK6+HHw9+ICyW+ga/q3hfXpNweO1kM9nJlidqAc4UcdRmvEdJ14XVpcyyxmOCJVBcuAwBOMqDlmP0HvxW74S8Zah4c1KTVvCcq2F6mUW8uJFXaCMEYbPJ9TXyk5waWmh7EVK71NfW/gj44+DEH2y40X7fpDAv/bVlbPM7oehKMw21B4J8X3GpX7xR3txp4QbkilaSETf7OFbgn8vevQNG+MPxPhZ9MuPHlzqulXOBcWaQreRSZH3NrOe/pis7xB8LrvxHfNeaJod5Y3cUDTyh4XSNioySSR8vsM/jWEY6Xhsa31tI6F9Fe+gXULPwNqfiS6O3MdtqFw5yOpKIGOPxrNvfjfJKr2un6Domk6UyBJdFjlS9gZweWZZ1Lq3+6y4xxg1n+Bv2jfHvwrvrqy03UdG0yaWA2hN/pjEhD1w4JwfevNvEHhnVbi8udRksLe7juGErSWRKqrZySoAGAe+Qa4cYudfu16no4SpKL9/boe3eFvGHh/Ttdu7jUtHsILO/jMempdB5fs0mBlvODhtobICsScNjPGa9x8PftM+OPh3fta6Va6a8yxKptYbjcx7n93Lh1yMY2E+vIr4lt9N0yPSZJ01I2V4cA289oZBn1LDjH1FdNotrqllJpzSW1lqFrfRrcJHG+1JFDFScKSw5UjIAYdq+QrYVRvdH2NHF88VCSufUN1+03qXji8vPOkubK/IIltpc/MDwcHow9QcEelcZ4p8R3+puby0IFw6mORVUbZG6ucEnHbH0rmvDWh6neavNc6Dql1oyXW6FPtWbu0kxz5LTqvbsJVRq918Mfs2eIpbGC41Dw687PulN3p0huLZlAyPl+8h65ByPSvCqU6OHV7aH0VLESnHV2X3Hhvibw54l8NWEF5c3Dm31O3+0aZLBEGW5VX2NyOV2nd16ke9cfBc+IW1iGJNUuLaS4dU+1JM+E6hs8j+8Qfr7194/G79nXw/a+BNI1Jbq6S8uUy8QcLFESu8qigfIN2eBXy34h+GVrDeWL+dKwjjXcbfG8bTwORjdwDnpSoY+jJarU5PYTxEXUg7o8mhsLmw/s68ure/ktVjeOM+c0AcHO5Y2GcLzzjrk5HNYLaFfS3qvAsdsbksuyJhEqg9V5IABHYmvaPEHwIu7fQbDXZoiunamWWFlnBkDqfnLKBlOemR0NReF/hZZtbSRi7FrK0uxhOxbchXnPHT6V3xzCla6Zy/2bOo9FoeRaf4TSKJ5Jmkw8DqIok++cggFvTvx6Y71JP4c1ubwvqOpWl9bpYxTwW1xYmRUnlCqzo+w9UXbgnPUgc1+nvw4/ZC8B634D0y91KOe4u5ITvktptkZwSAVGOBwK+Bfiz8PbPTdcvLPfLJbx3bBYo2G3byBk+tcuDzmniqrp9jKpgqUozjQd3Hc8rsfEXia18D65a6QksXhrU5bZdRIgR1Z4yzRZfblOdxwMZAxziuHdPtTrbwu3nM5MpOAhAPyle+eT/SvQdTsry8XUP9Mdbd5kWVIyIhJtBCkoMDA/TPvXKX3hpSqhZmbBbO3qPqcc19bGtFrVnzU8PO+iOfsFgttQuEmtvtqbJEX5zHhsYV+PQ8470y6inundmwVQf8s1CgD0GK6my0qe1mlWC5aNXjZCqRjBUrgjkfrVCfQJYnMZu5fUrjv371p7eNlZnP9Xmm7o5prByPuc9eaRrCUhHmBWEvhmVc46Zx74rfbRGmlJa7nz9BVy7tJhoMWmf2izWguWuDAIxkSbQu4t1PHbt+NaRqxfUxdCfb8Tkbi12TSCHeYQSFLYDFe2cd6gFnKRgAetdVbaIhkiR7qaOMn52RRux+ddBoPge1uLuwN9qsem6fPerFJezsXEKE8AhQfmwCR0zjFTKvCGrY1h6kuh54mk3X2n5oioDdSMUQ6bJJcOoCqqnls5x9fSu++LPhy38NfEbxFpdtq02p6dp97JBDfzQ7HuEB4fb2J61y1j9ovZHhtrdnVQXMarlmAHJb8O/auyjKNVKUdmclSLptpjBZo1ldypn7PCFLEKSZCWwPp3/Ksd7pzOkg+RkIZQOi46V1mleMrrRdH1bTI5o2tdQREukCKQVVsqASM5BzzXLR6l5F0JURJGUkqsqB1PGOQeDWtR6KxlDd3JdT1ZNR0+CJrSKO5jeR5LpM75ixz83bjtisJ0JPHPrWnJbzW7KGiYAqGG4dQehps11MTD58YKxxBIwUCjZk47c8k81k/e3L20RnoAhO5dwIIHOMe9NB3EE9B2qaWcsDx83rTIbh4JY5UwGRgwJAIyPY8H8aWwHR/DbR9G1zxlptnr961hpUsyrPOgyUXPJq58XNC0Hw/wCONSsvDN8dQ0eKQiC4bguvY1xwmZH35IYHORSSTmRyzZJ966lVgqPs+XW+5h7OXtOfm07Aj7SSTz2psshlbnk+tPivJIY54422pKoWQYB3AMCB+YHSo/M9hXNfS1zdIjxTgAVHtS+eRwVGPpUz3byQxRsAyR7tg2gYycnnv+NTZdwuQhPlPFMU+tWFuCEI8tai8/n/AFa0WQXYSNuCjPQYp6ZEWewp095JKId4DbIwi/KBhQTxSi6Itj8i9fSmku4mVJeWNInep5bkseUX8qW6upLuUSSbdwRUGxQowowOB3wOvepdikRUUUVJZLRRRXQAUUUUXHYKKKKVwsFFFFFx2CiiijULBRRRRYYUUUUWAKKKKLAFFFFOwBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUWAKKKKVgCiiiiwBRRRRcVgoooouKwUUUUWEFFFFIAooooAKKKKACkIpaKAGUU8jNNIxU2ASiiikAUUUUAFFFFABRRRSAKKKKkAoIzRRQA3pRTiM02gAooooAKKKKACiiigAooooAKKKKACiiigArR0Jd144/2D/MVnVo6D/x+P/uH+YrSn8SIn8LNtUw3SrkKngGoFBzVqHgivRicEi3CMiux0XWW0bwTrkNhcJFqurSxWEuWwUsQDJLj1EkixKQOyEHg1x0bYNXIpSBjNdKs9DB7mV4j8O6nqU6XMV+l5MVAYTDZg/7OSRj8q5/VdO8QaJEJLywmihdNqzlN8eD3D8gH6HNd6szZBq/p2q3VlIWtp5IGPXY2AfqOh/GiVCM9U7MpVnFWaueLvdzOckswx1YZpPteSAx2ngbgMcV7jLb6Nqpc6poNldSP1uLXNpMD65T5SfqprNf4Y+GNQngFvrF9pcbFvN+3WguFj/u4aIhmz/uisHg59GarFQ6qx5Ct245DnP1p8d9KBt81lA5wrY5r3jSv2dvCup6PcXEnj+zS+j+5Zw2MmXHsXZefauW8R/BrSNB2btbuSW7T2DRAf8C3EfjTeCxEVf8AUUcZRk7focBD4ilVY1do5QOrSAg/mOa3LPxrqUMkL2up31t5TZxFcuQB7cjFYN3a2enSSwKPtBOAJcZwfUYaqguFwBDLJGQeFwTzXLzTg7NnTyxnqkeu6R8cfiNoypNY+I9Uihjl3xyySebnHIDev8q0rb9qn4naYkjf25DfxyOSVv7GKcE9c/OpryPSPEJsmf7aPtKYwEIZT6Z3dh7VtReLdIaPyzpqx4YMzLdHBHoAciuuFa6s52MJUrPSJ6M37Stjq8Eya78NfB+o3T7S13/ZkcDhtwJPyAZzgjp0JrK1j4h+F5dZh1C6+H9lYQMhb7Po1/LZsTnAJ2k7Rj+HqepNcpqOq6RqdpEkLmB4HLJE9ur5yP7/AFIHv+FcjeTHzjEEVsZ4QEA+/JqalWUNmmVCCl0sdxr/AMQ9ND58PSanaW5UqbHVZlvEXJzhWKqQPzp2sfEzRvFVjZW91oEOkzQAIbuxY5kHGWZT1bjrXCWtiokzdpJHEF5K9R6A+n86lvbaO3CMkfl5T7vRhkZGfqCKzhia0b2ZUqNN2uX4r5Y41EV35gbBMYzkHB4/Dp+NNn1a4wiSrIQhwhb0JyP61Hp2g3Usi3G1BAxByHAPXoP89xW7DbRS+ErqVZlupIZ/3lk0f72OIjBcH0BA9wea64Yipy72JcIpmRYRXWtzxW8HlrM52KAME57Emr2o+E9T0zVRp+oyQW16u1fs2oymFlHUfexhfQg49KytOsxHeRTfbZ/suQ4lgUGRMd9pIzj2r1r4nalqmr+CNPB1TRvGWhKA0Vwsaw39k2PuP0dc+mCpxxWDk6sHJ7ou3K0jJ1LzbGxjtLfS/CWnzTuqLNbSfvxxyRLI7AA9ziuMkjbTLiSK6jaTezBWS4DjIONwK5BHv3qX4c+GfEni3UL608K2Qur21sZ7242QoXjt0XMjbm7AenPpUvhqzs9ViuhqPinT9NdFVYoriBpPN/4EF+UAd6xUnUtdDsotq+poafeQ2cqGx1O4sZWC/KrmNg3uwA/Cvob4D6r4zluNe1HSNX8Ua0dL09rueOz1FcNEGAYMrFwQc9weleH3GmWVlIotRp+rRMCpuLGSRg/vhxla1YdPmvZEi02RLC5dcKktztMi45X5Rz+VdlN8pjNNrQ6/4raZp2ryvq0GhXul3VyM3EWp7GUsepXaigH8q5bwVpFhbtqD+KNR1bwrpsVlJPZ3ukxSX8V1OuNkO1TtXOScuQAAaz/iBpcngsWzXWs2GqCSJT5uk3wlUEjO0lf4h0IYA8Vp/CX4hJpZa0tLCZ5H+YT2kqIzeqmOT5X+mQaxnZzs9Dam/dVi7F4u8My2MIt/FErXxDI39q6dtspUx9x0Gdv+8CKpRNHq8tlse33RR7LeKBx5QXcSBEx5XDE8Nnr1Fd3qt54JfUpbzxf4G1DyT1vtCH2OdieglgcFVY+vKt2Pary/Bb4QePbDTpfhj8QLmy8QzXSxS6P4phFs0e445dBtwD36fSvCx0Lau1j38JVa0RJ8FPjLq/wQ8U3upsLuG4jUQ3Fk29UuWJ4Rx1jcDkN8ykZx1r6L0j9ray8VSzXOjq/h7S5WWfVLC3uHfEvRpdn8Ct3ZMrnllXv88WUNnqVnrHhzX9U0LWX0CVjDren3RR1VGClImdQWGeQDwRnFReF/DWm6z4hha81S4tnBMdtrNsfLaJs8b+w/Hg9+Oa+aquM17OavE+qpRbtONrnvviT43a3NbOsN7JPp8qsERZNyMp6EMO445FeQa1rfiLVbv7Xp8k9wBCXniSRsxbern0BwTxXV3nw+1PwLc3keqxpfWRUp9o0shYmdgCs0kI3GNlHJ2fK2eoqppOgwp4hsIzFHcw3IEcbLOPLlLHAYseMAlSR7YrGOFow0UUdE69S172JNM+Iou/hkPCl3rC215Nctqa3xWUvauisBCSPvLJwcj7p61wdp4m1KxS8NzqN7DcABYmWQ8tnkH6jvVvxJprm8N1HFYqwcqUtyFQY4J29gf1qPVFdLLSYmnsGkuomjknR2dlXfjEvHBHYjJxiqjhacdkQqs4vRnfaX+0f428O6RY2tvrV7a2sMZVEWY7WwxycV454n8WXuoavK1xdTFZ7jzJE84gZJz1OcDnrWp/wq/XfEdvdXtpYQopk2shnWLy8DllQkEDt0rmtQ8MXEU9lZRWTzySRgSSQTeYXcltpXC/KPujbyePejD4PDUpuULXJr4qrONnG1+3U47ULm+hmu0ad3KTgl0fKHBPQ989R9Kx59VMSK0Ms7XgldmmZht2kcAJjg5zznuOOK9QtfCk0vhrV31WeezayWEQWpRQbh95BXLH5duSx4JNcHr0l5qDWkdwRL9lg8iEKqDbGpJA4HqTyea+gg01ofLVIyTd9DFdrjULwvaLO7MrFoINzFQF549MAk+2ao21tNqWqw20OoeUszD97dS+Wkee7seAPevT/BHwtudT0i38QSazp+labJNNaO7XgW4jKxktmMHdhlOB/ezisHxzZaJa6jJaaF5i6bB+7WSeRS9wR1kbHA3dl5wOOa1VRNe6rnO6TXxSscfLMtraIYri8a9EjEv5mIgvQFcck+/SqvmSNAEaSZ8sSQf8a04bCN5R83HfDA17/4X/Z60zW/gpeeM9W19NDuUlkFjaXGwR3gVV3bDnJPI6cZxUVsXToRTmrX0Lo4OVZtRZ80iymuJlXLDIzgt09T7Vt6N41ufDWh65osENtdWOqLGJWuULMjxtuSSMggqwOcexPrVjUIMKILZVSDOGbI3P8AXHb2rNGnxSSxySOojLbMDr9a6YwVZJSRyyk6MrxZX8Q+IdS8Xaxe31/dyXd3cymSSRzje3rioGnu9ESa3ilkhmmj2zlGwWRv4D7eorr/ABFpFloOoC8spPOtmJ+zyNjDEdTjPauWmia4jnlDFmz5jkkZ9M9cn6V2+yVLRb+RxOo6mr2MBoZHikYKSq4ycdOcU2KdooZYgAEkIzlQTx79q0I0VUnGQxwPvN70kFsZZFXAK4ycYwB6n0qEnfQTatczGdzkZZz0BJ6Us0dxMkRdmfagC7jnC5PA9utbstxpxmURWAlGAGkeTG9u5x2FWbrVLC8gtrWPSUaRU3Zik5HJyCa6lSjZ3kYOpLojlpbOWLaHwNyhhyDx2qA27Kw5A5rrtH/s+9vYbU6UCjP8xeYgD3Jp+tHSLPWJLaPTYpQHA3x3HyHPvR9XTjzcyJ9s07JHGrCxJA5J9KbJEV7jNdCmt6fazOItHiDAlctKTVRr+wZiTpqZ56SmsnTgl8Ropzb1RihSVb6dPxoVTnPHFbAurExTFdOjG1QTun5PIHA71ALuy5zYDP8A10NZuC7l8z7GaS7Nxj0pxLKq8etXvtNp/wA+QH/bQ06Sa0SKJmsl+fdjE2Twe47Ucq7g5PsZwkfaRUQZs1piezIb/Q+3/PQ0xLixxzaMP+2lJxXcFLyKjlwE4BG3+tKWb7MfrWhcT2iCDNiVDRhhmXORk80jzWRszi1IOf8Anpmmob6icvIyGZgTzTlOT+Aq/wCZZDratn2krS8XXWi3M1n/AGJZvZwiBfMEkhdi+Bnn6g/nU8i5XK5Sm+ZK25gUUUVkbEtFFFb2LCiiiiwBRRRTsAUUUUAFFFFABRRRQAUUYpdpoASil20uBQA2inYpaAGYNLg06igBu2jbTqKAG7aXbS0UAJto20tFACbaTbTqKAG7aNtOooAbg0mDT6KAGUU+kwKAG0U7bSbaAEooxRQAUUUUAFFFFKwBRRRS2EFFFFO4rBRRRRYQUUUUgCiiigAooooAaRSU+kIpNANoooqQCiiigAooooAKKKKTAKKKKkApCKWigBtFBGKKACiiigAooooAKKKKACiiigAooooAK0vD43Xrj/pmf5is2tPw+Cb18f8APM/zFaU/iRnU+FnRxR81PtAxUCMRUm8tjrXpHnliM4qwh71VjHQmrEZ71tFmci5GaswsAeuKoqx4qdX6V0J2MmjQjm5A4qyH2sASDkA8HNZasRzmpopeQCc1qpmTia8aK+d2c44x61rafqF5HFJGlyI7cDDJKRs546d6xLeXAFWoyGNbxZzyRu3Pg3wb4yVYruzXSZkQKL20+QZAPUY5z9K8w8dfBPWPClpFc2pj1WwlLMJoBl16dR+I5Fej6apJCqpdm6DOBXaeHdS+z+XEQslsxwygEqGJ9T941csLTrrVWYQxVSk7Xuj48DbPlkyDg5B6DnoR6U3ZHMQMKB9446++PUV9A/HP4NWei2Z8RaTKs9tI6oYoeVXgk5P14zXhUejmVSNyRq+cFv4GHY+3NfO18PKjLlZ71KtGrHmRREKoJdrvHMMFFHAI7jNdv4d0nTrf4Xa1r8k1pJrdtqVvbxQTXWJRC6OWdIcfONwUF8/L6c5rjoHaeMRSD95EciQnlRnn6gU5NksrRsgIY8KGxj3U/wCPFc0Wou5tNOSsNvdYurtT5mwRkYCRjaoPc49TjrVlNSk1CaU+aqMyEv5pAVguCoHvxgVNPp6WcmVlElhOvlvKI/mjI6hlP3WB9O3INZ81rNZXMkMq5CkK+08Fexz3B6g0veTuylZnSQyX2sXiQwwxxC7hCQxou1ZMnA+jZwB7gV6R4M8VaJqcml6drMZsddgeW0dpW8sy7gpQ7mXAKurKVY87xzXjWn3FxGHhgmYJzsjkO3ntg9myAfwrrfFvivT/AIjQWtxqUa6T4mgtlimuRGRFfOpwHkwfkcrgFsYJHPrXXTrKOvXzMJU76dDstB8F6f4v+KcHhHT7W5sdR1C4+zmzWLzBvJ/1iKP4QMscdgeRiuh+On7KGu/s9eMLew8Syx3uh6gpbTtf06PzIZcckGMkEkDqoIbHI3V5l8OvizqHgLxbpmuICuqadIskU4Y5Qr0ZWHzIfdTg+leh3X7Qev8AiPQ9Q8IeJ9aN74L1+6N6WmhWb7HcM+4tEx5jwTkhSvGeOudU6U4uXUxaqxnZbWPL7XQ9QW6uLjR0muLVg8LTaLO371O4KNhsHjKn8qq21ndSW0+YDCyOFdL6MIoPuWHB/EV3fjCy8XfBO+06XUbCKezuQsmn6/YnEN/CORiRPlcj3+Ze+RXtnws/aJttVhltL1NE1W4kUefpmrw7Uukx0E0eSjgfxBCPUVlCMW+VuzNnJpXSPlvR9Bk1DUdv2iO3CkriObBb/d+YA/nXa6T4k0fwBrlpeJa/2pLbMCF1SDzInP8AEpAYOn1U57g19F/En9lTwj8S/AUniLwHpyaX4kiJlk0L7dD5zrn5hGysYph3UrsbswB4r5Q8XfC2bR9Hi1bT557vS5JDBLHPGUmtJ14ZJU/h56N0PSqcZUldRuJSjPdnceI7vwt8YWnGgabPo2r4aVrCa7E8LnqPKdgHA9mLEVi6D8RtZ8HRt4c8V+FrPxJp4OFstVtzHPED3imTDr7dRXP/AAd8RWvhvxhZz6jJJawwvteUReYUU8ElMjcB1xmvcfjR4uL6zokGpeFdMh0W6g3WOt2F65tbts8ywy4/cn+9EwwCeQD81K/tIe0vZl25ZcttDL8SeBbH+wote8Ca1qvk3lqDLo19I32qzP8AFGHI2zR+hAB9s9fHl16O51QLqaSQOW2G5Ccjsdw4JHt1r1a18bvoBXT9VtLu80koTE8rjzYs9Nrrnevvz9cVxnjvT9L1h4bjT72Nrzb+7d+FnH93PQkdN3euavSU1zR3OmjNxdia7srrw9DaajYyWV1bmVoDfQszIwIBEcowPwbHseRXV+G/E+oW2oWk7mS6tIQI5LJX2vFEOqAgfd5JBwa848HNIl61vKX8piY5rZs5P+yR39jX058FPhNcR+Mo7e1vIDcpA72tvK+GOV/eQO4Bw6g5KEcrnFfKYt2T5UfYYBczXM7Hq3wzstc1HQYoBmfTLkGa1eHltgPByQBIo6HGHQ8EYxXoHhDwRY6RrdomraStxbyzs8gGSGZhhXP90qTnKjnvnFVPB2var8P/ABtdaHdwadBZSSxj9yu21tbplGEbGRHu/hlHBzg5BIH1bongW61+C21SCM2zjDEbFQqw69ODz3HFeCp16l4SVj6KpOhRV5PR9T421/4XPZ69NHLpDi2Em14kkBMi7u2edxHoKqa38Crl9Km1m7DaXp8czJa21y4jlCk5G7I4A4yepxX1B4+sfEGteNEt7i8kswjiNZY2VWRc5U9OTnmqP7R03jCWW20e21KKXTI0iuGWRUO+SMggtntkZx0NctWvOnJR5reZpzqbhGMVeSu/T7j4a+I2haZDF5kU7XE0FmgB38TTFsu+48leuAfmPHOK5rSPB0k0t4tzfvYKI/tNpqqu7Ru6DPkoB1LnC7jgDFez+I/2e7/xDKdfs7i0tLieYm8iaUlFkxkCLAICkZOO3StLxj8Ltf8AiN4Z8G+F7I6XbXWiQPbpMkhEl0XcnaxC449/eu6OLpRSjGW+5z1KM23Ll2Pm7xfZ6r4m1mfW54rSO7uJSJLO2Ajt41KADGDnr19+e9Q2fwpu9R028ubnV4bSdY967kdxnDblLL0yFwOO+OK67xR8Gdd8PakLK61O1jjt5W8zcpJDbM46cj0561LY+HL/AErwRAyy28d1Le4id9x8wKo3PnOc/Nt28DvXrQxSSXLJWPIng3O7lB3PPdRsI4mGm2sGywt4GZN335pccyMPc9uwArAsPAmp6te22n+ZGrXMyqnmyhUBPAJJ4HXqa7q48DTrqeqtDcwfZ3ikMKsjA5PQYycHrjk1FofgmfSJrq8mlDahGqyacE5TzQwO6RWB+UAHA7nHauv6x7tozRxSwj5vepsxn8KWHgye9tfKj1zUllMaXGSLVAON2Dy+T0BwPXPSq5fXLnSo7S7mluLdWkeINICocgbsDOB0HSuo034favruqqJprYyXEm+R5XK8k5JJI719F6r+xpL/AMKrl8QwveyPHZG9SzWICMMQCQG6kYGfwrz62Pw+HcVVldv8ztjg5tX+FdD4lh0G/M0hFuzsRwseMr7/AEpY9ASzM01xEb1YRu8iE5C/7TsM4Ue3X2r06+8GXOmaZdQiRYY5YsSzBP3k+OfLX+6uep6nHpXn1xZyyw7Z5m0+ARuI1jjP75hj5OD39TwK+no806erVj5nEU1TqOyfzOX1vRrpNcnhmmjuIopSnmLKoBUHsCeOO1P1PT7VtWumsMR2O8mFZ5ULhO27Bxn6VHr2iLZT3BW4jlVJNq4BBYevTj8ayIrWNWDSrg9RGo5c+/oK6Y8ydkzgly7tHXeJvhTqHg6x0+51RLa2i1iyS+s5xKHQxFuvHfgjFcHezxEx21sG2fxt0Mh/w9q0tV16/wBYhjgubmSWO2jEUMbElIkBztUdh9Kxd6x5DKCx5DelaRcowUZb9zCcYuTcduw24hkDMD+6AONvpWvolxpmgeINIurhRrVkhjlurV90auN3zxZ64wOo9az3hM8W4H6+1QXFuYVQhtxKg8Dp7VqnyPmSMWuZWZq+PvElhr3ibULzRtJh0DS5pS8Gn27Mywr2G5uT+Ncw7byOT71NJGSpfNQRnZIpwDgg8jg1nObm7vqVCKirIiKkZI6A4pmcVZMBmZjkDOTioHTY2O1ZamgDlH+n9aZjpnpVq1WL5zLnAHAHfkUy5ZJHPlpsX0ocdLtgnrYg47UpTKgj3oxSsMIv1NQNjeMUzGBU0UYkJz2qMj5qT2uNCFQMfSpTj7LjuTRNGCIyv92pUt90GT61aTuZtlKlYYAp+0b8dqdcYwmPeptoaLchoooqCyWijFLg10FiUUu2jbQAlFO20YFADaMGn0UAN2mjbTqKAEwKKWigAooooAKKKKdgCiiiiwBRRRTsAUUUUWAKKKKLAFFFFFgCiiiiwBRRRRYAoooosAUUUUrAFFFFABSYFLRSAbtpMU+igBlFOwKQigBKKKKACiiilYAooopbCCiiiq3EFFFFTYQUUUUAFFFFACEU2n0hFJgNoooqQCiiigAooooAKKKKTAKKKKkA603pTqQjigBKKKKACiiigAooooAKKKKACiiigArT8PDN6+P+eZ/mKzK0/D3/AB+v2/dn+YrSn8aM6nws6IZzUiE1Fnkd6kXqK9Jbnnssp9KkVueKYn4ULkH2q0SywrkCpEmxioF689KkAyPStkyCUTgnvVmJ8kHNVEQbulToMdKtEM2bK9MCTIEjYSpsJkXJXkHKnseOtX9Nu5ba4WaCQpKucMBnqCD1+tYcAJ6c1s2EbMhfgBcDrzXZA5ZpGvY/uyCV3/7OcCta1vZkAw2wKpUbe2e/196yrQZI4rejjilSHy4TGVTDktu3Nk8+3bj2ruhocFSx2HhC1h1uA6NekSwzDjK5Ck4HGfwyfyr5p8f+FT4W8b6vbyNGkUV80ACcDDE/pg19H+D7j7Fq8V9KxSK1IkdunzD7g+mf61w37T1tZ2GpWtlb7Gvr60Gq3O5dzl3kAQE9s5dsfSufGxjKnd7nTgptTcVsfNU8MtuzSq3lTxMyfL1+XAOfwNVBKdiE4/djKg/xKT0/nXR65J53iCbbCqQyssxVV4DFBkfTINc7LHm4mgTh43by8DqPSvlJrl2Pp4u6Oj0LULdbqBrxtsMSiSQoQWkhBzgZ4LqMgA8EcGnakbCa/wBQuNMDw6d5r/YXnXqBz5TqM4DDtyAe+Oa5BXPk7ccg5z7V2vw+0iXVvtkYie4gELTTxx/eVE5ZgP7yj5h6jIqqcnVtAmS5PeuUtZt7G2EGo6fFINLvU8u4tG5NvNj5kB7j+JD1wcdQa3PCFrF480K58PzRCTWbUNNpl6vEmAMtC4/jQjJHdT0yCRU3hAaVqNxdaDdXscOl6pKLP+0GTC20u7dDKc87N2QfZjWU8Oo/C/xhdWGpafJb6rpF0A+4kPGVPI/2lI6H0INaKCi+Z7MlttWW6KWneHRdWEqyRhZEcIJCwUqc9Ce348U670u60C4NpcWskL423NrcLsyexx9MEH9cV2fiPUI4PEeuWnhKGHU9C1W1S7jgfDzQB1DOiseSUfcCD1HvXGv4xu9QsLayvp3mjsmzDvAMkKdCqOedo/unIHbHNOUYR0QouT1O7+HPxQk0Dwlq3hPWbZ9Z8H6hhjpV6xMEUmcC4jcAtBKvZ1yp6MCDXmV/ozadfubWVbq2ViYZonDAjPAYj7p/r0r379nKz8H+ILy40rxAxm0u4JEkvl7ZrVWGDcRkdl4LpyCoJHSvOPi18LJPhb8U9X8I6owtHgk/dzq2UljYZR1PQqwwQfQinVpvki7ihP3mrFXwh8Vb+zv7f7fJdSyphI7yKXFwijoMn/WAejZ9ARXq938bbW01Zf7XsBc3LsiX1wqgx3low4mK9S46Y75IPIrxbw74Nu7vVbmxaAXMscZlFvghplHJ2Hs23JHrg1teNPBd7Doun+IYpH1bRmAhM6DDxn0Y9nHfPsec5LhOpCA5RhJnW/F34caVc6dB4t8BhrnSpfnltgv/AB7n/YBOQCeq9B29Bk+A/iJav4auPD13BFc2dzIGm0u8I8qV+gliY/6uZezdD0bg5rS+D3ipfDk8cd/Gbzw3dti6t2X5ZF6MQvaQDkgfexxztNZ/x5+HsPw88erAQZ/D9/El7pWrwLuMkD9N/QPtPyk8HGO/FE7r97HZ7hHfkZetPGFjoW/Rr/SRBYRSgFRuQAZyH2OSU98Ern04NbMuk+GNQmhFwbnSra72zRyXFvmEoTjzCQeVOMblznsSRXsn7Mfjr4L/ABS8E2/w2+JSNouswljpeszuHV3J48qbAMZ9EbjtntXBftLfBofA3xBptoNT+02WoQtLpojuPMAQN8whPRclt3l9Dkim1zwdnoaRfLJM6Pw58UfAlj+0n4V8R6b4Dh0vw9pL29pJpTSfaLh9ke0yyZ+WQMTuVxzwM10nxC8ZyeHvjRq3xK8MCxuvDNxqImkt9JnJSAqQQj8AxyjBYHGDzgkZFfMWiay9vqVlcCcW97aSCS2uYVztweoHdPWM9DnHpXa63ot7b6fdan4ZNw2mX0aw6zpivuVGzuVsD70TH5kPVTkehPkVaFOMOZLY9rD1pylo9T621T4oReOviQ/jbSodKtdO1SIL9iSJxFewlQJIpxyoO7hjxtJVh2Nes+Cf2kr34YIh8wXvhDUH+zwfaAzXVrOBzEw6GRQOQSPMVQw+YMD8O/A6x8Q+KdWl8G6Jpd7cyX9pJdxxWvItZo1O2YFjgI33GBPO4jniul8CfEa6i0bV9J1TRJr2xWNhf2b5IfZ1Xd96NkI3LIMlCOflrw66ptW6n0lFqpHkqK6PvO58fR6lqsV3Nd2MYk2yQmVCY5GONqnHQH1OBxXK/Fb4gXFrq19b3X7rUUhcfZ1iZxnIwS4P3SuSOM9M18+eG9TudH0xPNubjVPCMzqLbVLyMrNYyEjEF2o+4ckYlHyN14zXqf8Awj2teN9Xiu9cW71O2lKRSz7MOVBAVFfpnAwB0rwp0qSV562PcitVKGmn3HJw/EzV3v8A7P8A2zAtm0LTmXcCh29VXnlj0HHWt2y/aPtbXxJBcz2GmWkaRLbzQSxyFhwFaZdvG/GTg8c1U8d/s+61Z+I9UNvpsl3bZR4ZGYK2CcKrDGAQOvbjNctB8NZRd6naa3ZJDHNCWgvnJkljdFBwR12cbSe2RWclhZR9ywkpz63RX/aC1/RF8S38fh3W7nVLFUhkMl4PMcAjG1HyNyfMPUjB5ry2DxKJXupQzmOCLBAhZl3H5VAAOc5OR9DX0Y1n4Xl+AEkN7DcnxZBeu6KgJmkjBXKu3TZ6eh6V474jOrrZtpsFvJp8UjedJHJHvkjYZAw2BkYOTx1p4etFr2aWxMqU3rr2MTwvqX2C1mvb2zk1C2ubSaOGZ4ymwjAMijGWZD6+teo/CDwbpHxe0fUHunbw7b6NZzXB1K5JxfuDnaM4yRwML0Hbmuk+BHwDfx74fOo6xqFxHpcaSwqowrCUAMu3OQVPf6VR1DStN0vwzrlpNrN7PqloNumW9tGFt8dZA2emOeV9KqeJhNuEPiRl7J667HEeGdY0pNYjeTzJQX58xSdxr7wu/iDpFz8B50jMyr/ZBXeVx0T61+euiXVxdXdtCJZjOrMI0Qk4bPUY6cda+ydZ+Eup6X8D57oeIt1vHpZnMH2XllKZ2bt3HXGcV5WYqMJw9o9Wzav7CrCCqO1nofGPizU7FdQuLq5tJbyJo3P2UFosZU7XLDkAEhsd8V4xK0Zt0mkaQB5mTcwJ6AHIHpzXpXi1bhdSKsLqC2ZMMZG+dhjBHTkZ4rh9c8OajD4a/th7V00w3P2cTcAGULnaO/TvX6Ng4ycFGJ8nmdSCqNzfkcr4svLO91KWa30o2/7tV2eYzDeAAzjPckE46cmuPbTnEkchVyzseTnOa9f+DPhHw/8AEj4hT2PirUk8NaXNHPIl55m2NHAJVQz9s+tcPrHhu70vVLmGCW2uo1ciOaG7iIYZ4PDcfSvddOUYKcnoz5TnjObhFao5iDTHMVy/2V5CoB8wZwnPU/XpWXLp7SlUSJmY5PH+eldpFeXuhW2oae0sK+eEE4SVZdyhgy4IyByefpWHryRwTW8SX0c0EkKTP9nJZlJGSjZA+YdD2+tYzeisNK17mE0EcPCJLcFThzDnb9M4qW/uo7mK1SOxa28uERvySZGBPzHjjggfhUV3qF0yiKJmhgU5WONsfiT3PvUQjvLySNFeQswHJYn9azUppO4csJNW3J7aySWFl+yTStnPyE8D8qz4LaOK9RpLOWWNXBaLJG4Z5GccfWus1XRPEXg/TrJrmC+0+01KPz4LiRWjF2gONynuoOelcrJqN55hzcS5z13mso1ZVNYtNG06UKejTTGOsbysRZSoCThQTgDP0qq9oHkJ8mXGemDxTmvrsMT9plGP+mhqP+0boNn7TL/32abdR9iEqZMIYo7a4RrSSSRguyQ7gY8HkgDg5HHNUjbn/nlJ+Rqx/aV4FkIupRkc/OeeRTft10VJ+0yD/gRp/vCfcIfs7Yz5MhH+6f8ACn3CK1vbqtnJG67t8m5j5nPHGOMdOKQalcgj/SJDn/aNSDULhwgNxJ3/AIzUpzHaHQiht3ycW8rcdAD/AIVZtdHeU7pIZEB6DpiprHUHhud0lxIFHcMakbWZFlYefI0berGnJT5eg4ez5tbj73R1tmMMsLwTRAK6SZDA/QjjtxUEtmqWLuowVPPPWr1/rMmq3Qub27e6nZFBklYsxAGAM+wqeewY6DcTK0bJuA2iQb19yvXHvSpqpKWu4qjpxWmxyGQXzg1LfSJJ5PlwCACMAgMTuPduemfSiYKjgI24Y5IHGaiuGJ2A9AOKvZNErVpkVFFFZmhYoooroLCiiimAUUUUWAKKKKLAFFFFOwBRRRTsAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUrAFFFFFgCiiikAhGaQjFOopAMopSKSgAooooAKKKKQBRRRRcmwUUUUNCCiiikAUUUUANIxSU+mkYqWAlFFFIAooooAKKKKACiiipAKKKKQDSMUU49KbQAUUUUAFFFFABRRRQAUUUUAFafh//j8f/rmf5isytXw2u6+cZA/dnr9RWlP40Z1PhZ0Cr2xUqDHNdBpPhaLUtHvrtruOGS3jEoVmwG5xge9YSrzXrODik31PMUlK6XQkXmnqucU1VqVACKS3GxVU96eo7+lOjTcB6VKIvlrVK5mxsR596sIpJ9aZGm01aiT5gR+OK1irmcmaukXK2QmDQRTeZEY/3gztz/EPerMHtVSEMq4wBkjnvWlaxk9a7oHJI0dPQsR6E109rAVRTg4IyMjrzWHp6AsoX866yGS4ubWBJHklSBPLj3EkIuSdo9Bkk4+td8EcFRjIoC0waTLQp+8dM/eA6L+JwPxrA+LmnRN4SutbvXWTWLyaG1jkP3mwQdienLMfau0trUyhsbV5A2Yyfr+FdXefD5PGHg+WVYI5rfS9QtrhhIuXaNWZ9insWKoD7UsRTvSkKhVtVij4sudClstPmlmgcHYHDOScZzj8Mfyri7xGgufOBwxIf8eDX2h8aPDej2ep/FGaBoksNBgsLC3SEDy93ELfifKmPvmvknxfapaTWsSFHYWcTyFDn53TeR/wEED8K+XxNJRSsfU4eo5PUtjwnBL4Q0nU05nvrm4tCp6DaU2t/wCPYre+D6umufZTJ5L6hDNZAk42zBDtH/AhlfrWbYalCdC8OQoH8qykZryQAkRu8uVz/wABQVr+CdI/4r28lK+fptleJI7wtwGeRkjYH2ZgfwqKaSlCcS5t8soyOEiaPTLzU9NlJMTS+UXP8O1+uPXFe/axpieMvEvhG58Rss999gXRL6fOTcCJV8iYnuWt3QZ9YjXmuoeDlXxZqP8AaCriLWTb3IXj5ZOcj6E5rCvvGN9braabJI5n0y42LMDyVQsF/EBmH0x6UJqimqiG71LOLJbe1vPh540SeFGkS0vJbYsw4kCMVJH4c/UV1nxZ8HWd/aW3iXTkSKG+dXPkKAvzDBXHYrICD7OpqCwu4PFfgrUGnJfUBfF5JZe25W/9CJNevfGXwrP4N8M+A4re0xpl94csZNQjiKjfM3ybtpHDfcOe5Az0q40lKLXRkym1JPqfOfgLxVP4K8TwTSboUSQLMrclGBxux7dx3GRXtfx71uL4meHPDF9cWzS6rorvo0rwfM01mQstqc9yoMkYP+yvrXLa/wDAbU5vGE9vZf6YjwfaUdE4YGLepx24zn3Bqhpt5eanp+pxpcw2et6LbRzQRsQv2oRZDLg8MwQk4/2B3oVGdODhPboDnGclKIngPxZa+EvFunWus3DyaZ5sU2n65CD5tmAwIYg/eTqrxnleSOmD634j+KPhfwV8XdWsV0Sdvh54jb7Nqumzlc21x0eWBl4A+ZZU7Ycjp0+dNR1WDxVeKYLf7PPON08bN+788n/WJ6Bu4/yN++0y81LwzcWd1DNNfQW4ZVCncPKfYrEnqNjMpx/cHpWEXJxaibOyaueifBaPwcfiFd+GtcuZbjw1fXElkb+BCXjKsRHKUOCAMA5HzAHvyK7H4q6Pc6ZoOqfD3VUg1i78O3J1LQtQmcnz7JyBNH5gPK4KuD7V8t6fp9+Lhbm2Mzzx4LAH94pHceuK+r/D2k+Jfi3+z5H4snvtLsT4XkmgGo6kzRNdIyEPaYA5YkqQegLH14r61TpU/wB9ogjh51Z/u1dni+q/Chbi0t3sUk07U2+byZR+7k7gq38iOD29rvjTxX4x8ZeB7az8Q20epW2l3IxCMrNG6rtd1YdA67MgcZUMO9erfs+6rpHxR0O18KJIttr1shEFrqUilZCT1ik7Ke6HlT8wq18VNNl0O31O6XSLhL7Rp0t9StJ0VZxHjBaVRwWQ/KzDh0ZHGOcdPsaco80dDH2jjKzPlvTNZji09IozPBeCcvJN5m4MuOFZCOuf4geQcEcCvUND8falFplnLZyxobVtlxFwkcsbHgu3dc5HPQ4qW+8FWviG2bVtNtWe0jj837VAhD25z1fHYHjnp3x35BdMvdJj1K2WYZngZZo2AYMpIbevvkA8V5dajOmn1R6dGrrdbn0X8LPFE2j+KNO8e+GbOC81HQ2E8+jNdbFvoejiMqfvj+6chsDuBm18U57S38U2vxO8KXtrbWPiG8kvrfTZRuubZwf3vmRYIC79y4PXJ4xXy74N8W6l4U1O0e2nkUrJkHaAQPp0b6dxxXvVte2XjOziurOddOu4p986qSwhY9ZYx/EjcEjrj3HPmSoUp02kvePao15yqJtn2X8CPFHhXxb4fbSdSvNPs4pUjZVm5aBm6x4xh7dui5+7nae1e46hH4f8Hf2O0F609ukyyHT7dCQhXoqMeSvoDkivzR8AazPpHiSPQdbvItKi3tGLiRcmAseV4+9G2enYEEV9w2fw88beGIIp76JPFWk2s2y3urSYSXkIHQyJgeYPcfN0zmvh8XClRutm+h9XSUajUqk7Lsel658bLWC/e/fT5Ak6qvlbAwcAZGRnI+tc/wCIdZ0iN7DXrC3N0L2zneWzbZiJmG0rg/XgHrU+m/DmLW9KikULcwjfhUQl35yQTgEEHs3Sr2i+C/D9hfKszOIni/euIiY3IOR8p+7j1r5ycacW+VanVBYan8F9N0ux4OLV9Vu/Kj0/UmaZo4ZyY1HzOQCeMDHAxkVyfifw5eeEteuYNQsr+0ubcfvJCpDJkcDIboR3r6Pi8N3Vh4sa20uEEKxeKeSPOcEEZUH8vrWN4++Gup+KPFF3q+qJMk8kiOkhjBTjAwy55xjhR1renioQl7yPSdZSmldWt8zzX4aePNQFxpGlRxiDTbGKWXE+4RtkHczgHnOcZ9hirnjnwRpeg/DCXxO8JsbuW+8q3tgGX7RAerYLEjufp9a7nxT4S8K6Z4ZZbzTWl1q2WSWS3dvLeZscGdl4VAOdgPHQV8/+NrrWvFPiK3Piu6ks9KiVUiWNCFt4cf8ALKPgYxwK9TDKnWlzJ8pw1HJrmprTqUdGn0ez0e7165aK2jtmUWyXXBu5CfmWMDP3epru7z9qfX7/AMHLp730H9myYsmRbXI27RlT8v8Ad5x1rw3xOmnQG9tdIaW40lJvOt0uARKRtxuZgO3p0Nc3c219Y6P/AGj53l285aKORFDKH2H5Dn7r4wc9ga+oWBwtW0qivY+fq4mqnqk/kehfGfUdB0GLRZ7DWrfVjcwM06tbHMLB+FIzxkc4ry+9+IMN3pFvYPPA0C3JlWGW23RLlQNwHr1z7YrjfEUl7Y3stvcCPzUAVtpEg5GfvDIJwaln0z+zfD2n6tMiTRTs8axSIfvKOfTI5HOTzXuUo0+Zumml6nz1epUkrVLSd+xt+Nb+Cx1i9ZEtyikHeun+XgEDGQRxmuZtfEmmx2908qQ/aNq+SqWq7Sc87j2wOnrWJrviC91e6KzyysBGsKA4BO0YTd64/Oqq6Dfx6PPqN5NDa2oysX2hxvmYEZWNRySM8nge9dLVNS0Z5ydVx2NyfxXCNKvleOIrIEBCWi8kN3bHA6/WuX/tu0ZiWtoHB6f6OtVYta1COyu7WKUC1m2GSMqMPtbK59cEn86y/tE6LNF/DLjdhR2ORj0/Ct3Tg0tzm9pK7Zs3Ot2EU7j7HCMHAVrdc/jVpdcs2t4Dbw2m9kIlje2GVO49MHnjB/GuUlSR8K2AR37/AJ1ZMtwTb4dQY4wilFC4GT1x1Oc8nml9Xpu6aBYmpGzR6b8RfjJqHxH0HwzpurG2kg8P2f2GzCR4IjznLHueg/CvLrueFZQ6QxMQwPK8CtEw3Ulk4Em8M24kqM5x61kw3F3p92rxsodGB+ZAw/EHg1NHB0cOlGmrIqtiqlbWRSlnBDA28YYnO7GMVULEcmNcA+mK2ER5EZmKls9CvWlutNlWBZAVwecAV0KlbWJyuo3uZSTjZJmNMbeOPcVFJNujOI1+tX/tM9rb3USpGVuECPmME4DBuD2OQOR24q1o3hfUPEFnqk1obdU0+1a7mWaVYyYwQDsDH5jyOBzSa6Bc55Gz/ADU0eZNqLGhIyScdPrS2/mMMlgsa9WIqzdX5ls4oAdsSFj0GXyc8ms0lbUty7EEdzDBKS0KTqPqBVdrkMeIl/wpwlkkBUHCjsKiYsrYzUNLoUmSeeVIO1eB6dKat3KswkDYb/PFPu7ye6EHmytJ5cSxpn+FRnAqvk57/nSej0HutS2IDfBngBjk6lP4T9DVS6RoyqspU46GrlrrF3YsDBMVx2wCPyo13W5NdkgmnRFmRPLLIMAgdOK0lyON76kR5lK1tDMooornOgsUUUV1lhRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFTYApCM0tFIBhGKKfTStACUUUUAFFFFJoAooooRLCiiihiCiiikAUEZoooAb0pKcRxTalgFFFFIAooooAKKKKTAKKKKkAppGKdQelADaKKKACiiigAooooAKKKKACtXw4M3z/APXM/wAxWVWt4aGb9/8Armf5itKfxozqfCzqI2dUKBm2nqoPB/ClHSmrxTgDmvUPOsSrxx2qRBxTEGamC1SRLZKnbirAXPXmq6DkVZiPPPWt4mTHKnzVcgUcDHNQouSKvwwoQMMTx3HeuiKMZMtW8ZkAxzit7RkSK6hkmhE8SOrNETgOAeVyOeelQ6BbwsSsjAfWtdXitrlvLWO4QKV+YHbyMZHuK9CEdLnDOV20acptL7U7u4tbNdPtpZGeK2jYuIgTwmTyQBxk1uabqF5DpkunLcSiwmkWaS33fIzrkKxHqAx/Ouf01C8i5ziu2vvD0+jQWEk7RqbqLzViDfvEXPG8dsjkeoOa7YK+p59R20FslCYIFbXxD+JMPw88B+B/DsPmJf8AifXBql8sf3nsLRl8uP2WWcY9xGaqeHbOPUNb0zT5ZRbi9c/vXOFihTBmmY9lQH8WKqOTVL9o/wCDkfh/xBp3i/XLy7v77UWW30jRLZdi29mgItoVJ53FVaR3OABubHzCuLHVNFTi/U6sDTvN1JfI8l+J2tNP8AZtRmmLX/iDxXcrPg53JaxRxp06jfLK1ebeIfDQ0+18JC9iEDXUcd3PxlzHKwcFvpEqYH+17165rXwV1i+8JeGvDIJksdFtv7Tv3j+6893IpCAnqSHjUD2Y9q4z4keJYPFPxAU2arJaRSJaWxUcSIuEBHsxUKvsDXjzg/in5Hu05JO0PMpWngq4h07U3ktGhh1JpbpTt+UoJo1XA9i7D65rH8MTHRfC/jABljMenxHI7ulygHP419DfHrxDZ/Du+1XQLZInbw/oulaXHCOXmuiXuZnx/tTSgf8AAT6V8siK4bSLnTrsOtwnmS3ZB5ZFw+P++yo+tYScYbeZtTvPWWx658MfBl58UfFerW08hjS8sxqTSNgfLBGxJGB6BR+NeNfEvQYNGv8ATbhJhNcajA17LGv8GZWUA+/yn9K+g/2adem8L2b6jKh3zaJfWXXknHAHoflxXmHjXwJqGsx3/iS4ljh03SLSO3CkHLlQgYZ6Z3y1eKhzUU1uOjK02mc/8MVCXsi3EpS1KQTSy7NyRgyhQz9go38mvor9s7xFHcfDPwdb2zRxyRQafb4hfdgJalzz/vHP5V8rab4ils9GvY0wvnWT6dMQcbl3q6E/984/Cu8tvFLeNtH8F2WoS72sIvLOBnf5ThUB/wBoxIQM9cCuWnO8fZrdm01yy530Pp39hPxmfGPijUoby3S+vrW3ikQTLwyA+W6j1DRsePWvD/2jPhjFo1/4tvre3eIxak0aQiMjCK7Lu+nBr2H9mnxDY/sifG/X7rWIW1DSorJbu2kTGbi2kbEMiZ45WRfxU11nxS1iz/aX8feKbi3totOsI4Jm2Btys0c3lAgj+9hjWSxGJrVvqk4aJfEdioYeFH6wp6vp8z4D8MmODWbIXMeYZlxKg+88Z67f9rgke496+1fiH4FtrvwL8MfGTGMWz2l1pOp36kKmYk86GZvaRO3UsSOtfJOqfDe/0zxBqGjpbu17bhmjwDuRlYZHHfkfmK9b0P463c/wQuvCF/bRSarp2owXESXYIVonV45OO2GMbfVjWtN1KNOUUtehy2hUqRcnp1JtG8BW809p4j0uRZ9CuSfP2IC9oe+9ccYzz2wcjitX4zfC3U/CEOmyvevB4U1CeN76KbcIY5iceYAo+Ukdx3ANS/s6+LY9B8QwkyFYblCs1mu1/MUZ5jU4DsnJC/xAsh4bj6U/ahkg8W/Au10/SUtJ9B1e3V9PvbckrBJEfmhBPO3IG3d8yqdp6V6UaHto2lHXc5ZVvZN2Z+ebaLqngzxCLjTLpor21cyR5O1yQTj2J/Q9q+ovDfx1g+LXhhtUltkm8daHaMt/ZT8nVrRUIKkkElkBOCckDg5Xp8yW9pqOs2qAzNPd2n7p4nOJYgvAHPUccfz7V0fhCK5g1SK/U3NtqFq48u8tFCzRMPVT1+h4I4qaNKSei0YTmmtd0GjaZeaZ4Ii1eXUha6Dql69rE1vcbZrS7jQOfMhU7hGAwG7oR0yVxXqHw0sdF+KPhS98E3MdrpPjeyL3ul3isFjumxl139NrgA+mfmGORWD4j8BXV3bNrUdrBcaPcXGbhNPADW9wRyUBwwjcc7DypyOwJ5yx8ODTby1ja6l0e5WX/RptUiKxc/whyAMHPKt6044epSunqivaqVmjIh+Ho8QX+3zf7N1O3fMlq0ZLtg8+WpIG4f3SQD2Pao5NVufAmoWn+jSWV8g3zTvMxjulY5+RQMIQOCuTznpivQZvDXjTQn+1azpEr6emHivIA8ixJnru5dF7gkMB6163b+HtK+IK2sWq6fCwki+fUI4wYplUcu6jKOwHVoyreq5rzquX83vR0aPUoYpJ2Z594S+ItvrgjkluP7N1GIgWuswRiVAo+7HcREE49HAyPQivsn4NfHnWdK1a0TxC8Vvc3KKDqkLA212QPl8+Ie3SaHt1UjIHyS/wf03wXfztNpmqvYXKuLbUdOk8yED+8FKHO3urEEe1dx4JutKsLWDT9Qup7/TJH/dxXLRxxeZnhoJs/u3z/CSDn1r4/G4OVR3lG59lhasZR9nJ6M/RWDxpaeJX+xlDp+oupk8hpAVmUj70Tr8sqn1Bz6gGqE+mgySR7Yx/EY/mJ6frz2964/8AZ/0XStRt30+8vNaWycgm0v8AyJoC3Yh1UPE/v8pPXJr6U03wbDZFGExnwuwSzfM5X3buffvXyMsrU5NxKq4uGDk4I8x0+0u9O0eS6ilC3MSgCYwltqk527QOfw6Vx/iX4jvbeHNQlmlkOsRnFuUiZfKXqX+YEnPQf0r6ZttPjtUCDaQqlRkdq5XxV4NGqB5oBCJSuBvjBFcuIy94VKolzeRz4bMqU6v72HXc+D7vxPfxzrdXWpXt4sivLJCI3bYx4+YFcMSOwqD4s+MLDxm1rLBZXrJaWkKzhoWAD7QuRkcg8dOlfR3iDwffafaSyGK13D5R8o4b0PoK8v8AFFnrDK3mrbJDtGdpGRnpjnr7VlQxK5l7q+8+3U4V0pwex8yTWVtcyTCK2uIligf93OhAZscDA9fetG68Ned8JtQsD4bnutRNxDdw6p5TqttGFZZI2OMHPynNeqWt34g029u5bPyAsUYI2BSWywAB3V0niv41+MY/hTqOhjQrWZriM753nUSDLAH5QfcV7f1us0lBL7zyq9BXva92j4PufC8ygO5gETSFRN5hKKR144ziq2rma50+KxWS0SGJi6sTl87QD83ocZx0zXa+J9Dup7I/Z9INvqJ3/aHkIkWcFgRszwm0fnXnuqaHrKzsr2cSyqcMGVRyO2K+noVG0veR8tiqUYt+4ypJbQ6Rq5adLXVYU/5ZtK0YkO3jLDkAE8gdcdaksPHmsWfhK90O7/s+/geYXFpK6jzbOXoxU7cMrLwUbjgEciqPiTRtUsdSlj+zKroAQAFOAQD/AFrnTpt9hw1uMYPYde1ejC6d+ZHizcWrcrIRpUkkE7tcwpgAgMSMknoOKjsdBkuJRi7togASTLLgcfhV2Cx1FLK7QWyLG6qCOOSGGO9RRaZeXqrClmA6I7MY8AsACxJyewHauuMpfzI4pKK+yxNcFjNHYiytltGSAJcO9z5nnS5OXAIG0EYG32qG2sVIjJeL7uclxioZnvJ7OK1kjzBAzPGuwAgtjPOMnoOCeO1WtSMlxZ2KSwLGYbcRr5ahSRuYgt6nk8/St6KcYv3jCq02nYpT6hLFEyo4EbnB54NZis0jljIhOe5rQlsDNYptikJycnPFVrfTZoriJ1gMhDghXGVPPQjvWkpO+5mkrbFGSVkcZdSPRTWk+ri5tYoEiUOnO71rOls2WY742HPKgV0emeG7nXJb2fT7KZ4bWFp5c4/dxqBkk8D8utONRxTbZLgpNJK5jMz3JcgKCF/qKpS20sgO47Uzgn+ldfpPhKXVku/JzG0UBmCsrbpcEfImByxzx9DWZdW6LbBfu4bG0n/PNO6k7X1FaSSdtDmHILMgGFQcCq1wpCJx6/zq/IircP8A41XvImWOJhsIbdgBuRg459KxZpcphiucUkf7x+eadsLHpj8amsrUz3CLkKueTmoSu7FN21C5UIsQEZHy8n15qBImmJC8f0rvfHngaDw3BpAi1mx1L7VZJdSfZJC3kbif3b5Aw4xyK4qZgV2R4EY7dz9a0qU3TlaRnTmpq6Khj2981FIu3FTmMseoB+tQzRmMjnOa52tDojuMooorM0LFFFFdZYUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRTsAUUUUgCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKVgCiiikAhGabT6QikA2iiigAooopMAooopksKKKKkQUUUUAFNIxTqQjIpANoooqQCiiigAooooAKKKKlgFFFFIBp4opWpKACiiigAooooAKKKKACtbwz/AMf8n/XM/wAxWTWv4X/5CEn/AFyP8xWtP40Z1PgZ06qSRipVB9KRcg1KpzXqJHnDlGBUgP403r2xUsaf5Naoykzfi8LSN4ROv/bbQRC6+y/ZPNHnk7d2/Z/d7Z9azEjpsY4xzViMYHIrp0eyMNdbksSk9gKvWy4YAjFQRAAjitK1jDuPStooyk9DW0+0WSOZvMjiKJuCyZy5yOFx378+lXrZMk8KM+g6U3TLYSuEJrXn08WuCK9GEdDz5zs7FvSo1I4HPqe1dPcXtxfyJNdTS3MixrGGkYkhVGFA9gABWDpMXKj3rrrvw/d6Xb2EtzH5SXsAuIDuB3JuK5wDxyp4PNdcNDgqNX1O8+A3hvTtf+KVj/aFzEmi2afabye5GBOsKtL5eD0iT5nbt8uTyVrQ1rRdU/ab+Pq6ncW8mm6FrwksNDhnGyWPSI9v27UGX+EugWBD284gfdNdx+zt8J7TxLDPbaw5VriIM1uflP2LejOD7Sv5QPqqgdCaxPi18bLDw1d/E3xBpYVNQubFfD2kNGMR2thDkEJ/tSSMpwPUehrxcSues1Hoevhm40kzO+L2uWQ+HvizVtBtoreXWdZHhrw/tIJeYLtuLk/7MMBKqegaRz2FfDd5fabd/F3wxp2k26No1rqMXlsg5mjRwomc+hCkj2ye9e5arcarfeFfBXg6J5mXTtClklli/wCWU96Dc3cpP97y5Io/YZrxb4d+D7nWPEni3Wwr22naGsgkmQcRBUYBR7hEb8WFc8oykop9X+CO+nyw5tdv1PRvEugW+t6JrnxP1u4W41rxFrlxb6Xal8mGBMZcL7bhz9K+bf7dk1O+1V7dRHHKxaUkfcgjO4DPqzAZ+ldr8YfF13a2vhLQ7aZB9k0VTKqNkRyXBM0h9mAdV/4DXIafa21vp0GnQYZ7tPtNyx6rbpliPxx/nNcVeScuWGiR3UVyxTfU9uvNTsvBP7M/gy+tIGbxPqs11aJI5ACo4XJC9SckgH3pfj1qVtp01h8OrC4jaeS4Et+IwMKR87L+LBB9Eyeteb/FnxI0/ifw3oFvMk2neHo4YA8EgdJJ22ySspHGAx2/8Brg7vX7qbxXPrKeYGLkRs43McggH3J6/U0qtVfCttEOnTfxPzZW1bTlMt8LYbltmKO46Nzz+tX/AAFcpbarbR3TmGwu2W3klUcwsT8kv1VsE+ozTrLQtSuYJIILeRzLF5zJnPAOC2PxFX49KMusvpF4ywTSoA+eCr7SAcD6CuVQfMpbG/MrWPRfip8RpvFXhfRRdRLBrWi2X/CMXwA5BjnaRXB9GBYf8BrsfgR8RYfD3w88Va48qRTxXFpHKSeSXnOAoPXjzGOK8F8R3M0/j3W7S4ZS1xKok28K0iBSG59fm/76NfYX7HPwy8H+Ifghrus+KlaS20m+ubhLcrhJrgBYYQ3rgyZA9T7V2UpynPm6nPUiowseO/An4tWqftCWWp63aRiy1PUZbe4ideI450KoTn/aCHPqKz/2sPCx0n48+JYtLj8mzWOHYkQ6q0SsenfmvNEsZ5PHmAjG4N+YHhgUsVKyYGPXpkfSvpDxh4v0KW50+5upI9V1e6lIu3HzRxw/ZbcIQP725XyfauyhSdeLjJ9TCpP2Uk49j52tLvUoUli8xxcGZZ0ZzgRt1LAjoTx0r6P+EXxJvfGPgDWvhtqUjx3t2w1DS2kOFN3HyY8+kq5B/wBrB9a87sbSG41CYCCOa3SYhHi6lM4BAPqP516Z8PPhla3t75txeLo62kbXFvM8EkhaVeUQbOVJPQ9B3r6TCZbKPvdDysTio2szgbVNF1O8zf2h07UoyUlEh2SKQcEZ71vXvwavdbiN/wCEb/z51IYoki+anqCufnX6dK9Wg+HUerA3l7oGlaugfbKWmNtOc89GPP1HFeieEfgz8PpmMs0Wo+FZyo2yqZVVT7OodT+de3PAUoK8/wADx/7Sinoz5s0XTPH/AIeneC70Wx1KOQCOa0ukEInX0ZZMBv6HkEV0ms+F/EtjYW154Y8F+INPkTfJe6ZfIuq6dIBjYICu51PUFXyvpX0drvwy1tdMc6L4tXxdpwGBb3Vuk3/Ad6YIP1ArF06/1bwxctazXusWcsGFktLTRJLsLn0IXP8A49XHVwFKpT5oS2/r1OihmLlK1j5+0P40+JfCV6sVt4eh02yxmexuQ6IGPULHJ8qDPZSufSt65+LkeotcXP8AY+mW4uY83MNpdCBW7ENG2Ub67ga+oI9O8V6tpr3OiXWn68pwZLPxFpos5kUcnDSKF9sMnf71F/8ACXxf4j0yG4j0r4WS3EyYfT7qylgZG9FuImZW/IV4s4wpxd2exTr+8rM8Y8BfEnwxqF4PI0e8tZkKmaC0uI7lJMdC0BkJJHZlO4djWtb/ABM17QLu4tb/AEbw/wDEfR5mYtDe2v2DUTGT9x45VG8gcZGc471zHxT+Eet+DxHP42+CMd7YA7n1XwxfNNbqo75K7o/xI+tZPw7+K3gb4e+KIYtVTxq/gqSB/O0XWYFuFgl/g8uRyQyevIPHevncRSi1dbd0fU4bEvrqepeEvEXg+7v4v+EQ1bWfh5qxfaND1aVzbq/9yKQ5MY/2TlT6V9N+Cfjz4m8NpbaZ4ptYr0fdiv4sKD7MFyp/3kOfVBXxT4h+J/hu8tBeWug6N4i8OlzhrGV4Li3/AN+CQkofeJ9texfBz4i+Fr3VI1j8QXeky+QPL0/WkJ3E4wCWwWAHuTXylbB06kmoysz6mNWNWnarG6/L5n28njCPVdLS7sponVhhtrhirY+7VKy8UXFzNIjAmGKP95KoPyk89K8S+1PYGe/tbuzsNVeQOsNgzNDqUPA5ifafMHZkyfqOK6e08WR3+lXEWnXj3DeYqTovyuhx91lIDKf94V8Tm1KphpWldxNaOCpzj7mpqXviSK/uJLd2xCxIlOCdgJ4OD171578UvDk2jiGfTCdR0y7ZUWZGChGbgZ9Dn6VBrCauiS/ZoiHEm1Rk/OCDnIx2/rXPySazp0dtNEbqKUOwl2who2ixn7hOGbOeOB0718rCylc+no4Z0WpU5fI4rx9b3Pg3xXJod1cQvILcSPOjk7SVJ2Y/DH68V5V4i+JQ+y3U91A7MgW0jSeUCQMoAz1J2gcDHFbuseFxqGpfb9l+Y72R3nsI2x1yBiRs7Oeqt24BNcL8Ufgz4x8CgLq9tO1gzF4p3GUl+UZZTk9sCvp8K8PKylJakYqVWmlHqc34i8ZSb55LSI3qRW8c0jRuwCK2Mqd390nBxxUfhiHS/G3hPxTqtzrNtpesaZGs9vpt18z3wJw2x8/eGRx3rjI9Gu727trSS3vWinZVdxD847Ntz1GO2eagHhu5lvo9I02PzN915UV2PkacMwADgngdDjtk9a+gjTox0TsfM1ateerRneMb670jXprPUreRLxdu5QUcgkDGNpIPGK5O51eTS76SCe0KTRN93cMg9f8AIrufif8ABzxF8LvFB0PxHb/YtSA8wrFIsikEkBlKnpx35rhNa8K3VnbJdyM8nmE5LDnr1zXpQqYd213PLnSxDi5JaIvebPbaFNe3lndW9pdRMbK4ZP3Uro4DDPcDkHGcHFcx/wAJPIDkR/kc0upapqN5p0FlNcTyWNluNvbu5KQbzlto7ZPJrn2BfpnOccV6EIRaWh5U5tPc2J/EBDElN5PXmrd9qsZt7HJUtLAG2qQSnzNwfQ9/xrm7qdMCMAovG4A5yR3qBZApUox3deneuuMKcehyudSXU6htWkW1EYAwp3CqH9tOZ4t2FUOCWHUc9azxdo8IDIQ27lweuegx+dV/Pi8xQd2wkZPf8K0cab1SMeaot2TSaowkJ2DGevFXPt5AWRXdc9dhwPyrG+Rmz1Ge9XN8SxKN3J7U4wjqDnK6Z1sfj+WC1aJLi6jYRqiSRybCuCM5x1GMjFZOpwyLbQySRAxz/PHIGB3D/PrWKbiGJJQyF228EeuRVUurj5Sd5P3RTjCFNe6KVSc7JjGWMzv8pFVbsJtTg9/51cjmy774w3GOe1U7pgwTAODnn8alrQS3Kx2jsa09Dt7eWcCZzEueWxnFUEUhhwSTXZ6Jp9tfwFZWEc+OGx1rSjDmkRUlZHOavdRGVo4izR5+8erc9aySFOeTW7qmmNHIwUbtvcVivDIvGwn8Kipfm1NINW0GKEGOTxRdGEwRbN/nZbfuxtxxtx+ufwo2v3U1HMpULlSOtYy2NluRUUUViaFiiiiussKKKKACiiigAooooAKKKKACiiinYAoooosAUUUU7AFFFFFgCiiimAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUrAFFFFKwBRRRSAKKKKACiiigAooooAKKKKACiiigAoooqQGkUlPppGKQCUUUUAFFFFLYQUUUU2SFFFFSAUUUUAIRTaeeaZUsAooopAFFFFABRRRSYBRRRUgBGRTadTT1oAKKKKACiiigAooooAK2/CMTSahNtBO2Ek47DctYldJ4EuGg1O6A/5aWzIfpvU/wBK3oq9RXMqvwOx0Sqc9KeFBPSpkjGfSnrGATXr8p5dyKNATVyJPUU1IwOatRIPT8atIhsETvjipo15HFKAMYqVF4FdETFk0IAwav2zHjFVIgDjtWjaquR0roic8tzd0mZoNxCqSVK/MMkfT0Na0cr3ZArP0ySOKK4EkKylo8IxYgocj5h68cYPrWlZxmOYD5WOAcqcivQg+hwT3bOj0IrYXKu0MdyNpGyXO3kYzxjkdfwroNHsJNX1Kzskb55nCBmPCjuT9Bk/hWBZk8HAGa3UIWKDARW2FiyHLHJPB9CMdK7I6o8+d7n0j8F/EcZsvF+sSSG1sbyI2i3DvtNvZQRF2Ye5Lg/8BFfCPxF+Kl/8RfEM+h6Bppt9FthPcwQRKXLv0Rm7nAKj6k+tfRXjW91y98C674I0SzKWMDW9hquqpwtsPKe8v2ZuwCLDH7lSO9cH8ILKz+E2seI9cvLZI76Dw1ezrHJ/yxYRAxpz3DOP++RXg1PeqScT38OuSmnLcn8JPB4R+Bnjf4jalgQRBND0pZP4jGqhiM9WdgmT6fSuP+FV/pfhr9h/x34j1uTF74g8Sf2faoGIe4Kwq8vTsM/r71yX7Rvjcr8C/g54Es5CI4dMfxBqaqeHuLmRvLz64RR+dcVfa/Lqnwu8A+ErdTNbafPPqc6KOGnnfOD64SJB+JrjlWlKoorojsjRXJd9X+CPOb+/GpyXjT2ztfTzRxg5x5USjkY9T8vPtSa0tzcPe3scZjil/d7IgSIoEwACew+6Pf8AGu08K+BFu9B8R61c30FtFp8yoBICWmkbdnaB2BB/KqnxG+JT6voWl+GrUpDYWyZu/JhWMzOW34YqMthievoPSvNqwtG8nqz04Su7RKfw08HrrcJ1O52mytXw6ucKTxgMfcZ/KvSfif8ACaDTtRfw5G0a6la6Muru8S53uxjJjUDsBI3/AHzXkXgfUHi1a305Cy215Og2ZyFfOM4+hNe5p8Qvsv7Rz+Itas7i10yZLq2t4riEp5kCwsIWwwGVLqp47VvT5PZpMzqcyldGb4B8daB4R8IeJLx7FL/xFsjtNMSaLeC7fLtH0+8c9eleT6nqklx48ttQ8x3EMkQuboDILAgSt9MlvyrpfAGjSeOrC8gtrh7O40+KXUd6YUyzKCevoq5wB3Jr0X4AfCa28a6Lept+0y2e8NalDmd8JsQN0yzPjH41ThOol2EpRjfueT+ONNkuNTOvLZyvpt9q90kckcZCOowFKnvkKT+Br601LUrX4PfsxeHdNtpori98Q3Y1ryt5DfZFw7k+mZFij/769KwPiaumaL8HtZ01ZbXUP7DmTSbG7t1+RruSQBjH7LGk+D3VlPevHfC/iX+29U8jXrV9aWS2WzskkkKiE7/kVT0C5J46cmu/D0Up8t9zlrVHy3XQsaFp2n34lvIXNprclyZob0TbIlQqd2R1zngfWtnw/wCG/tgj86JyscZBdV+6qrx/QVpx/DTVfCfiu78P3sduZrG9kt38pw8YcEBgGHDAcflXu+t+HfD3hLw7ptul152r3LxSS2kS7/s8WwZMuO5bonXHJ7V9zgcFTUYuS3PnMVi2tInl3g34dtLsnVM/PhvMB2qp75r64+Fc/gPwPb3MWpTNqV9EgDQW8fmq5IGCrD5SPckYrnvCngjw7r02lRXF7qch81o2tLfTzAvl/eUnc3OSSMHnAr2XxH4D0LSf7LbTNPnt4A6RsZkEZ3McDcw+XHTk134yvh4pYdXjftpt5s+TxFada7etiqfFGl6lG39k+CFmWQHEl8+Dj/dU4H51paP8P/EmopJcWOn2OiGVPlxAcfmSw/OvZPB/h+0tvLttTha1WSNVVXwVLf73Y/oas6tDbeHNTBgSXYBvLwjD4/3ejD6c18TUzNRl7OhHXu22XDBVHTVWVkr/ADPDtS+G3xK0uMvFfQW8Ozc11bW8K7G/vZRQxrzjxJ8LPGniqb+0JdUTxZbwMUaXTdQFpcxj+6XUAEj0cCvtaLxDo2uaUk9lcpes6k7IJAT6EEf414T4y8DXs2qN4i8FLPpeqQN/pDxMMcfwyLnkH0YHiujBZpVnJqcYxfpb7+qOzEUY4aaUJ8yfY8MbwPFo7Gz1fxt448IM7Kqw63J51mSe3mlXjIPqTWh/wy/f6wssceoFLdvnMlsTp8kqno8c9sRE/wDwOM+9b/xB+LuhPbJaeKNMvNH1OYFZ1092jSX/AKaRnlTz1RwfUVzfh34gxeAfKvTrH9rfDy5kEF6ZYDHcacx5AeKMENnsVGD1yMV6dSniKtPmcbS9NH6M6MPiJqWmq7nM61oXx6+BsVyfC/ii48a6HACtxpOoR+bcwJjOGQ/fXHdDz6V5db/Gm08QQmaxsF8L+Iozi50149+kXw/umNs+TJ7j5T6CvpD4wfFvTtf0/RtU+Dmo/wBsz2wc/ZpkmZxIOuH6qcZBBypB6V5ro3xP+EXxD1lNP+KPhibwX4qljKy3F3btBHIemTt4YejD9K5FRvRVScGr/f8ANH0NDE1oztZOx5xps/w7+IbuJfDaeGNWcgTSaZOI0Zv73lkGNufUD611d7+zr4lgsfO0zVLXWdPtogZNNvJCgCdjtJLRHH8Ssye46V03i39k/QfEd1L4g8DeJ5tVU4aKWydJGVVUDDgDDdPQE9wa4f4NfD+40fxU2m6j8QjoWqq5a0gvA8cs/cvbyg7OOhjI/CvjsVljqyvDVfifdYPNIQVp6M6vQdD8T6mLHw7r9nqENg9u9nY3N23nJaIxDgbwcMu9VIYHPatnwTrHjv4a6/bzyz2GuRj91FHqV2FklYHHkQ3J/j9I5SPar97p3ivwZeXl0bhtZsJJQDd6IqQPE4PLvan5Hb12FSetRaH4kvviJcX2i+LfCK67pksEtxJ4gsYFh8uGIZdp87QSg5KsA/png18hjMpnK6ne7PsMPmNKUfda5T6a0TxzpPibRbfV0tHimDsj2V3E8c0Ei/fjkUjgg/ge1b99qelXdnpgSykKX5CtIo2xxnODz7V8yn45fDvwxq1h4f0+7aLSWgjTTNZvL5p7a9HXZ57cxsDx5cmCABg12Hia28Qy6RcahELP7BGilpoHGyLf93nPBr4TEZLKFXkWzOiMac4qfM1Y734k6p4P8N6TqGnz6b9r1JI28v8Ad/JuPQhq4PWPFWp/Ef4byyXaWt1a7pbdrU25MyMqDbtwD16j6V5XrOq694/aK0tkJntoMMiOSrqnWTPY461x6/EW+8J2yx6V5aTqzPeP8zidc8Rup4wvqOuRzRSyOcIX6mixGHgkua8u7/rQ5XS/F1j4R1yDUxaEy2FwHhF3blo2bJGCBgj2/Cua1j4tWEupX2pt4ehe6u5DLveLBhkLht0eMYORj+ldbqXw31X4jaF4i8d6DDbR6bYOoutOlkBlicnJ25wWX+IHOeo5xXm04i8XaLItzILHWIZ1WOeNGSK7LZwJTnarjnD9xkHoDXu0sFRn70lqtHqcdfHTTtGwzxL8Wo/Hfia41nxBbT6hf3DqGncfMQoAA6gcAV7N43b4V6/+zlp9rockEPji4eEPbSMylSXIYMzfIOMc5r5f1a3v9Eu7iC4tzbyQytFlD8u5eG2tnDfUHvWbbXd9PeLbW0cklxK2wQgZ3E9sd63rZZGrKEoSa5XfRnGsylGLhMq6z4U1CyXVomtGiksgPtEcnDxfOByPqR+Yrh57N9zsnzYG5iBjFe2WWpWvibw5c2d65tNQtYljjupM5gQMBhu8kPQFfvR8EZXIHGt4d1OOSQHT7OQDcu9Jo8N2yCH5HcV9HRrWjyz3R85XpqUuaOzPNZosk8YOelOm0+WFIfMjePfGHXepG5TnBGeo967SfwhqPkSyfYbdWXBETyJuYd8Ybt71TvrDV7mO2zaoBFCsQJmVsAZxjLe/SutVYPc5XTktjkzakqRyGz6cfjULwFHUEc5FdG9lqiJKPsseTgEhkJ9eDmqcWnaqt3DKECSq4ZW3pwc/WrU4mfLIxBA4VmCkKOpxULMwOe3at1dL1UpJEI8JIctmRef1pJPDeoEKBCi4HXzEH9avngluT7Obexip5rQzlVZkVRvYDIUbhjPpzS2cnluGIDCumuvCk+mR30c0i3EKwBjcWcnmRMThlG4cdex6EVziQtGwyfypwmp6xYp03DSSGPMrSuVG36VF5ZWKN5I2EbbtpwQGwecHvzVmKFiX/OkuZpmhghdyYoyxRfTJya0afUyIbG3a9uViTaHbO0uwVRgZ6njtU8GqtapgZz61WbcoPJ5qo8rk/ePFF3HYbSe5dv8AVbq48rLlQq7RjjjJNZzTysTlyatXE9xciHzndwkYjTd/CgzgD261A8brUO71GrIjEsn941HdPIxXzM9MgEdqeS2MZNNvLiW5ZGmkaVlQRguckKBgD6AVnLY0jvcgooorE2LFFFFdliwoooosAUUUU7AFFFFABRRRTAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooopWAKKKKkAooooAKKKKACiiigAooopMApOtLRUgMIxRTiKbQAUUUUMAooopIlhRRRSYgooooAKawp1I3SkA2iiipAKKKKACiiigAoooqACmnrTqQjmgBKKKKACiiigAooooAK2vCRI1KTH/PI/wAxWLW34RG7UpB/0yP/AKEtbUf4iMqvwM7BGJ6Gn7jnrTOlAYFuK9nU8ssoxA65qwkpFVEyRVlFJNUiGWVcn/Cp4mJ4PSoEGAO9ToMmt4mLLMZO4AdK0LU4PBwaowrk/rWrY2bSHOOK6YHPPY1rCTg5OODWtYyMCpzWNbgoWU9AK1rEZxXfA4pI6XTpmbGTwDXV6AsX9oWskxxCkqu5PcA5x+OMfjXI6cgY9ce3rXU6ahC8CuyKujzqjsz1XW9Kku/g7oug2lxi+8ZeJ7eC88s/PLE0vm3RP+z5ccpPtXi37Zusp4bvLe22Ol9rljNdSRAY2LNtlwR6Bdg/CvSbq4vrfQ/G+rWVwwk0nQF07QVY/wDMR1Am0Rk/2hEJ2H/XTNfPn7VGq3Xjv9o/VI3LTWWkpB4fWdWyGeOJUfB+qv8AlXztaT9rO3XQ9/CwXs4OXqeM25n+LHjPw7pkMfmXEOmw2flICSTFHsUe5wAeP71eo+HPA8Wm6U5toS81lZXmpSs5wQsZWKIe2S6N+NZX7JhtdP8AjXrOvmBYdP0zSdSuot54TZF8vP5c+9N8ReJrvSvCU/zNA/iLw8CPmx5cTX0abgPdIM89mrjpSUIuctz0aicpqEdrHKeKtQt9D+FWj2cO4X2p3s968uflaCMeUpx6F/MOe9eVafG15IcguScEDqep/nXUeOfETeI7fTXSExpFYxWUMSg4SKIckfU8k+pNQeFtMuLLR5dfjVJI7CePejrkZZvlB9QSMfnXHVftKqXRHXTShDzLOi6bJpF5a3kg8r7Ndq2CpBLKRnmul+P/AMYfEfxS8VWl1rurzaq1hZLp1k8u0eTEpxtXaBwPXqa7u58DWPjnS/DttYTNb6pqU8129osYCx2wgEm4MTz8x2gdsV5L8UfCthovidLPStQTULdWWJ5Qu3ZKURnXHXCliue5U1tXpezh7pFKfPLUTwV4ouPBs3nWkhEjBlBAB6qcnng19BfDn4u6f8Of2UteGlXEZ8b63q8ttaIGG+2iEYMlwB1GAyqp/vH/AGTXz94f8IX3iaGZIWWaaEco7BQfnVBj8SK0j4eOl27SKUdot0WV5OAxDH88c+9XFTsl0FLlbZcj1PV7zw3aaVOZf7IiuWu0BzgzmNIySe+FQADtk1u6JocaHJUzyfcjwCqgkcHPse1abSvqFjoSmIx6fNbrmGJSqGVCVZuuC2STn3r3bRvht/Yk8evTQx3Gi6PFb6zcPHGSkke9ECgHrk549jX0uAw32pHkYqvGKsZ8PhiTSfCun2z3DW/iRpFljgVWLC1dNxmZug5UADqck16v8H/h5Jc6dd63eadNqaQvH84LHy8klmPdiQP61Y0HU7zxTqzfEy6so7jSReI7WEePKtVLExREdlCjH1zXY+CvGGraVqxvUDP4eeV5hBYjKWp5xuHUgA4zX2jlNULRWqt128j5WUk6ji3ofRmn+D/DJsBrlnqaXWLWNkhiI5G3PygchvQ+o5rR0fx/Y3Al0bxTY/ZLedBHZajexhI7tCPusuTtf2PXqK+YtK+Lh0PVUtNI0nUI57u4xHbyQtsnVwc4fPy5OCBXda98QrD4ieCJtNla2tr2zEazWV022Z+SAY+2c496+VrZdUlJe2k2u/VHTCUVrBJfqer65fal8PZIjaXcGv8AhWdF2QzT4ntgTj5JDwV9AelQP8TNB8axTaLaXsieJtJ+aK3d9k0q4BwvPzdvXkCvmi78Ua54W01o9NuVewDlJrDVAzW8rEDcI5eisD1GcV4t428XC0vUbUtG1Lw+YY3MWo2rkm3kxlJFdeSM8Y9DXZTyik43nP3ls119V+ZjG7k0l7r6H0frt9N4K1qXXPCd3PZa9CTc3djId63cTNuJCHo2cggdfyr3bwP8R9M8b+HovF2lT+RLNCft9kzZ2kHHTrjIIB7Zr4astS1Dxdop8Tt4ml8VXsUaRPcGREZETJ7YycMSc8n8DS6EPE0Nvc+M/AurfY73TwZtQsmO+OZN21m29OhBK9wT6VrisJTxFJXfvrr3XZ/p2HDDunLTY+gfjf4O0TxDanVbXU7WKG7dkvbK5O1UYjIkQgEqQQMjHOcivm/wr4rvvhf8QorKS1tfEenyQMg0+Bsm9g+86QO3Imj5YRtwykgdql8T/Hm41nxBaprWi/M8Pk/bNIgluLS5STgHAG9G3dAQcEda8X8Y+JJ9T0UWF0rWV1FJ59jejMNza3CMQC5PTp+RrKdedOh7CTbt/W56GGwijLnfU+1fDi6TDFL4q+CmvWOlzakpa60bUUZrC7YDkPGPmgnXvt/EEVgfFfxZaXfhixsPjn8NI7/R79Ntn4l8Oy/aY4WH3ipGHjYdSv6EV8p/Cr4oar411qdNPv4tC+IrKFlstwhtPEQXn5f4Y7oYyOz9uSQfV9B/aT1fwnpi32r2KaloFzIsep6PJkS2b5wJVB5Rs9em1gR0rwZY2GnM7t/ee1HAczbjp5nCXPgYeFL+TWvhh8WZGtlGbDzWeOQNkYjeVT8vH99cHGKi8QftP6nquhXXhT4teEbbUZ9pWHX7MCKWGfH7ubgY3A4JIxkZyDXcazN4I1rQ31O/8PaeRrF0X07xLp5a3Xzgeba5VTgMV7EdfmFbvij9l/Trn4CXnjOLWze29tMtuba7j3yxMWx5TFeAAT1PqCOtcuJr4aceZS5Xf5M9Ghh8RTupe8jxDwx+0F458DQCDTNWS9sZhuEV9iZjxjgt95T2B5HY16d+zz8VpdQ8SX66rq8GnaQLN3v7bUFe4jeAdYvL+9OpBIC/fTOQcA14LDYSeCIH1fQLKfW/DsKFtV0p9qz2b4I3RvhiYuQeQR/OuLPjpbuO3vdPjk0u5gAdvLdsb8/fBPTPTHSvn8VL2jTUtex7eFl7HSa0Z9b+MtD8D+IfEF5p1jqyaPaXkebG2vxmydTygWRhjaemJB7bga2vCvjcfBnw+/h/X5dSi0qSZAtjKpntrY/wmKQneg5yI33KQcxueleG6T460Lxv4Pki1C2e7jtE3XcVsAl1aHvd2+eGX+/EeO4xnjtbBNd8OeD9Bt7y9svHfgrU8rZTohJgwfmhDMMoR1MTZHt3ryoYWU5e6e3LFQceV7H1BBp93J4dfUbC2ligaIzrfWUW5ZEwAAZB0Q5/oRXkfifwpLY2ovJrJmgklbDx5UMQAcLkYyM8j0rr/A/xbj07w9Z+DNbv38KeH4VZIb22i225UkFVuUGSnJA8zlemcda9a8T+DdY8TaBoegTzQyWeVk06+tyr+eXGGzsJyMYw2ea29hJO0jglJLVM8e+GPgvxd8Q/Dc/h/RrOzXT0uTLdTXT+WjFkwVcfxADkdwckGvH/ABR8L9T0W/nsJtOu1gj3CQ7wpBBIBzyCvcHuD2r1/wATaFrXg2aSzzI0tvI4kSFdmDwAA+PmPfHQdKz9ZudbhtvtE8097p13EsRmuogkgkAAdY/YZ2g/pRHC+830Zz1cQ0vQ8D+IiapqWrNZyoI7WxXENmVWKO3VsFljXPHzHOBn1ridP8OXWps8cNs6XDSBImYqq9f4icY7c9K9q8a2F1pN1q2lEzXelSSLOI5ovnVuihn+8CFPY4NcDFpslsNzW5e284AFlGWIHK8+3atFhpJWVjldeMmmzg7w6jdt9nWIM6p5QDRqWK7uhOOee5rdv/gf4j0UGXWYLLw8G0+bUIZNRZY0mVB9xcA/O2cAete/fDD9nh/GPgTWfGN9rCaBp+hb5pp3iM4Kqu4YReQc4HWvD/jD8S/EvxJltDrGopcpaRlI12LGFTPXA6npXRTo05UpP7S+45p1KiqxSs49e/keWeI7G1tVtbnTjLJY3EQ5uNgkWQACRSqk4G4naT1HNYbQhymxFTCDPPU10ccBkhazlACKWkJAUMp28Hd3H+z/AFrsfDX7Pfivxr4Q1PxJo1ql5pOlwiW6mjmX90MZxgnJOM5A6VhNwoRvUdjWEXWlaCucJcXCpomo6abSwvJJLuOcan5Z+0IFVhsQ5GEYtlhjOVXmsOC1kiuI2GxsMDtYZ79xV2axuLZSpcg8E5NR2dld3t/b28Ui+bJIqKXcKoJOBkngD3rrUZO1jnlKMW0zLaykWQ58sg9vSoZLZmZQNgxxmrVxFdQTyI27KEg8Zqq7SLj5jU2ktx80Xsdf4d8e+ItE8J614btL5U0XVgpu7PYpWVlI2tkjKkeornpLGdkTJjIJOD/jUllp99NptzeqH+zxbVZwO5NVTfXCAZfpyB6VmsPyPmStcv2/MuW+x678BP2btZ+O1/qdrpt9ZWr2cQlY3JbDAnGBgVyfxz+Dep/BnxedB1WeC4uFhWXfb5K7WzjrWt8FP2hPE/wW1W9vdCkgEl1GIpBPCHGM1lfGr4w6x8ZfFA13WvIF6YViPkR7F2r04r2r4f6vZr3jxksT9ab+wecWaRTXiRXVybW3OQ0wjMm3jj5Qeeaz2BBOKuOvBY9TTWtWEKSHG1iQMMM5HqPxryGepuVpHnjEW/IBTKbh1XJ6e3WhruRk2cYqW9tZIUtmZyweIMo5+UZIxz/TjmqwGO2cetTqtB6WEeR43IKgEcEVBcNuZeMYFTMCx6VBP1XknjvUSvY0juR0UUVgbFiiiiu4sKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiikwCiiipAKKKKACiiigAooooAKKKKlgFMPWn00jmkAlFFFABRRRU9RBRRRTZIUUUUgCkbpS0EZoAZRS9KSoAKKKKACiiigAoooqWAUEZoopANooPWigAooooAKKKKACtzwf/wAhOT/rkf8A0Jaw66PwJbS3esSpEhkbyCcL/vLW9FXqJGVV2gzqcbmNAX5qmeNo2Ksu1gcEHgikVAW649q9nY8ofGuMVOhwaYIxxU6RAj0q0jNsmi5FW4Ii7YFQwIoArRs7dpJB5Yya6IIxk7IckRidc8fWtqCYwEj5fT5TkVlXKSLJhxirVqenpXTHRnNL3kbVq0LLK0quzFPkKEABsjk+o61p6cqkj5ayrRQ+evANa9iCSAoOTwMV20zkmdFapGhj2BgcfNuwRn2rq9N8opEY9+4L8+/H3snpjt061y1hG/lCQodudu/39K9P+DPhYeN/Hmi6O7LHbzTb7iVuBHCgLyMfQBVNdfMoRcpdDzZpyaijZ+LPhX/hEZfhnbpePJNfXsWr3VqibfJeK2jSBXz95t0hb2Dj1r558S+GIvDvi681+9Et1olkdR1mS4Yf63940UOe2X28e9fSP7RPjfTfHfiXwTqXhGGa7083t2UuJCM3X7+JI3X/AGWNuwX/AGUrw79oUSWOpWXw+DxfY9KtdCsrwoTma4kdWkDfT5uP9qvnb7ye7PpKaajGJ4d4QLeDdQ8SaLcKIL+68MXxkWNshGkiV9n1AGK0vjb8ZPD/AMRtCstJtPBWm6Hq+naTbKNWsZnJmgSBAsJQ8ejZ9q4nxZ4kCfF67v58iO7+0QuI1x8squg49BuX8q5Cyjnn1yFJAMG0W2k5zj90F/PpXmzqtXhHvY9NUYyaqS6aiwq4a2dJdixWqoSrH5lYHeMjtzg0k+pSvpdxZQ4SKWWMyAfKCVLEcD616Z8SvA58H+BNDvZU2T3um2pABGdrJnkdq8l8PQtc3VwAhkKpuOOe/wCvWorUnSkqb3ZpSqRqpzT0R3P/AAlktpo3h27guXSWysprVipxjbLx+ala4/Q7uKTXYLrV0me0nuVmlK8O6Fvm2k9+vNVtVa4tYpbRzsVGMhUrggkDI9ug4rrfCsz+O9GsvDV7cKbuL93pdxK2BHkk+ST2BJJH41PM6tRR6ouyhFs7lvHHhHwH8QrjUPCMV6NHhXfbPqYWSYnb1ZR8ud3QewNdX8OPC3gnWvhHe6hrd3rkesRWExtltRGYDcNJ8ocnnYQv16+1fNt47h/JuD5cyt5Ugx0CnBzXvGla5DpnwWubWKxjW6aYI85DByCg4+mcY9xnvXoYSp7So1JaI48RTcYe69bkngr7Eul6jcX08oXTYleGNPmGWkAbI9CM8+oHrX1B8RPiJpPiL4d+G/h/4Xnnuppwn2u8xsD2sY8wpgfw+a+M/wCzXy7rn2DwL4b8IyWupwy67qRkh1zQbm3eKe1USfIkhYY2upBHccV69+yD4JXV/i74t0uHUo/3fhmYwTI5Pll9hK5xwVJwe2Qa+ww84JK6+E+dxcLr2rex33w+8Gx22jNZC/kltrmVRLZC5KIJFzwy5+Y9cH3r1nwH8MvEV3baxpOj39lFHcWfmW0su99iklSrqOeCME+4rlv2fbDwneeE/G+lavqJtPELxOITJKuSFy2+PvuDqDx2r1j4J/GvQdd8F2s+mG3stcttyFbtz+7m6PHJxyjY6/Q9q9HFYurBShSjqvL8ThVD2lm3ueE/GabxDomn3a3Gjanpt/p4hjmmjTNoswUbWSXOCh2grn6dawvhtr2m/EfxHpct3dDwzrUrLHdW88bmG856wMoPzN/cbHPQ16J+0z8SrHUPBd3qkcJv9HjvIJLrSbmTa9lch9rRN6owcsrdOARXzxoHxs07w94ssNV0wfZ7OCRDLbPDuK4Of3i9/wDfSuf6y500m7OxvCg10ufVFp8RzpPg6DwF8R9LttOuVVja3DsGt5yWJBE3SOUdGRuDzg145438f2GjxyeHJQlx4cS8DFm/fSw7sAjP05C5xS/EX40yeKLS11i50+C80+SYozhQ9pLuBOzPrjs2Dx0rxXwboOoeNfEuoR+ErjSob14GYaZdM6JcYfI8rnBZOuOM9K8ydX2K5Y7v8zvo0ef3pov2ek6HaapevpPiO70oXZcR3G1XglIz8kydP8M12nwe8CeKtfvobvT/ABZo2lalCrIsN1E8cN3E3ykk7sZHK8dM+4rxLxR8JPG/w7sDqV5ZPdaPFMIpZbc5MbY+8Uzzxx+FcVf/ABK1bR9TjSEXv2Aodm8GJ89N6cnHYEZ5715s8byu81Y9JUHNe6z7Ov8AQfFP7O8niW38QeFrvVJNSsidDbSALm2Fw8iNH85IYKGVjjaT81eD/GS31fQm0/Utb0270OW52yw2OpINqgj50YdjnJ9xg1R0L9pvXzZR6FrWqySWtoyzadeCTebCbAPB7RtwGXopGR3FeufEz43WPxW8LWltrli8viSyiCXMcoVopgB0A6qe4PI5yD2qfbyxEGlPUaoqlJNxPnf4oeA7zStSt4rhbW3vJreK8sbyykzHNAwzG6kdPTJ549qwJ/iv4j1fxX/aHi6+l1LULhlgudRvSW8+MKE2zYHzLtA5+9xnk102o6zo7xafDCZoo9jJPFJlkUA8IoxkcenFLdeGtO16F7S1vJtVslXcsapiWMdc7c/OB0yORjvXhSg5VI2a5+56qaUHZe6bcXxF/wCFd38XhPUJj4q+Gj3z31tbQTjBJwrMjdzgDk9RjoSa9EufGOt3fhFdB8IeLJX8MauWebSi43mLOFWUfe3xkAZ9MEV87ax8MdW0bTZDagXumykSxxE5df8AaQ9PYiu+l+J3grw/oPw5Xw94XurPXtKkJ13U5my945OCnX7uMYGB3q6tdwccNXpXjJ7/AMvncdKHMpVqdSzitu/kFovif4eeKHji/wBHuvKKzrO37swuMNG5XIw2Rhj91sHjNecePfCjSXqvaSGGNTtWJ2wqc5weynPpx9K++/i3eeDfF3wyt/iR4RhsLjT4oFttX0yJVXylxhw4HOD0PccHtXyXda5epZ6pFqVhLrXhO18prfV0AdrZJCREkp6nkFc+1aYjD0qStKWj2ZjhsRLExuo2a3R5Zp2p3mgfYrqxnaLWbabLRMudyY6/7QPII9PUV7F4S+KjeDoZrzSoZm8IarHGms6bFkQ2t0c/Nbs2SjrjcjkcHK8gV514l0iGa8ElhILqwVQ0csaHzE4znjkc8enFUovEt/pl5CtxJE0LDaxWIKLtQfuSDoSPcZ/Q140oTovmpvY9WE4y92Z9F6b8StQ8L61BaawG1jRL1mez1jYIbiRTwRNG3AkUnDDrz/ECM+9/C/xZdaHr9pomkl5dLTEk2nQzloELAMZrQdUZT/rIen8SjivnbwRc6R400CTw6+Psetyb4YiwaW0v1TCPG792ACspOHQ+qCt74T+MNXuYIfD+thdJ1fQrphp1+2wSGZPv2zuOSRjKhvQ4612UcRVrpe1Sa63NKlGnB8sHZ9Gj7jv/AAWmreGZ86Ru1S7laT7fOPvJ16fwtnHIxkZrzm88Dav4d1LT7K7drYTyIv24llVfMABBVvQH73evob4C/FKb4reCoLK4e0TVIV2zGLA88f31B6e47GvSR4Fe4Lx6ji6tSFAhlAZM/wBO1d/taCunFHzFapi6c+VrY+KPiV8E9es7q5tdHurrxBFYEhrqKMGJV4IGR0bGc8mvGp9IkeDVBd3H2R9PRZ5EluAGmDPgIgxyQOv0ya/U648LQ6TYSR6ewiiY75IgMq3qMe44r5R+JXwk1TxFqepiDRpbe3mPzlbcYZAcgKQpPHFXRdKteysYqvXi7VD5+sf2hL3w3oVvpNg1/ZaDFApvbaRVYXZVicthQCrfKpGefWvMPin8QLX4k+JrrWtP0cabFd4H9mWjLthUAAj7ozk819B3/wCyx4x1GaxgOiyTwXUZUS+buAQMOgONo6cGqXxz/ZT0v4WR6Q0VzPctdcytKqxqMEZUfXpUqjTinCLSudEq7c02rvZHyXZBb2/Lx2Vz9kVwrzZUeXngZboMn1Na+kfGjW/DGi3Wh6Jqd5Fa6pB5d9b25VhI5LDZgr6Y6etelReCEvI9SsbNGt18x5LWzR8MZAfuf7RA6e44615VqPhS5gvI3MK7kOFdCEOdxOR7571z1sPhmlGdn6nTSrYmLbimjhdeuodWiRYpSlxEmHVo9rSkHAXAGMgZ5/OufSZra5SVbgRyI42tHgEYPX2r17wn4f0cX+qW2pvFbSXds0MMjyICkpdSrFjwvf5jXAa74Yj0+4eA3EEoRtweAZVh7N3qvcUVysj95KTckVfAvg5fiH4ki0mLV7DSri43FZ9TlEMXHJBcjr/Oua8UaMmg67factzBfC2neEXNuwMcu0kblPcHHFbNno9mZsTS5dtwV/MCIDjjJIPes3WND1DQrswXUX2eWSAMQGVg0bqGBGCeoI965FTm5ud/d7HQ5wUFG3vFnTPGl94d0+/sdJvJrW1vbcRXKkKS+cb+cdPQdeawoNIu57a5uYYXa2tkWSaQpgIjNtU89QTwMUx4l8sgNxtHVe/pSQyg2t1FIrtNtXy2abaqBTkgqfvcdACMe9bO7smzJJLZFVcRhipBB45HIGeDTbuRmggGDgbsE9DzTDISThRhhwTSMCsS/NknPAHSsWWFtNcQpPGjFYZlCSqP4lyDj8wKqySkHC5AHT1qeTcQApYsRzxUdyqGbKIIkIHyhi3OOTk+p5qXsUtSK9uridbfzZ3l8uIIgds7FBOFGeg68e9Ng2zRXDS3AikRAY0KE+Y2QNuR04JOT6YqUyrC8bKN5A5DjjPP6VXIMjFvu59KlruPYgYyE8E1FfTy3DRGaRpCsaopY9FAwB9BWhaXMULNvUOPeqOpIUlUlSm4bgCOx6VnONo3NIP3rFSiiiuY6CxRRRXcWFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUmAUUUVIBRRRQAUUUUAFFFFIApGpaKkBlFKRikoAKKKKTAKKKKe5AUUUVIBRRRQAjU2nHpTalgFFFFIAooooAKKKKlgFFFFIBGFJTj0ptABRRRQAUUUUAFd18GvEQ8L+L2vmtUuwLZ0McgGOSvPNcLXQeCf8AkKy/9cT/AOhLXThpOFaMkYV4qVKSZ32o3Zv72a4KLGZGztXovtUAAx1pAM8mnqua9p3k7s8hKyshcdKlU4NJsqVYyaaBksea0tMvHtJcjnNUI0wMmuj8L+HpNanAX8q66Sk5LlOao0o3lsV552uZASKs2yYIra1nwlNpHLcisuFMHmupwlGWpyqcZL3TVsYwVbc4T5SRnv7Vr2W3HvWRasyjA4yMc12XgXQbnxJqjWVnZrfXTQSukTyiMLtUktkkZwATjvXVBHLUdlcs2mxNoXPTnNek6RoUkXwJ+Kfis6g2h2Wm6UtnLdoPnm8x90kKc8M6qiZHZz615jYuyODuHPGD1qh+1f8AEC+0b4E/D/wJZSNb2Ws3N5r+o7DjzysvkQK3qF8t2x649KyxtRwo6dWGFpe0rJF34Qzal4u1/wCG+nQXSQw6Z4Xuddk81T5amBbmQZx2G/H4155+0b4zfVPH3izU7W5DyalqOnXtvIvDbDawvGV9B85rsP2avEa2nhy61aYrusPAmt2EeTy4VZWf/wAd2D8a8LuLt/EemeE9RG4yC3trWVuuHtmaL89nlV4E6jcrLsfRRgkubzOSurB7rX7+9uUPlWp83BP39zZUH86q+H9Y8jxFcXEcYA87ztgHAUSKcD8K9A+J9pDpejRyxrgahFayIVIwUWFMn/voNXmmh2bJG94wYxlGD7OeGyMfWuSSdOouX1OuLU4Pm9D6V+Nv7W1h8UPgfo3gtvDFnZ30Enm/2jEoEmEduCcdwf0ryr9n6z1oeIf7U0OMfaLO8i/0l4g8UBYlUZyRgAk4Ge9ebR7WvbVJA2wIRj1+Y5rq/Amq3Xh5/EumRztGk1kZPkkITfGyujEDg8ZAz/ereFf2taMqmyuc/wBXjQoyhS66mf8AEOSea/ee5bzri4mkDSBgS2MDJx1+vesbTbk2V6XtGkAhkEkfmcNkcjOPcVXvLmSW/RGkJVHypHbJHNaWp2qQYmR2dWXG7GM9wf5/lXJJ89SVSPQ7ILlgoSNLx7HBJ4lkubeYT29+0dwrlNuRIodhjsVbKn6VuzeIJn8JS6c1w0U0k0UIbJJYxt1/LZ+dcVcvcXWl2U8glNvat5EZMWEBJLsN/rk9PQ11viK4t1uGaASF7q1jlk8wLjepGGXHTK4z710UZPnlJdTKaXKk+ho2733iuSW61O4kvbyWUTSXdxmSZ5AuOXPJHTP4V9W/szeOvCnwb+Nmn6jrrSzW2qW0lheNswiLKq7G68g4GemM183fDCJtb8UWNjFEjxXcigLJJtRWJ559fb6V7n+1B8F9T+FKxvdwwsb2ETRyRKzKwU42r/dwu0V+kYHDUqmFlGT1kn66dj5XF1o+3jRl1M34h+LPDqa7rVnLHPbWjXtw9ncWIHnRuchU5PKH5c+nWq/hew8Y2uvWXn3IsryXBb7RGVM6lRtRsYzjAwevNeJ37q+kR2IDyy3Ekcmm3LYUEMcFGY9OTj6ivatM+I/izx94G0vWL/Rnuv8AhFoTZXup2swdzChwjvGOflPBYE8AHtXLLFxlPlkbLDuEfdNr4o6rBqL6Te+LNMn0uKItHLceaJ47iSNtuxtoG1cNkFgTmvNtS8H6Pp2uW0738x8P3RzDf6aR+7z2PXBGeRWx46+I2neOPD8/2KeO4d0LyWxkHLYGeD7Dr7V47pXil9Fllg0zUI5LKYjzbG6OY2P49x2YYNeViq8OZLc66FKXL2PVdV8A32iaTqFrqZh1Dw9+7ul1nT2dJFjYkLLJGpwyqeCwGVznoa4N/CHiDwldJd6VfSTSWzCe2ubSQk4zkMpHb3Fe6fBE6n8afDtxoHh/SYjqvhmSTUmMU283URXDQEk/6s4PygHJIrwHxrq/9heI7iHSWe20mWXzUsVYhYCeSEJ5XB7V51aK5faX0OqlO8nT6n1DqPj7xLf/ALPFhfeLotLvB4jaXybnS5la9R7fj/SYui5z1BzjtXh3h/4q2selw2msaDaaobC5DxTXGPkx1XHdSOCDxWV4W+J2o6TqcN3cW0OuWGMToUAcp33Y7j1P513/AI7034Y+JNW0WLwzqVzBda7btJNa6hb7RaXQ6RCToyuOhHQ49a4oubjrK79DsfLfRWPWT4R+Cv7SHw+nt9O0Wz8FeMIYFeC5sF27pM4wccFWPBDZxnINeD/GPwLceDbeKLwwzXtpZqqCO7bN5ZuDh4/MGN67gflbpkYqXwF/bPgHxElnFHLHN5isiKgbzcN0wRk/QV23xOgvfFXjtxb2YXVdQtPtdxYbREZXUY3qM9WAB4zyprS6UG2rMlJtpLU+YrvWJ9TvQrpLDfDG6F02tu9h3rfn8ZaTBLp0ui2d1pOqWsATUIpbjestwrHMkQwNgxj5CSc55rqte0jTPFOkxW9yrWOp2OEM0i4k3Drkjnbng9wcGvOJfB9teSyrZ3yfbxybS5JWUN+PU+9edXozjJTjK5106kbODR7p4L1rTPiPpkGmiUaZ4inLtHeWpAjmfqBLETyx9VAPqG61Jp/w01bWm8S22seC/wC0F0q1M1zquny7MKOchT/rG4OAMEEV4JpGraz4I1eO8h86xuxlCzAqJF6Fc/1FfeXwd+JlxYfBEePtZk0zUotTnfR0025vRBJO2w8She4I4b88g1OJzSGGpJ1d722vc6cLgPrFRqLPjLxT4Yn0+2ubzw/qz3uiSuI3ZGKmRf7sseRyPQ4PFdx8DJdM8PWtvf6zcpqMQul+zWjt5Y2KcuhY5Az02uMc8EGsLxXYxassniLQriO0vp3ZLvT0+YIwYgI46NkDII7Y71wceqXCXii6tV0svIqNOVb7PtPBLjBJHfjJxmuXEOnPdaNf1bsbUoypO67npnx6vLaf4i3/AIk8HaOui6HcNtGmRvvQYA3fQnqV/LNM+DPg+3+M3iKXS4ngt7cwPLd2kwLFMLhZI8c5DFQcdj3rj9P8YrZXLxRiG7hKCN1b94jKM9Cew7HgjivTPDXjPw9pHgY6Z4bSbS9Qv2LarqsuFZEDblgUrlim8K2/g5wMYFc6vRhCFDXpr+po1GtOU6unp+hlPp+ofDC21DQru3N3pt+dpSddskcgOVlik7OCOh612+j6Pr3xD8UWOnRtbjxNFaiT+15DmHU40x5KXIxlZVHAlHzY4bOM1n3njp9R0u28P+I1+3I7GRNVLbnkXGdhJBw45+bnPHBrU+GHxftvCciXNvajUVV28uVRiSFQcBhnG5SPvJ+I2mvSjShVneMuXuvMx53TjZq76Hq2gfF3xR8CfG9jq+s2N/o8IVbXUtLniDbblWyp3ngq6nKSp97BB5Br9H/A/wAZtF+I3hDSNUtr0WUt6m9IJ2wx45x/eHuP8a+dfFPxL+H/AMcf2dtL0y/tTq92AEuzbALLYDJw/wA3O1jwD0z1wa+TfiF4Y8VfB/SdGt31m81bwBDdltN17T2IltN+N9tMOsTjAIB4JGR1NFKlKadSS0ucGMcasfZydpH6aa9qd2tu7QXQwXKDa4BPpjHNc6mm6jqWZf7QcScfIJiQAO/BFfIXwk/bEv8A7ZZaB4t1VJdqhINZj4huR/CZB/A/qfXrXr1v8YNStNUunW6lktvmYbFLHgZ6gfd6c17tCPPD3LHw1fC1adRxney/E+h4/A2o69a2hl13Z9kIKvEWViM5IJB5zXgn7Zmg3gTRL2PUHuE2MixKWdAcjnJ4U+/tXL6p8Zte8i3v5LgQvLKN0Ubl4pMDkFR93PHcY49aw77463msT2lksEcDXLKr2si4L/Nj72MDPIBqoYSoqnPOWnax3RcYRShD3u92fON/Z3aXc4SWVJUYDf8ALkN3IbPOD361gah4dvbuWEQvcYkjJdpMcyAnAHP3cY+b1zX0R8QtJuEg1O/0GeGew3tA4Mcck8EueVZgdpXPG4V51e+IptP8Ot4ZmcTXEt5Hc28qRoVRQHV0bk7DuIO3PPeta9KVNrkhdXsddCpGrF807aHiV3oF5cx3MjGUMNu6M5JfnHGOoGOaqWHhibWdTsdOigcSPKEQXUm1Gz/Cx4CgnPPvX1b4D+CfiHxb4H8Q63pFvZajewSJbwJKkZDnrMGGf4VKkEGvm7VIbuExGW4hg8ydo3l/hU7sHoSQo69Kyq0bL3AoYmFSTi3seby6DJHdtGIpgVJ42EjOe3+NdNqPw6u/Cvh/RvF1xbWmo6dqPnQmzut37lwCqlwpB6fOvPUc113w58MaP4x182eqX9jY2qb3N0x2F9vO3LYHOOK4fxBqKwX91a2kjHTVmLIhLKGAzj/CuCrQrKMakbaPbud9OtRcpUmnt9xydxogg0iW7ixJt2iRmcKYiWwMDOWyAe3Fc46/vAzAuc5OT1rq01eeEXGzB85QpU5bbznjPeqU17OpIzGmFLZfAzj046+1c1RybvynRBRX2jGkgjlkcxIdnbvj6VDdwQRQW5RpGlO7zFIwF54we/Fbsur3H2aGN/LRYxuQBRubdyTkD+fSqE98jKgBY4B5Ydee3pXO5TvsbJQezM+1iZ3Yo3lMqkhjk546fjVSW3OcEEEdq9d+A03hi9+JOj2/iy4EegvJi5YA8g9q779pb4Y+Cv8AhcmleH/hvcIbC/iiQNcMQqzO2OSe3SvQpYSVelzLc8+pi40q/smul7nzDcQIEiZVfGwby5HXJ6e3196qFgoIBO2u++LPw/1D4WeMrrw1qcsM13YgKz27ZQ554P41yGm6Vea7fx2dhbSXNzKcJFEu5m+gFcFSnKnPka1OyFSNSCmnozNVF25wcUmuvvmt/wDSBc7YUG4KV2/KPl59Omfarc8bWkrwyBkdCVYEYII7VnapIZHjJ6Bdo4xwMVzTVotHRB3kilRRRXIdRYoooruLCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiioAKKKKACiiigAooooAKKKKgBD0ptOPSm0AFFFFDAKKKKSJYUUUUhBRRRQAh6U2nnpTKlgFFFFIAooooAKKKKTAKKKKkAPSm049KbQAUUUUAFFFFABXQ+CP8AkKy/9cD/AOhLXPV0Pgf/AJC0v/XA/wDoS1vR/iRMa38NnbqOwqVYycU1RzUyN8w9q91I8djlhPWrCrjjFPQjbSkCtkrGYJGzcYPviug8Na3Jo04ZTgUvhDxa3hN9SK6fZ6h9stXtf9Mi3+Vu/jT0YdjWPEwaUHAGfSt4PktJPU55rnvGS0O71TxS+rrtc84rHgjMjYBySazIWPmcECvTvgt4An+I3jKy0iCWOOWdtoL9BXfButL3jimo0YNnOWumzvnEbHCljx0HrXY+GdE0y+s74T6n/Zt7FAZbd5QdkzDrHkdCRnB9eO9elfGP4LyfCy/+xXl1GzmPcTGeo7D8a8iMjPsQ5wpIAHQV1OMYpSi73OJVfbK60LNkuwc9PWpdf0qL44ato/h/UFFvpnhLS5YI3JA+0XUzvMoPsoZRinQAHCuABjrWpp6x2NxJNBCInuCJGI/jYALu/wDHRSlTVS1yo1JU22nZnkHg4z+DrDWtDGI7xPDviNHhdcMEeFQpx7jdj6VxHwb0p9at7rRJAhRmF4kh5aHaCZCPqqDNfT/x18Bxf8L7+HniaG2ddF8aaO1lO8S/KJpY5IWGemdzLXlXwf8ACJ0r4seINNkZYlsbS7ik3cBQBHyf+Au3618vOk1Vcuh9PCopUkec/FrRby1+G3gq7ktnitvIvLIylcB5YJirD6gOn5iuf0HTYdR+F++zWWXUGuJYJIY1A5SMyKc9SCpf6bKn/tS58S+A9b0q5uZZ7nTbmW/iTlgybRFOfYjbCxPcA+lVvhRd3VzoPiHSY2jEKrDqsgcANthLI+1uv3JmyB1Arj5r1VbqrHZa0Hfoziza+XqiuxTDxrMBnjBUGtieRVuBInyNJYy27gHklCQM/wDAdv5Vd1vRLaz0ODVZHkb5PssMaLhWkSRlbLdcBNhyO7AVjmWCLxBZS3cM0lpIEeWO2cLIwZAGCkggE47isnF09DVPn1MJZ5L29MkjmSWRtzMepNXr++M1tHAxUMhIDYwcHt9O9V7GylkuwkSnzQTtXPPFPvLVwpkwSOhOKwipKDNHZyRr2/jrWoPBN94VjvSNCu7pL2a0KKVM6DCuCRkHHHHWl+1/LplyU86WOEK67jgoOMHjjjisOzt/tFwiNIsSORukkOAB610fiW/08afo62Fh9hlt7YQXn79nM86s370g/dyCBtHAx71vTbs5N7ETS0SW50XgnxUfC+v2V9bKY44ZRNEA2ScH19eMV9U/tQ/tb6b8d/h9pFrYaHLp1xYfLNOJ9+UKgEYx0yOp/rXxXp18/h2dLu4sLbUYp4pPJW5LGM5yu8BSOVPQHuOhq14b17ZJJbzEtBMpjbDEAj0NfVYLNFHlhPdXs+1zxcRl8KlRVmtYnQeCpbnxPFdeH4oVu503S28DsAWVvvKCTgEHDD8a9V/Y7+No+EHj290DXI0fSb6Q29zb3JAXIOCDnjNfPMGoXvgvxSl5atsuLdiykj5ZEOQQQeqspIPsa6bUPA7anImoeHVEltfW8l3bwM2WUJzLEP8AbTnjqVwR1ryI4icpbXlFu/od8qcdns/zPqr9vP8AZ+8C+E9M0Xx94QuYrY69cbH0eIDaxK7i6AfdxzkdD2r42TTVkwI8MGIH416z8I9H1D4tXOm6XdeIbmRtNgle1id8/ZJNylWRT16cg9RkVJ4g8GHS9afVLLS7P+2tMbff6RLGWtZeo81FyMxk8gj7p4PQZ0dP23vpaERk6a5W9S98I9X8S/BLUrXxN4NnFp4jtw3mCRS0NxG3WGVDwQfUdK8f13xPcajql2dbtDDdtKxdo1xtJYnGPxx9MV9W/Cv4n/D/AFbwu8XirTdRTXrWIAz2TRj7QwHR42I2n/aXIPoDXzh8Wr06540v57a1WC0aQGOE4beuONzDq2OM104vDqFFSov5HPh6vNWlGpGz7nLadqD2FyJbG8AUnOCcCuqu9d0/XfB2sWl48UF9aqtzYyxqSXcMAYwc8DBJ/CuNbw9L5f2qzBkhzhkP3oz/AHWH8j3rT1LQdX0nSrTUL7S1s7HVoi1tKYdokVG2sU9ORye/avHTqRi1JHpPkvoyxovxV8WaTFGLfVnSSLiGd0DSx+6uRkH3q7pvxX1yLXf7T8Q3V1rsrAAXEs5FxBgkhon/AIcEn5ehzXPPq082jQ6YX/4l8cz3CwhQdsjKFY7sZIwo4zxWfPm1kEcq+bCRkOvXFcrlJL4jVJdEev2Xiex1CS3k0+QzkNku332YnPzA8qexXkHJwak8XfDibXb+KRbQ2spO1T5gJVifut9CfqOa8ahlaF/NtJyjdPlOOPQ16B4D+MWpeGtQhF7Cmo2yspMUx+YAHsfXHTNauqq1N05aPoXSShUUnqup6t8YP2YviV8G/CnhyfxM6XekX5b7JbRXQlwSAzcEcEjBryW78LnUES3hma2Ytu8lm+Tp94DOM/rX0H+0R+0te/EXTfD0k2uLrXhSSNvslu0SLNZTKAGjlUDPQrhv8K8bvb3S9eWEpqFtBPIwUvIwG4Y7/wC1+WcetYYDCVY4flx0lKd+nbodOLr03Vvh1ZHE51bwdffZLvckWeWUYJB6/X6V7BY6lFq+iR+HdYRY9PgAPA37JMY3FuScg8c4HQVr+HtG0JrIL8RdQsbHTIcypceYrTzoFz5aKOSzYAHpnNeeaTfp9tTyZkjLcoX5D5P3T2zzj0NeiqMKEueDv5djkjUdT3JaGfqXwk1KaS5bQ2W5Nspl8pPvOmcZHvjHFYdiv2OK5W8eWw1FMKkT/L9SQe1fo5+xX4R8Ba5pfiR/EVtpouY0j2xagQphl5yU3HOOleEfFfw94Y+JOoXFnDbQafq1u7xR3tvhhIASAHHQj0Yc187h6qxuIq4elBxcOnf0Per4aOGpxqSle58532pak/hq2tJYIZUVvOW5tmIZjggDd0HX0rnPD13qsNvJJCLmQWpH3FZljBz1OMAcY5619XWvhv4M/DP4L6XpfiKLWr/4nyyTSXMEDiK2ERchMMwwV2gHcuTkkEV4Nrms3uh6bJbaTNJbafcSK94ts21pGBymcfeQHBAPRsmvQ9jJx9rdprQ8l1Eny2Nfwv8AHOfw1qVjqWjr/YeoxRlJfIPmW8+Rhg0bZG1x95OVNe/eD/jRJ4t1N9U8Oxxw6pNCsOseCrjElnqduBy1srn5iOphJ3DqhOMV8maNpMGquVh80T3CMWQlcTYO7qfu9DzXRaXZLod9Y32lQpcXNrPnybskK7/wknPVTggHg4r0qWLq09ZK6OCpQhW06ntXiDSvD8V1eaz4X06W60C7t38/Snm3T6VK3AkjOP3sYJyAeR0bHBr1b4M6T4t0vwpbXusTy6l4CuWNnBrUWd1oeAROv3ljPQ7uB9K+SNI8V6/8ONfMN0yG5U+ZInmBkYsM5yv15H1BGK+zfgT8aPFXhLT/AO0bfTbzWPDGqRQjVtFUZnsxIPlljU5LxsvKnnI4PIrtoTpSkq1J2k+jOPExrQg6U43S69T6Sj/Z8W9tCs0bqBBhHVMAd8jHUc1y+ofssWrX8M0880oQKS5jI3AH7owMZ5PJ/GvQrHxlffCHSrjUV1G5u/BUyJNbxXLlpNLzwVLNk+R0IzkxnI6dJdX/AGgZpyyyQbzGM8DgAAHdkdRgg56HNeh7XFSdmlY+JclvRnJv0MXQPhHFB4n2Je/ZtMuBKklhIi+WyuCCuMcc4I9xXFeE/wBk3RdF8d6tN41v2v8AwvaBZI7ojaspJ+7Ieoxkcit7xL8c7i3lGyZLG5eUQRllzGzAZPPQ4yOnPNXdH8f6j4y8OqdQwIRIsdxCkIfOOSxHPy9MGtnHESWkrJ6GMcRVoe9ONzyv4m+KIvhff69o3w2uZLPw+8ZeZLfLljwCwYk7cg7c4HQV8pXtm9/eJE1o8Ujzb1QruO0noMdfyySK/Q3WfBWmR+H9YvXhhtl8nKv9lHzEkdRjnPpXyFrt61n4vJeRbS3ik3krCqtHHnrjb6c98j3rthGM42vt+Jrg8Upyk4wszwW90mfetskSq+f4QMBTyNxH1yc8isLVNNmi84CFpSpKeavzLweSD6cflXoOueIrjVdQnis4IpFc/wCrW3UheehJH619GfB7RvD3iD4Ha1cX99pNtrMTyrFLJZxv5PAK7hgbu/SuT2UKjcbnr18VLCwVSUb9D4dbR9QfT5biJCsCx4Z1jIyCw749fesyLTvtqvG+YC6kpvXAYjkE59eRx3r2e3+IFol1qem6rJFFpM8LxCe206PKOrAq4jH3uR0J75ryHUNcVpWfy/nyfmCgcZ9hxXl4mnTpWV7nrYepOpfmViKXSbvUmY312Tdrbotsjpu80cBEBHC8dCfSqEulXvh+e1uLizThiyxzqHR9rYO5c8jIxjvXVeGvD+o+ILX+0bm0urXw7GXE+qLYmWJCoBK5A5bkcZ71l694q0+70CPT4Gu5ZIJB5CzouzaS284H3cgR4XnndzXDOMVHmasdMZNy5Vqc+kF3eNd3VrE222/fS+SmBEC3XjoMkD2qtLq99c3YuZ7qea5XGJXYlhjpzU+m6pcLLNCtx9lt7oCKdlU4KZzhsckcdPaobtZ7MwhlUedGJk27TlTnBOOnToeaxUml7rZta794j1+7vdTmW6vZJrmZlBaSUkk8kDk9aqaXqN1pN4l1YTS211HkrLCxDLx1BHTiptVv/tv2ZfKEIhhEbbf4jknd+vSqUyJFGjxXCs7I29cEFe2PfIrKbfM5XLilypMnjuo7gS+evmySHcZGOTmsbXbZ7WWJHXYSocD1BAIP5GrSwMU3rjis7UnDum1cAD86wqy5o6m1NWloU6KKK4TsLFFFFdxYUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUVLAKKKKQBRRRQAUUUUAFFFFSAh6U2nHpTaQBRRRQwCiiikiWFFFFJiCiiigAplPplSwCiiikAUUUUAFFFFJgFFFFSAHpTacelNoAKKKKACiiigArovAv/ACF5f+uB/wDQlrna6LwKcavKf+mB/wDQlreh/EiY1v4bPQI0zzT/AChng0yNuKk3HOcV754pMiHFSD3qNJQB0p+7IyK1I1Hr7VPbJmQVBGSDnirVvIRMmMAg8VaM2XY4GaVVUZJ4xXWeB/FeoeCNYg1KwkMNzCch1PIrmhOTOXJBcnJwKvQhlG4jj0rtpPld0clVc8eWR6V4n+J+r+PLk3Op3DXEm0jcxyawIm54OCaxbG8kgEgQgbkKnIB4/p9auxXLE4z1rsc3O1ziVJQVoo6G3uGmwWOSAACfatGEZMYDDLdBnvmsG0mbdwa2PtM08dujnKRAqgwBgFiT+vrWsWc8lqepePviFK37LOkps3T+FPFFs7bEDSNA2502n2kAFeWfD3xLofxA+MHxZ1rToDDYaz4Xur62jlXa8UsdunnLj1B3dODtzXo3wkk0/VdbtvDGsWy3ema1dxQyo3QEZKN9Q4T9a808G+H7Xwh428SXaRtEkN1qeiqgH3vPjmiQAd874yPpXj4mg1eS23PYwlVOKizxnSIJfhxpujeMYrGC+t9S0ku1vcJmOUSQtDMreoznNcVpXizTI/H+i6jp2kRWGkwWkVpPaMfM3p5ZWZmJ+8Tuc/gPSvU9N1EeJv2etI0S6GbmwW6mszjnYsqrcRn6CeNx9GryLWfhprvhTQdF1y/SCztb+V4bZXuFEspThmCZztzxk15Mk7RlFaLc9eLV5KT1exs/FDw3eeFvD9rYXSOkZuJnt5NvEicAsD3B8tSCPWuJvmE2iaXNCzh9gSXPADISBj8Dn8a6u91y58WeCtDgupGnOkmW3RjyyqTkIST93hiPTJqzo/hObUtG1jT7MytAjLciMgZIGcE/Td29a7aeDniptwW6F7VUo2l0ZwCGa0vYrqImKVCGVx2Yciuq1XQP+Ej8P32uaYI1ubMA6hpnSWJT/wAt0H8UecA91yCeDmpW8OzWRaK5h2grhi46Dgg/pWDqtm6Wl1dW08onhIWUhiC0bcZ/9lP4VNbCzoRfMty4VFNqzJPHfirQ/Een6HFo/huDQJLKxS3u3gmZ/tcyk5mIPQkHoKxZ5bfUtPluZLlLe5SNR5LIxM7A44I4BAweeuKpNFbtZoY3kafa3mKVAVSDxg55yKI9ylCAAeHUkZGa8OU5Td5dTujCMEoroRwSlgIuOowT61o3CTabp0SeRbKbki6jmRw8qqCy7CQeBkZ2kZ4BrMmlWV2dhtldyzYACjPoB05qxd6ddWS2s9zA0UV2nnQkjAkXcVyMdsgj8Kzi2jRonmf+2I1cD/SFG3ryQK734EeKrGx8RR6FruoSabpd1L5kF8vIsLoD5JtuPmB+6y9wa8+heDTGvIZo3kuQFEMkcoCxsCCScA7uOOo9ah1CQTXCzINjuMsBwN3qK6adZ05qst1uYTpqpF03sz0qx15PAfxTkv8ATrmJrQXB3y2WTGBnkoGAJXuAexx1FfVuo+GLf4haLb+INKu44ryBQ8d9DgkFu23Pzo3RlP8A9evmj4d+H7D4j2SyLDHcaxAjQ3Gnhwklyu0kSQ/9NMKTjoWGD9+r/wAEPjI3w88QzaZeXDHRJJtrNLkGMZwW2/TqK+kouMGpN+5PbyPLneV4r4o7n0d8O/2e9C+NP9pWJuBoHjTTYWkNlGu4P/dlib+OIngg8rnBrifFHwpi0m/m8O+KLRdF1gcQzsuIJ/Qhv4c/lXV3Osah4H8T2/inTpblrU3DT6frEHyEhv4l6ggjqh4Ir234j/FnwF+0R8G7yLxNbw6b44sEUWUtt8qXbEgZQ9R3JQ9McZFfZqi6Kj+754SstN0/8j5udapz3T0Pz98QeDtQ8G6tKsimMrlVkZSUkH9x/UfqK5nxJvv0jeF5n8tCHs5GLGJf9nPVe4xXtNv4zl8HXDaV4osotc8PzBod0jEZGMDLDlWQ4IPb3BrzL4j+El04C/0a7N7Yj5o5EGJYif4XA/mOD1r5vMcLThCXs+m6Pdw1WUpJT+88vWYxTId2FLcsfSrR2PGVXDD19z3HtTTt1EMYwBdgHfHjAk9x7+1Z6yyQsDztGcc8ivhJS5XbofQJX1JZLXLv5ZIbtx1qJJZ4X5OWU9G5rX0bULG3Z3vbN74tFKqxLMYgshXCSbhnO1udvQ4xVKVBdW6spCypxx3rNxvrEpPuXVlTUYVMeA65LwrwD7j1rR02ZFiEcyCWBiMkL0PTn0NcvA8kM4ZNyyJzx2r2Hwzo3hu6+GmqeJbjW7WDXI7+G0XQHhbNzGVLNIGBAAyoU9xnIrejabfdEy0OJ1TQI2j8yN90bsP3mOUOP5e1Z9hrlxpEv2a5XdDyoYf41txapHcXtwLe3eFGc7bWRvMKqTwMkfMB/e/GoL60jnWSOROMkbSOV/H19D0NXKN3zw0BOysz1HwZ4xGqaY9reX0kUm0CG9jO4xDH3ZB1ZP1H0qDUP7R8GXkLXPmJHI25J4juUKedyHoyn0ryQ3N14SuYGgbfDJGHIz7nr6Hive/2ffiL4X1S7m0TxiDNoFxbzDcQWNnKy4V8dlyecex7V24eVGpJKS5Z9zOvVqxho7x7G9e6tpfxU0M6Tq0dtD5AH2S4tmAlhfHLx55KnglenrzivF/F2jat4CvotM1mNLi2nXfb3sPMc6g9UPYjoVPIP517P8RPhd/wqvXILa21OLWfDVwTPpuq2ZWQY9CR1IB+76Hj0qjqE+g67o8fhrWruLVLLyhcQXkEo8+2kYEdOm9cYI/iGM47exicNKcOZ6S/M8yjiI8146xZ8/XIa0uEukk/0Mnbv6lSf7wrtNF1NL5kimYMxAEcznCN7MfT37VpeIvAujeCPDVncnX4tR8RNfAnSvsbCEWwGY5vMbhix42dvwrhXEtk89zApNog82aIsA0WSASo7jJ7V85Rq8kndaHrVKd0rM9UvvB6+JTDaSXUI1NITJ57HaiAZ+SR+nTGHHHIrt/2YPHrfDz4hJpHiCW6tZnb7JDcvKAIc8CGUNkGMnaQf4SAfuk15VofiK31KztbeGVJQU8tg4BbHfP95f8AZ6j1rSvZo7lBbysLbU7eMR2903Rk7RyE9V/uv1HQ8VrUoyl78H6BCtBaSXqfqH4Z8VWfiS41Hw4LiOS4tyEubaVlVl3DlSpJx6YPB7E1XvvDFjpt3cLfXKRsq+YtrHDvbCnjcPTjHNfBeifE/TdL8Zafp2jahrOjavFaWwi1PVWTfHe7MTRkrw1szYADZwOexB+3fgT+0HoHjy5k0bxgbTQvFNju0+5aRx5UqtgMo5xk4Hy569K97DV3Upe9q1uup8XmGDWGqupR0i2Zvxa0nw746fSL7SLprDXIruJ5tNnKx2pQkKzRnhQ2ACQeSBWxN4Ji1HTLSwtkMMaSGRpJRsVWxjeSOcYz+Haui+KGneHNOvntrN9PuLZYd+XsywUj+Ej19645fiW0R01rlbQQZIkBh2nYGA+Vj3HPTpXqUZRUbw/E8aoq9TlfY7XxZ4K8Q+EfCiSpdW1xaRYjjcOxEceM7mz/AKwZ7elcMfhvp3jjToZTBB/aXls5CoNr5H3OoO4HHUele86XLo3xK8RafpGkTsukLAZS5Q+nbJ/nXnHxM8P3/g3xtJa6PfWlvDCwMIl+WXO3OR7/AEqMNinOXsn8dr7HNWw1WjT9ulZXsfOOo/s8ay/i3UdN1HUtL0GyNm1zJdShY0dFHA29Q2f8a4HwH4a0zxL4isNEvPFltotneXsVk8KKQzg4HmZ+7znqTyc8CvoWGeHxnDq9r4hvNIuLhLCVo5HlUu8gGVJJGQM9a+WNct7/AETU4IJLKzjuWxMcIoXBwVZT3BHIIresrJ20fkenga86raqa2PcP2vP2P/CnwU8IWGp6Hrl9qFzeyvEIrx4tqqq7yQQBycCvjm88H3dtqNks1nHqBkh+0C2hlD5QZJ3eWcrjBJHWvs/4q+CvCuqfBfStR0q7TUfEUcCy6hAdR3iHEZLHbzgBsV8gXVzDBdhnjj3chim7C/keQa8n2HLRipyu9dX6nsYfF+3lKUFbyMnQta16w+26TYyzS2+pRm0azikfZIWIwwQHBbIGM1l+L/AniX4f3Nm+p6beaPOXMluZk2PuRuSPcGuo8Q+IdJj8QQ3WgJNZkpHshXJkjlGAdp9z0+tddd+JPBvjDwtZw+Pde8TJrlhczQGKGzWUIpxjc7kHdkHIPpWTo05pwctVtrodHtqlNxmo6PfTU8M0YRy6q0uq3dxDa3Dt9pkt4kmlOeSQrEDOfUjvSy6jb6dDcWlmizxGYsl3LFslZegyMnHrjJx61d1tdJj128TR7i6udKXJga7iSORkAz8wBwDXNtcq6HO0YOcEda8mUlTbij1EvaJMNRvXZ7Zy/mNEMgOgwp3E49/x9aqRSvNeCXKoxfcW24Vcnk4Hat7xJdaPNb6S2nRXHn/Y1F8bhQF8/c2fLwcldu3rznPasSK4jiLAgKDweKwmlzas0i3y7Fm7eNUZUAYnq2MZPqBXMX4IZMnPWtR5nbPHHaqeuwrBNAqxzRkxKzecACWIBJGP4fTvXPWfMro3pKzM2iiiuI6yxRRRXcWFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFQAUUUUAFFFFABRRRQAUUUVICHpTacelNpAFFFFDAKKKKSJYUUUUhBRRRQAGmU89KZUsAooopAFFFFABRRRSYBRRRUgB6U2nHpTaACiiigAooooAK6LwN/yF5f+uB/9CWudrpPAS7tYmH/AEwb/wBCWt6P8SJjW/hs71BjvU8Yzx61CkZPtUyLsI5r6BHise0VKgxU6srKMmkyu72rVJGVx8KFunSp4l2yDPrS280ada05LSzWG2lS6DSP96PaRt/HvW0Y32MpSsQKT5pPvWkJd0YGfwqpMka3DKJFdQcBlHB96vQonlZzz2reCsYSJrUn5hj+GrsTkAcVXso0ZZWaVVwmRnPzHPQYqzEBkcjFdEdjBmpZM2c9BW7aNnaD6f1rCtcZA3Ctm3Eam3xOjF1ywwR5ZyeCf149a6YnJM6LR9Ql0zU7S/gKrPbyrMh6YZSCP5V3smm6frWkeC9XkkSz83xBZ2+qXWAFimjuPOt5X/2XG+In/aHpXmsUwc5+XjjGK7PwXLYara6p4b1cGbSdWgMUsYPJI5BX/aHOPetnFTi0+pyucqclNdGeb+MvhVd+Cda1WGa1kg0qz8Su0UmzCfZb5HtpBn/ZdIjj6GvH/wBod746doukX8Ygm0xQVVk2spLskij1GQp/Ovrn4d2zfFybxx8MfEs89vrWl2iadLcBsGRNqC2uhnqN0UDH3Y+tfL/7XVtqF1L4L8S6lBs1K5ja01GF+PLvrciK4T2BdN/0evmaiUKc4o+poy5qkG/60PMPA0cN7JPZCFpJJ5UAjHJ3E4xgdfnxj2evrX9lj4f6JffETTrfX7T/AEO+DRbZjsPy/Kw9sZAPvXyN4N0LWdW8WwaboVtNcarfbxHFCQrKQC24MSMbdmc54xmuxtfiDqOlWUN+k0wv1l8xrgyHJySJPqSdrZ9d1etlOJVJOnLTzObMaE66ag9z6g/br+GHhTwF4rtF0C2itrVoVVljfdzXxLrhh0jWEf8A11lcRlJAP4kYc49x/MV2Hjvx5q/j1LUS3E97d7xDjcSWJPGPrn9K5LTIV8W2h0/ckN5G/mW7uCRkffj4/wC+h9DXZmFanUpxoRfNJJa92LAUJ0ILnf8AwDidV02TRtRmt2O+Ph45QCBIh5Vh7EGppV+12xkiCsYeoXp9Pp1qLX5pDfPAZJmS2Hlokx+5zllA7DcTiprItYSRuV3I4yQOCw6n/EV8Bb35LofTfZTM6Yq8kZyDu44GPof8+lTx5Qsrc9gG6fQ1parokW7T54JNkN4xMcboVOM43AngrnI4OQQQfe/4T0nSdT8a6VpniDVP7B0madIrvUfJMv2eIn5n2j7xFONN63CU7anJFlZpi5bfj5eM857/AIZp6HzYsHt+dXNes7SHXNRi0u5kvtOimdYbh02NJGGIVyvbIwcdqo2yolwgk3bD124Bz26++K51eLZpo0ma3hTxHdeE9fs9Vs2KXFtIHABxuHcZ9xkV6p8UNK0PxZfQ3WnXEcWoX9ut7bTcBbgMMlXx91wcq3owJ6MMeMOxDEfxKcEA5/KhLt4ymJGUo4dSpwQfUHtXo0cX7GnKk1eLOadDnmqidmj6R+Cnxpv7zwNffDPVrxY9OvXUW0twcC2nVsqd38I6g/Wud1GXUdBmTZf3FzFDNukjLDerK2PlJ7+x4NU/+FTXHiDSbjxDomsQ3c/2X7ZHbpBsa4VcBmXacbwQQw6hh6MCebtvG1zrqyz3rmW+Rf3xc8yAcbseuOtfQUsbXoU4xm2r7NPc872NOcpOC9Uev2PiHUz4d1TWNLsodZ8P3MYh1SFFVnTByG2N80bjuO46EivO9S0q21TT/P0Wd3VvnEODyO6jH6qfwpINavfDWpx+IfD159nuCg86EANHKpByrp0ZeDkGtkXejeNXXUdBjj0XxIq7p9CZgtveHu0DHox/unntz1rOrinUuqmrLhRUdYnjeqWDw3jp5ZtbmM8xk9/UGlghTWw2QBfICSnTzPce/tXpfiC20vxnZSYX+z9ShGGypUo/Ta6nnOeK80u9NuLW+8iUG3v4+UbOBKO2D6/zr56vS9m+Zapno0586t1Mw77c4bOP5GrVnmWUqPmLY2gdz0rchhj8Twsdvl6lEv76MjHmAfxAevr+dc9dW8mn3bRgNjOVHeuVxcLSWxsnfTqb2jfabC/a6t82uo2T4+dAdpDdwcg4I6GjxNqWq+KNWvdUv5UN7cv50hghWFGbocIgCjp2FZkOqvDevKWDmcAuW5Oe+feup8qK/LRx5w0QeMsOW9R/hWsaVOr7yWuxEqk4Llexx0Wp3CyxCVy4ibhScEfQ12FhKviFVhhfZegFonHfjJU+v0rldZtDbuCQSH6N3H1qvpl3JZ30LrIUZWB3DnH+NQpujLllsNx51dG1quuC51LyrixSyWKNLdo1JI3KMFjnnk5PtmqV3YJDZedbMxDyEbh024GBn65rrfiu2geJPFt9eeFWc6XHHFHE0qsHl2oAzsG5BLZ4PbFcNbXUlnJjHy5wyN0qHLns5LRl25XZHVeFvG2taJaLbSvPc6QWDNCH+7juucgH8KoN4p1I6lc3xO8zyecfLGCD7YosryMHfDu2AAujj7v+Iq3c6aylLvTv3iH/AFlvkZ46kV3OVSUElNtI5koRk3y7mtr3i278V6No6IPLvLESI8krA+ZGxDKpHfB3H8axW1t7gbLm2kFwqlh5eCG/A0lvc299H5ikpIpGRnGR/dIqzp81qtyI9RaSOFsjzkAzH6HHfHXH1olzTfM2UrR0sczp+qvp92JI8rliWXt17V7L4e1TRfHfhU6TdR2thqkcrzwapFH+9dygVYpTnmH5eMDKk55HFeb+JvDiwXDyxkeS4DJKvKEkev1zzWfaJPocEV2txtmaQr5Kg7lAAIYnpg5xx6GsKc3RfLUV0W0pax3PafCF3bXV1FoXjG1e2lhwkF4yYlQdhk8MBxj1GOfukdb41+Hmq6BqdlfR3qf2U0W99UCM8M0RYJE8hHRQ3yF8fLkbsdvJf+E2g1uDRrjVbAytp0ga4O4xyXdqSBs3/wCyQdp7Z9sV6TqHx412WLTP+Ecs7W70G3aUT2VrZKs8nmYBMqDI5VVyFGzcCcfNXqU6tPkck7tbPqcNSnNzSa0e56N4a/aZ8UeBHfw14vs5b2yhjCDziGurdOxjkIIljx0zyB0Ne1aB8QfDfjSNdT0uaG8tEVgkMjs8kDHoHG4Z79h+NfPnh7VfB/j3RFGsGa40CKIp59oubzRH7Nt6vBngrzt6crjHnV34T8SeANbstR0W+Dxzxma1vrUMkd3EWIG5SOpAztPYg+9dv1t8vOtV+KOD6lFS5UrP8GfoZ8FfiYPD/wAQbGA6jaWdlvMc13KMEo3XnPJzXO/Hn4/6heePLm3gubPU7W1uGhgvFt8gKGGOfXIH5HFfNXhL4mr4mhWx1lX0G/ihlPlm3P8ApUuONhbA9OM8DpmrlogudQto7zU0hiZ0Uu4IUDJyWIB6Z64JpKrFVfbRl0sYvCxlH2c49e50OkFfHWsQWmnR6bbatNC4jEzMkEr/ADF3eRmwhAGc9OmK8y1TXbrVtSgsXjgkui5QxBWG1s4UA85B7Y9hXTadJI8EtjZ3RktZZCrYXAZiMDqBzjoa9M1nwxrOn/Ap7d9CtLyyeVbj+0kiX7fa7W/iYD7h5wc8VvGv7f4b3XloYTpLCtXtZ6b6nB+O/wBovUfEekW+m22h2Xh5VgS2aezQRPNHt2OGJXO1sdAfXrXL6Z4H1Pxf4c8QeLtKkWK20qBWcPBiMOVGUySQQMfjnpVKTRtI1PTNWlvta+zNZxR/ZoJH3NOd4BRDt7AsSOB1q74IS21WzvPDZ8Qy6JoeoEtO7uUikeNSyK5APfAzjqRSWIjzcszT6pKEf3Ctr1OL+Cvgux+KHxC0fw1f6uuiWt4+H1CWMKYWUFgFYnuRgcioPix4etvA3jrV/DsWojXrWwvHX7WG4nJwWbI5yemc1UttOSzd2aWVZ43IBMmfmzjg89q3Ne8MXnhvw3pGtPbulvrQuDDdGUM0qKQjggdBnPB5rz3Ui4SstUeiqM1WUnL3WtvM82XRWYmUQApICUXcePQ/h703xBZxXN7Jc2OnnT4Y0jHk+cZMMFALBm55YFsds4r7Z/Yn+BPhP4vya0mv273EFtCjRxRT7WQliDk471xf7aXwe8N/Cj4gxaV4ehmisvsccxjlkLsGYnJz6cCvh1n9D6+8vcXzb+R9d/ZMnT54y1tex8eXJMs++ZiSxy5PLHJ5P1qKC4/sy+8+A7jGx8szRhsjkZKnIzg10Gv6Tbr5DxGUysreYp4C8/Lg+45rMi02Iq4d9pCFhuYD/wDWfavf9ojxXSl1MrO6M4BOOmB2rN1iaWeSJpXLttABY5wABgV0EVosf3HYbhg8jms7xZpsOnNZiK4W4Mke9gv8BIHyn3GcVE5pqxUYNO5gUUUVzmxYoooruLCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKQBRRRUgFFFFABRRRQAUUUUAFFFJ0qAA9KbQTmigAooopMAooopolhRRRUiCiiigBD0ptOPSm1LAKKKKQBRRRQAUUUUmAUUUVIAelNpx6U2gAooooAKKKKACum+HxxrM3/Xu3/oS1zNdN8P/APkMz/8AXu3/AKEtdFD+LExrfw2eghsU4HPamLzT1r6FXPEYuSOKctKq7ugp+0j1qkSOQ471Zt3JkUE8DpVdI2POKsQRnzQen0rRGbLuSZDzV0l49qkAZUMOc8GqCxsZTngVdhj2oBwSe/cVvEwdjRssy5AwMirwXyjtODjjg1Tt0wpxxxVu3XJUdc9s4rqiczLtvLt4H1rRt5AWj3NtHc4zjmslGGBxggdR3rRthu256YreJzyRv2cqeYoLYjzjdjt64raj8uERSRTh3JbhQQVweD+NYVssaovrV+2bBXnjNdEXY5JpM6TRNWaz+NXgvxR9pe1k1W2l8J6vcKOiyRkWs7f7rBVJ7bRXnX7Quja74y+BDa5qcEV5qllrKvrMu0rLa3kRks7hgBxtlMUDNno2CPvV3ekX50zULO6EYl8mVZDE/wB1wDyp9iMj8a6n4t6MLv4efEybw9ayXFjrej2mrXljG++SLcDFLOo74aCB2HciQ968jF0bS5lsz1sHX91Q6x29D4N8V2UmjaxZ3EAkitTviDBip6ZIyPxrc8Ia21npdxBbyqLiNZYZFeJZC1tINshUMDgqGzkcgMcYxXReLEsNUgGlyadMl/8AYbXVbOVJMpIGiTzcqefvB+nr7VxWgXes+BvEv2vTZzp+pTWstvDPtBPTbIMEHh422n1Ga8/WlUutj2U1ONnuS6ZpMljdanptysa74zGlw7YUgjAAHqSFIPt71kPYf2HrcEkEwt4rkr5cuf8AVSg/KT7Z4+ma7/RNCbxv4Ev76EtJf2EYhnjK4ZWVT19vkXB968/v5k8UeH4TaRTG8+bzQ4GHKc5QDvjOc/1rapaMVb1REJczd+mjMT4i26xeLJZUjeB5wsksEi4MUh4dfoDnHsRWhDoSXPh2OYOI5I0DKWzjdxwfzqPxH4jj8SaHpFve26Lqlm/ktqhc7pYOAiyDuU5w3XGAegrsBoM0Wj3WlToq6haxlW8lg6uVHOCODkbT9DmuKnRjUq1GtmrnTKcoQijyedblJUDiRAjtsRgdo55x/XFatxbXGuaVNcrbyyfZFXzZVTIjycLuPoegJ71Tury68y3innkkhhJEccjEiMk5OB2yRzU+DCXZHZEmGxsE4+h9q4IRWq6HXJ7MzdJJW737ijIM5H3h9PX6Vc1SzjdDPGFRscqvCn3Hp9KbK6CWACARTxkiTaT8/uefw4q1LEGC4+eHqRnketTGHuuA3LW5zwGAecUDMmcKSRycCrN5aG2u5YjyOqn1HapI7ufSYibWdo2uYmjlC45Qnp+OK5eSztI2v2Ol8HePdY8EwILWZo1W5S6h2t88Eg4LqOnzL8rA8MMZ6CvRviR4AtfFnhdPif4MWKSzkwNd021XB025PG/b1ETnkdgSRXhAZnYDJOenevRvhF8VZ/hnrEqsTc6LqcDWep2uDzC/yuPfjnHfHYgGvSw+IhJexq/B37PucVelJP2tL4vzRgWGsBEGCFI/Ej1FSXjQvLuBwjqGDYxsb2/GrXxJ8HJ4O8QuLK5gu9FvALiyvLZzIjxNyOSAfYg8jBHauctrwtGYnPzKcgms5zlCTpz6FxSnFTidDc63qEpSa+leWdMKmoqN0mB/DKP4xjuefc0Xup2PiOyjgupFiuuiORjafY+h9Kz9P1N9OnEiqJY84aNhkMKsazpNteWhvdNjBjJ3yJuyY/Yj+tNJuLcdfILpNX+8wmnutLv0ZnaC7gbKTqeeOh9xXQ+Jr2HxLBFqtpAlneRxoLu2jGFEg48xB/dbrjsc+1cs0jGPZJl414w3VPoaW2uZtPlSWNuOnPQj0rhjU5bx6M6XG9n1N2Gyg8UxPJGwgvwMMnQOe/51AF1HQJ4jKjukeVIA6etZBuzaXYngITPOAc/ga9H8I+MrXUI5rSdURpVwY3GQT6g+tb0nCpK17SMp3itroy7mwh1fSvMSRWkKiRVQgnB9fQ5Fcte2CxomWSCQLkj5iX9+nFe6ad8K7Xxqv2TSPI0jWTE80E7SbIrgKMlfTJHY+leJa+1xa6j9nvLZra4iG1wTxn1HtXTi4WSlNfMzovW0ShaXrRt/rDFJjHmDv7N61eubd72QbwIrnaCCTww7Vd0yPR9VQQ3jvBckYWWPHX3Heu20vwB4k8GfD/WPGkemaZq/hvzRpjXdwBJJbSOMrJGM5Rh03e/SuCpB04KV7pnTBqcmtmjyz57ecpNlHB+9W5p+rGGRQWMZAAVlPH+TVVIYtYDBWy/JA6MPwqi8cun/ACyDIJK/MOKcXKn7y2JaU9Hud3deA9X1/wAO3fibT9Muja2jpDd3MURMAZvukuOAT6V0usat4XvfhToWj2Hh+SDxLbSST6jrE8okNweiLGuMBB/dOTn61yOh/EfX9H8JT+H9P1e5TRLiQXNzp3mkRu4GASvqBnmum1rw9caHFpX2kLDPqFnFeQAk4dZBwGPZuP5VpQqtykptK+y8v8y6tJcilBPTc5nw/rZAMF3HFc2+SGts4IH95D2+nSrfiXwhHo/h/T9U06/h1awvQ5ntIwRLZMrABZAfuk5yD0NLf2S3qwW11B9iv0YyJPGgBbt1HB6dKk0W5vtMuGjldY7ly0THZmKaP0I6EH0/Lmt503JKLMISS1MC50mbVtKtruO4eSGLdbRRPJl4wvzFduflHzZHY5OK2fhzNaaFrlhqOs3k1nYxu432rsskjqBgZQhoz8wIbp8v1rf1Dwjp+u2Ed7pc40y/SYRSWxfLKcZBXoWU4OO46HNc419b21zdWWowL5k4EDTqNsM2DnPIyrZwc1xWvtozsa5HrqjrLq0vtH1M+I7C/ka5aXz49atkIhkYtnFyo/1ZJ/j+6c8+teo23xCsbK8Gk3GnXun6tNAkWpeHr2QtapKPmE1owJ+R879o+6TlTgkV4P4X8Yap8OtTWW0meaxDbJIXGQAeqsDwQR2PBr261vPBnxKtrTUrq21RLGwjaNbTRpQt9pjFSVe3Zv8AWwhhu8liGUZCNjit07S54aNGejjys9GEVp4h0IWkJN9bW0izLZXqhmQumMHHX1BHDDkc5AqR+Ebq7khjWEhWdRukDEKDxz3IH4mvH01XV/AFzpelatNb2Uk9slzZa5az+eksb8gOynBXsyHlWGeDk19e/CP9pDRtD+EVxN408GJe3/2g29triMBbyMu3O5vvKQGUnqDuBzzmuGrjKsV7SnqzthgqVV8stDxCz0BtP1111CwunsICRLdWmSuMkB1OOmecHGcY4rttI+O/izwD4bvbOzmi1WwvrWSzzc4k8hTld23qrEdmyOe+K9D1DxO+sfD+/vdIsJItPM+2+khiXaHJLqPM/iznIUn+leSabolpfaqgYOvmtkiRQo+hHIwayoZvVSbqKxricio1OWMfePItWsdOlvHNtFcixbbtlkCiXnAZio44O7A9MZrP+Imn6ZJf6vfeF7XUP7AtpI44Z7tcSIpXAEgBIBZgx619vfHn9kbw38P/AIbWGv2OqTzXl2UJilQKoDJuO0rzx718zatqdw3w7XwaINIhtJLwXbXi22Lhm5ASSTqyjOQO2K2w+cUsRFyiefVyucEpxd0eMeGliurW6u78OIbVQ2y3dFlckgYAbr15wPeqcuqNqz20Ib7HbrlcyTMUz1LEdB2HA9K6S48FjTbpZILmM4BUSKGU9Mcj3rodS+C8enfDLTPF7ahH5V5fS2Is1DFgyKpZ8kdDuH0966VilblvozH6tJO9jG8D/EDVvDULtpd9cWLOAjG2lKlsc84PNZnjzxfqfieb7Zf31xeSYCeZNIzE+2TVO70y4lne9ExafAUmP5e20dPYYNZD6VJIFLzYznIKniuRYei6ntla53PGV40vYu9iPU7uTxT/AGDYQW8NvPb2wsxIWEYmPmOwd2OBn5wMk9AKwGsJVuJISA0yPs8sHJY5xgY611et+ENR07TNNurpCLW6jZrcqQ/y7jnIHTJ5wa5+6swFHLAgcfLiu+UlJ3PLS5dDJHUiQ8Akbcc1n6uPnhIAAKcYP8/etRoCQck5NVfE+mXWmS2guofJM0Cyx8Y3IQCD+IrOfwsuPxGLRRRXKdJYoooruLCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooopAFFFFSAUUUUAFFFFABRRRQAUUUUmAUjUtNPWpASiiigAooopdRBRRRTZIUUUVIBRRQTigBGptFFSwCiiikAUUUUAFFFFSwCiiikAjGkoPWigAooooAKKKKACun+Hv/Ian/692/8AQlrmK6j4d/8AIan/AOvdv/Qlrow/8WJhX/hs79T81PBwaQrzSqM19CjxLk8JqdEZmwKrodo6VNFcEP8AdzWq8zNnp+m/ArxfqHgZ/FUOkStoqqSbkfdwDzXBx20iygbRkHvXvvh79rrVdG+CU3w/TTrd7SWFojOfvgE5rweK8M1wG2jmuppM4IOo2+ZFi7DzXUkvkxRbjnZGMKvsBUtrbuV5AqGS4Jkb5RU8VyygYAprct3salqZbaOUCONvMQqSy5I5ByPQ+/1pqllxkDH0qCK8kfI46U9J3cjIrdeRkzRgbBHAGexFasF0TJbZhiZYxjbtxv5J+b1PbPpWLE7cHj2rSt2YBT7f1rVaGMlc00kJJPABPQdq19MuPIuIJGjSZUYMY3GVYZ6GsiwvDaXEcxiSbac+XKuVP1Herlo5Z1479K1iznnHQ2zOrYcIqBsnapPy89K674c+OZvCvjXRb8wjULWOObTrqzk5S5tJiC0RH+8Mj3Y1wZmBjQBcNzk+tXbIEyxg4zIAVYN9056n0qpwVVcr2MoydN8yMz9sTwn4b8M22g33hKJo59A23VqhGRe6RMfkdW/i2E+W69VKtmvD/iZpdpeaVp2p2d7K19FFCLJDHkPjDRBm7BomYD3jIr2v4mSpdjQ7TUkkMemavqNm7RDeUS7tYrtU2jrG5FyMDvyK8c8V2y+EPCt7oU92uoTWU1tcaeYULG4sGbzlkV+mY9zDHo59K8LpKL/qx9LC3uNf1c1/hfdnQPH3hTULhGh8LeOQdMuCeEjnDBCOf7jlc+zn1ryCyjn8H+ONZ075oZLO/lRURskNHIwJU9Nwxn3wR0NdJ4+h1GwhtYrKX+0PDsxXV1ii+YISAruvoWGM49BnpWS9qvif4dNe2rP/AGppczSSDPzlScrIfU44P0qakm3yreOq/X/M3pxSXM9np/kYXiG3ttTvrgwRfZ5+rQwphN/TK+isOQOx4qKKG/8ADc4/ePG0fzoysfmUjqPcDn6ZrU0W4TWxBNIClyimOZRwWU9h/MHsRWxrF2BZW8ZlVrq1AaKfyxidQeuOzDkFf6GslTU06i0N3Nx9wxpPCenax4V1TXp9TS0u7eRYY9NjgaR5nPOd33VQDnJOeQMVkeCtUs7XWLCS+s1vorSdJJrORiouo1YFkz2yBjNdx4O+zxwXBaLOmSvsu4W/gjJwko9lJwfQEelcB428Py+E/EssDlljSUsjofmwenNZ1qbpxjXivX/MKclOUqTfoXvib4o0vxV471XUNI0hdB0y6uDJa2CYIt1J+5nuB61mRTSJbI0McIeOUs023Mh6DB5xgYz065qprSme3hlaJVdV+dkH3uep9/pVLTbySxmPJaMfeQ9wa8+VS1X39mdcYLkSj0LF5dLcXUgkQRzLwrR/d9+PTv7U/WIdtta2wsoopbdC0txGSXmDHI3c4+UcDAHFRXy+btuoT0POOwrV0KS31JxbXEkcHy7RJK2xTzwM/wCcfSsuXnk4vqXeyTRyykoevBp7kg/3Seoxitzx74VuvBXie70e+jEV3bEBwpyDkAqw9QQQQe4NZETie2aNxmRPuMfTuK5HBxk4M2UlJKS2Nvw94sWzsn0vVITf6RISREDiSBj/ABxnsfUdD+tO1zwldaNFa30YafSboB7a+VcoR/dPow7g1zLKR049q6zwX47k8OxzadfQnUdBu8C5smP/AI+h7MP1/Wt6VSM/3dV6dH2/4BnOLj71NfLuYUUxLFScGtPS7+a1ZnhdkdRg4P8ATuK0/E/g+GGz/trQZzqOgs2POA/eWrn+CVf4fY9DXMW9yUlwTjNa2lQmk/vI92pG6OgudLj1qE3NoixXQH7y3B+V/df8K54p5IKsC0LHv/Ca2dH1CSzvNynJ3A59Rmuo1Twot9Yvq2mKLlJATcWvV1/2h649a6fq/wBYjzw3W5mqvs3aWxwVto0l5P5URyxBZT647VQdXt5dpBjkU/Qg10ekXVzoN4L23iFxbxHBypwVPBU+n+Ndi/hbTPihcsvh5/I1vyty6bPxJO46pH2Y45HToa444dVItQdpLobyqcj12MbwR8Q9S0NXEkS39qrAvC7YZgeOO/5e1dtrI8N/EW222dw1vqZO37FeqElX6N0b0459RXjV5ZXWjXkltdQvb3MLFWjkUhlIPKkGtmHWbfW444NT+WRAEjvVHzxgdNx6sB69R71tSxM4p0qmvqZypRb54/gXbrwmbS4Gn3yfZZ42JV8YD+xPY1uaf4F8TX+mtpGk3c15Z3jq8mnecUVmHKvj7px6mqWo3XiDR9MgaSUavp0oPl3G3eeOMbqt+F/ipLpN3DMo+zMrDO05+vB/l0q0qClyzuhNztpqcRf6Nc6VetE8cttcRMVZGGGVhT21gToIL+LzgekqjDA+vvXr3xB1TQ/iDpkN1BJaW2prHhltgQ7kc5IJ5J9uK8MkVlcrIrEqcEHqK568PYy/du6ZpTfOryWpYVhDNuhYso6EjB/GvX/Enxrv/i7o/hvSfFk8XnaJY/2fZ3SQhCYt2RvI+8Rxz7V45DaPMN0J3AdQDyPwqa7aeUwpIWzGgRQRjArkjL2dRVHG9jp1lBwTtc9I1O8uo9Oh0TUx5tnA7NDc7vnTdg9R2yMg+/NVrdbjS4li1VftGnSD91dIckfX3rG0G9uY7iGC5cyWxwpjmGcD2NfohpPwB+FqfsrHxM0cE+vHRZLgRT32VMozj5M+3SvHzPP6eXyheLfM7Hs4PKPrNNyk7HwdaPNb2N3Nbyx3tssqqXL5aMH7pbPQHp9as6nBZeJ9IjQwrBdocGUNkSA+o9j3/OsK9SKK+ujpMy24K5ezklwHAPRSeGx6Hn61W0fVVW+LRsYnjfJtnHBPqAf5V7dOvGtDY8upRdCfK3oW9c8P/wBi2VgtrLc6kDbFr5XiwIH3H5Vx95Nu3n1J6Vb0m21Twpp+neJbcZ0i4uDDHKXyDImC6uoO7AyPm9+ua9E8f+P5fG3iOPUtD01NL0aOCOGPRbZVVICI1EjJj+84JwfWuX1Twqt3aPrnhYMqwlVubADewBBy230yCCvuKmMasYKb92XYc1T53GGqOgvdasfHFvco1oluA/myQliFZu7pxkN7jqOoNetfEG68AQ6L4E0nwHa3n2e10wve3euShnkuGJztQHEZXBAYcOMcYBr5lsPEFjpkU8n2aa8lmt3WG2WTYttLkFZYyM7gMNlCO/Wu18P+JP7Zm/tSG9NiY1RIo5IWZJygGYt31wcHpkc5Gaia9rB6WaLhLlmrvRns3gj9ojXPC3hrW/Clhf2N74RnH2h4XtPNFvIQFMid1UcZU52EZGRXR6TqEp0R7jzbG4Wyuk8wom9nWRMqfMz8y/LwO2a4DQPhpH8RNG1PQ9G8RN4e8UXtzDcT+H5YWVJbhWcIjyMqiORQxOAdrBh0NPHg/wAQ/AvxbdeDvH3k6RdzQJdLaRyB0ueojkjK5HPzAoceo9K8qE6MJOm1q9+56c1WlapGWx7v4n/aIl8WeBmsdavLy+ubCWJ7eKdEazWIEKyPsVXBI4BBryx9GOq67ZXyTWVlpWGUgztaQytsZgS77ir9OO/y+tZFks72eoTCzaaC5iIUqpCA7hgke3PHY4qDSbG9uYNRiuRLIIYfMgDtiNBuBIYY5yOAOOfyq1Sp0b+zskS51a8VGaPO5dR1S9vmtbcvezzfIqRKS7HOflA78flmrWu+JbyLR5dIt9WuLvTYbgMqSptRn25LYz8p7Y79a7ubXdE1b4hy65qmgRW9obU+bZaezWsSziPaHXacgFsZAPckelcNfeDtR0+1iv7iyeC2nkLQeZEWinI/hVuhAz611wxC5ktjinhZcrk9TlhqtxaaihaS2kVF8wb8ujZHQjv9PUVkDUZvJjcPOIw2NzEEbscj+Vdh4UstPvfFaXOrQrc6dBMtzeWxYQLNAjDeg24wTnA2+9R3+l2EMWsPLZ3cNi92/wDZgAzGzhxuQuOCfLZeRnoOOa6lNc1rHC4S5b3MDxJ4g1C+s9PtjcLJa20A8tBleNzckZ+9nOT6YrmhcSmOaIp5jSY2uWOY8HPHOOenNdBdaebGFXeFAZE2bjnJOeSOfwrMuLJUtAyv50pG9lQn92MkFWBHJ6HIPQ1rzx6GHJJbmZEbmWVI4kaWVyERFyWYngAAdazfFd3e3Nxbi+kd5IoxGquc7FUBQuO2MdK1iHQKVLIVOQwOCD7GsLxArCWLcSzEEknOT0pTelkOMdbmVRRRXObFiiiiu0sKKKKYBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRUsAooopAFFFFABRRRQAUUUUAFFFFSAUw9aVjSUgCiiigAooopITCiiihkhRRRSAKRulLSN0oAbRRRUAFFFFABRRRQAUUUVIBQTgUU09aQBRRRQAUUUUAFFFFABXUfDsZ1qf/AK92/wDQlrl66n4dDOtz/wDXu3/oS10Yf+LExrfw2eiKBnFP4FR4OacuScV9GeAx6jk09Uw3HeiJNx6VYEBHPQVfQlsdGdoFWbKQJMGCg/7wzVYdeKmhyGWrRky5JIDLjAx61dhjt5LKaQ3BS4RlEcOwkODnJz2xx9c1mupV/Wp1yBwK2i3cho1LAQ7ZDKzqQh2bRnLe/tUihQQRmqds/Bye1WFkwBW6ZhJGjbGNnG4nb7DmtZntlit/Jdy5T95vXADZPA9RjFYNucnI9OlaDfIkTBlJwfl7jmtkzFrU04pEfOWO7tgVq6a0Qlj80sEz8xUZIHtWDazKGBIAPrWvHIqzFVcSKG4cDAI9cGtYMxmjUkYFQIySvuOtbWnaLd3Vg1zFbSPBDw8iocL9TTvBXhhvE900LSJbrEhcs3Vq9O8My6uvw/8AE0OlajaWOn26g3STOA8x5GE4rrUXbmZ5datyvlW55zb/AGRb+ynniS7jhuY5mUjYGKH5T9QCf19a8fs9IsvHWs+IPB+hyr/wkHhS9uLnw9Hd8SXlisjF7XH8TRHOF6tGxx0xXq0P7y3CnJfJGK8L+KHhS70b40+GfFNncS6eL67iH2q3OGiulXAYH3KqT6815mOUo8tSC62fzPay+ablTm91p8itDpiJqCxaZGbjSpVadLBlImsVY4ljP95UcEHHI6965S7sdU+EPxNlzp3mW93aC5a0u4z5U8EgIPH8SkEkMPYivedf+yeJGTxDPENM1UF5bya1Qjy7hCFknCj+JfkMi/xRsjjlTWJ8Zfh7qUFt4Z8alft2kyIdPubZZfNa2I+YiMZ5j+bzFA/hY44zjOdJOGm6Z3U6yU7PZngXhaz+3WP22xXbcREh48ZDL0yf8+9dpb+EfC2t/DjVdU1LW7i21tryK307To4soXAzK0r9FOMbf72PTpz/AITRNKvNcsLOTbqFjdu6xy/6uSA9cjqe2fY57UeIUNjH9tiiJsL0iK5h3Y8llbr9VOSD/Q1zU+VUrtX7nZO7nZO3YpeDvFVx4S11o7wRG8hPmJNLEHjkHqynhl7EHgjOe9J4yuR41065l2R/brUnfHEgG0Dpgf3cce1c7qswnntwzr9picxBSeWB9PVT2+uKo6bE9trcqefLaSbiY2UnC+h56jHH0rj9u1H2W8XodapLm9otGVdLvoxbbZ9rR4III+7T7vTFSWOSKIyW7KQxA4APfIrYvtNh07SHs7u2zcNIXEwAABPcexGOO2MjrWNpOsXGizKud1s3yujcjHfiuFxUUoVdjoTu3KBmxF7G5eBgGRuMHuKmvLBQrGFsxAbuDnYfT6e9LrPl3UiSQgKP7ncfT2qpmawndQSCOcHuDXDJcrcXqu50LVJrcR5JLmPzJXaRh8pZyScAYHJ9qrq3lyg5xjuO9bF1qf8AbT3Et5OFuHTJkkGAzKAAPlHXAx0rEboK552TTTuaR1JZ02OGxnPP1ps8RjIPBVhkEGljkJXyyAQenqPpTVQs4X14H1qHZjtY1/Cfi/UvBuqLe6dMqsRslhlQPDOh6pIh4ZT6H+damr2+meKJZb/Q4Bp1ycvJpO/cFPcwseWX/ZPI965AjDHNKjGN1ZSVIOQR1FaQrOMeSWsfy9CXBN8y3Na0uFfEcreXIpwMiu+8Card6NfB4ttxAn+stzz8vqBXns98l6V+0HzHIH75R84Pv/eq0st9oBgmjkDJIN6MjZ6HHPcfQ16GFxHsZ8y1SOerS9ouXuekeLfB1lfINb8PSbopMiWGRflDY5H1/SuP0a0h1HWILOW9i0q6yPJup2ZFVh0VmH3ef4u1buk+M4tQjzGEhmfi4t/4ZgO/s3uKw/HlpbtcQXFpLuWUkFJBh1OOhPcV34v2U0sRSXqjmo86/dTPRtWjtPGump4Z8U2sWi+NLdgLLXGwsd6D0juWHBz/AAzjr0bPUeL63ol94a1W4sr2CS1vLaQxyRSLgqwPIrqtL8aQ6x4ePh/xArSvboV0y+L4a0bP3G4+aM+nbqK6fSbuw+I0I8NeK7uHTPEsC+Xput3T7YrgAfLBcP2yAAkvQcBuORzVVSxKTTs+/wCj/wAy6fPRumtP61Rw/hHxpd+HpJUiEVxaTf6+wucmKX3H91vQjmuysz4O8W6xbyW+mTWKsALqO4lD4bPLDGDjFeZ6xpU2jXslvJlZI2KMp4ZSDggj1FS6dPBePHFdS/ZSqkR3IXOD2DDuO2e2a4oVZQfJUV7HW4qS5onrfjH4ZWPhLRHEpjEM8iSW9+kmJAp4G5ew+leX38ZWcWupYWUD91eKMhh23Y6j3ra0fUby3mt5ruE38Bj2LbTE/Mn/AEzY8Z9jW9rXgj7d4UHiHSUL6Q9zJBJZuQJLd1Ck/Lnco+Yc9DXRUiqvvU428iItw0kzzWezn0+4yMxuOQUPBHqD3FXotSt7sBL1AjjpIvAP+H8qj3tZJsbNzaE9Dw0Z/oahn09JkeWFsgc4xz+P+Neerr4fuNm+5q2bnTZHinj3x+/b3H/1q1pfEd9HYMlvdSTWoXBXPKj3H9a5nTNVNgvk3MPn2pPbh1+h/oeK2YgiW6T2DfaEVQZBnGAexHUGsJYalXeqO+ljKtGLUXa5hmRr+WRlZRIBwCcbvpVNkuIpww3CQHj1zXUQWWnayrGA/ZL1sgwt0b3/APrVG1tc2pSC4iypbCSOOuByA3f6VqqCir/ickqjm9SSx8V+SltLPDJHdQgsk8fIcg8blPbjB9av6T47SO9gnXNrcHJcp8q7sknGOg6Y+lYPl+U6GJzySoIIwPxPUexq3HZadO6reI9o7N8txB/q2/DsfatLzk9WQrLVE2qW1trcxvNPlRLoku6Kdqs3XI/un9Ki0jV3+0x/vBbsrkh5eIpT/tqOhPqK61fhtqB8FSajp0llqcVk7tIkSBbjynx83q+COgyRk4yM45qDwPLq2jPe6ZO13MJMvCAB5a46Edc5/DFZ8tSE02jZ2lHRn0P8UjoGpfEy0n8P+MXvdRmsrO7u7o27p9lbyFJRQMtMqAL82Mn8Kp6XeaJ8RNXlu/FE2oX2pNE0MVwD0mIAjmyTk7cH5DweOmK+fNVs9T0HULa5lnMtysUb+dDI37vK8IxwCrAcFfau68MaxqurabaXcVrhHuY7FrqZgttn7wjdv4SeoOR0NedjpQrScrW/M9XAxlRSjLU+ifh3rMnw91270HUJrW8i1y1axstaeNmhuY2dSQu7AWUFQuSMjkHnBr1+68KeLvhh4SnupLKVdL1aUfLd2kbJKApw3z8gjJ49DntXL2q+DtT8FaDp2oaS2q+JLTda3UkN2sEUiMDzGwyPNjbaVfHzY+bINfQ9l4n8WePfAdp4K8aQ6XLZRwJFDr8FySZ+B5cjxlcBsYDYPXPFfJ1a1enFc0dG9bn1UacHNOnt+R8haBo+gf2lPJqRvVtOZWMDQsdykEgBjzwemOa9E/aR+Knhzx/4B0DR9F0mXStP0iACK7kCxr5jDAG0cbSFbkd6xfFnwxj0/wAVWto1/p8No11KIxPKk7b4sA7yoyFJxjgA5rhPEfhpdTvWdLZYo5Jo0gs4cqwBY/IinlueAfcV7EadOpONZt+6ebV5o3ppHBTeHrCXTLWMXM51G5QzCKSBVRY0Unhi2cfex2OPWsnwzd6AutWJ1yTUH0VJx50dsu1sEc7CcqGIGefSvVPG9hnUrfQvFHhq98LS+bD9nPktJcwQldpCq5DSAsNwXOMkgV4zqFldfbp9O3ylYJCvkyDaQ27HIPQ+o7dK9ShP2sdXY8SvT9nP3Vc3fjBrXhzXr7T30Kz+xafaQfYklYYuLgISRJMo+USEMASvXArzbEGf9a2T7V6D4v8ADt9pUGnnVbCaw/0PyyxiG6QZJBGeMnIyfauUs0ubXRNa+zQWstrJHFHPJPGhliHmAqYy3zKSRgle3B4rvpOEKaUXc82tGftHzKxgTrGjMBK5UdwKo/ERNLhvbCLS5Z5VS1jFwbgY/f7V8zb/ALO7OK3rXWr2w0fUtPguGjtNQ8tbmIAYkCNuXJxkYPPFcr4wulu5rNlt4bfZCIyIV2h9oA3H/aPc1UovcyVrI5+iiisyixRRRXWWFFFFABRRRQAUUUU7gFFFFFwCiiincAooooAKKKKYBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUrgFFFFSAUUUUAFFFFABRRRQAUUUUAFFFFS2AUhOKWmk5pAJRRRQAUUUUmAUUUU9iAoooqQCiiigAppNOPSmUmAUUUVIBRRRQAUUUUmAUUUVIBTT1p1NPWgAooooAKKKKACiiigArq/hsM65P8A9ezf+hLXKV1Pw5bbrc5/6d2/9CWunD/xYmFf+HI9NSHcelKYQtNjlIHXml3lzjvX0p8/qWYEVasySIUAwM1d0Pwhqmu6NrOp2cKyWmkQrcXblwCiMwUEA9eSOlZC5zzWi2Mm03uPKjIwOtWreHe6jueKqHqKuWSbnXPSnFXYnsXZLRorpkkXayEqRnOCKQoXJIAwKu6TYRanrFtay3EdnDI4Vp5PuoPU0a5p6aVrF1aRXKXccUhVZ4vuuPUV0W0uYqWtupHaWskiSlF3bELNjsMgZqSGPYcnr71FCBg/SpEwMVSaJZfgjIyuOavTW0kUduzrtWRNynI5GSM/oaz7eNnG4AlF6kDgVbUBguDliOc/WttDF7lm3Qhs9cda1NOEjTRrEm6QngHHp7/SqElt9mkkXckyR4y8TZU59Ku6VEl1PFE8qW6MQDLICVQepxzWkdzOex0lhcXWm20F0RPHBISpkAIDc8gE8HirX2lpkbymdbeQngnr9aq3vjHUtT8OaboM8ivp1hJI9uoQAguctz1NVrR9oxkjHBrpVR7HHydWdGtq0EML/KYpN2z5gT15zWV4z8Ox+LPDU9gfluI5UurWQfwTRtuX8DjB9jU1u+6KMkcHPJ+ta9sEEgR2UAHBYc8VUkpppmMW6clJHS/DPwlo/jGBoGZbC8v3SeB5RzvKFBjsHHTHRlLKeduPJPGXw91Xw8viDwHqMskFs+x9PmjkO20uFctbsD1ETnein+ByUOAVr1HSJoLfUIERxHGJcmVRt7/ex29av/tA6TJ8StJPiPwzJMnibTMMUCgmclB5i46EPt5U8FlB6muSUWrnXSre+os/PzVPFDp45tr+9s/smqxqYdSYH5bkj5d4XHynbjI6EjPGcV2fiHZpRD3REuk3qIspJz5bYwkuewIwD9BW74707SvFEtn4ku9MZLXWLcQ6r9lUs9rKT8l5AOrISPmQ8ghlPJBN7XPBs0nw1FzK8FxJpKJa6jJF86GFyfIuQf4oZB8hb+Ftp4PXy4U5Rc0tt0fRSqRkoN+jPFta0f7Pd2ylo40R1EM0o+Ree5/u1Y8S6fc6lpi3MV4l9Nph+zs0L702ZLAocD5dxb9abp2sR2qS+H9WUzWDZNneKAzxD0J7gfpU2lm58J332iLfqVg4KXkUXR4ycEj6jH0YVxpQk79Hv5M625R07beZiT65HrOiiKRx9ohKxpHnnHPT6cn6EisCWOSLYzoWjYlQQM8jrW74h8N2mma/HNZXQu9Luk8+1nj4JGfuuv8ACwPBHr7VSGotpwkiyWtncOjDqjDoR7jp7iuOfM3+86aHTGy+Ep5EgwF2kchh0qTUVF5Yi8LAXMJCTRkYLqejf0P4VoavrcmqXKXFxGnlbi/kQoEiXIALIo4GcDIrW0DVrOw0+/hj06zubi5jMQnuozK9uhUgiME4753EEjHGKSpqV4pj53FJ2OQjsorqxJTBkXoc9RVN7QIpDOm7BwFPPHrVmKKXT9Q8hWyG+7kfeFO1BfNfzFGG6MMYxXE4qSvbVHQm0/IzFUqS23O3r6VZvrZI0ikik81JFByARtbup+lNlgMnIGMDJ+nrUccxhDRsMo3Uf1HvXPZLRmm5BtyM9qVVycE7R6mlYeW/ByDyDUisu0grwe/p9KySKEgJt5FlKbgjDIPT6V6R8a/jRH8XZ9AeHwxo/hdNJ06OxEWj2/lLOV6yP6sfWvNZAN5CMWUHgkYyKjK4pqpKCcVszOVOMpKbWqJYJtsobdsP94cVpTyTapEAJi6xrlt3978P51kLycZxT4pXt5AyMVcdxSjOys9i2upZXM0ZyN0i9s8/X3FW7aUahH5FzPHCY1+SSTPA/u8Z4qBGjvChjxb3QPGOFb6ehqQW73spMYEV6vPl9Nx9vf2rZX3QmdJo+tLr1nJYTTrbai8H2YXDKGFxHkEI2Rww2jDDnAxXN6rpculz7GQoe4IojjF8DEVEN0meAMbj/jWnHrkr2wsNTQsq8CVhkj0z61rdVI2lv3M7OLuiLw74hNpIlrdL59gzZZDyU91rvI9Rh1e1iihmliubWNxbXUA+cqTkpKP4l9ycj3ry67tBDIfKbzY8ZyB0qxp2oXOmulzbSNG8ZxnqD7Ed6KeJdF8k9UEqXtNY7nUaroFxe3cotI1W+SMySwlgqSIB8xXOM+uOtcou5XO0vA4Oev3Pr7V2MGqW/ia3VfLSK8zk2/8ADn+9GT/6D/OsjVbALLskBt514im/hY/3WPb61rUhGa9pAUG17sjOmuY7l2ivVEFz/wA9APkf646fUVWRrrSrgSxM0L+3Qg/oRVy4thHbxl9s8I4YgFWib+6w7ex6Gq2J4I3YDz7dPlZTyUHb/wDX0rmb1uzWx1ul22h+NbGXzbxdI8RKyrbwBNsFyO53k/I2e3TnrVC9l1DQZWs9Xhl2BtgMq56dR9a5mRF2ebGCEPT61etvElx5a290ftUIAVfO+YoB2B9Pat/bRkkpaPv39TNQcXdPQ3ZbJrqxdtMIaFgpmhIHzHPBPr7EY96v6fNeaBYCSYRXlheoY5bUTZKYP3ZF6qe4J4PbNZcGnNEBd6a7Ruyb44GfGQOrITww4PHWtew8UQ61Ki6li2ugPK8xVGGHow9/ehJLRaMq7eo/T7qbSZzfaBdt5S4MllKSXj/DuPcfjToddS51f+0dOB027cYnAO1VOeS69Cvrj61Tv9IjsplubO5eK4QkqYuVA9u/1HNUH1eHUPk1CIWl+BiO8g4R/qKhp25W7GkZWdz1tNQ/4TqGeW6t4rdzGILqViTa3Kj7uHH8fHy/xfhVTw/4M1rW9NuPCi+LY9C8ICSTVng1Bz5JnjQqrBVGWcg7R6ZrjtE8barpGh6lo9oy32jX5R7u0A+Vihysg7o49RXSeGby7vVkbTIpNYg8stLbOf39ugBZm9wADz0+hrx8Sp1byqb91+vme3hpwi4xiQeCvHV5oE62F9dSQSRZMMqgncf7pPp6Gvqf4afF6LWrGys/Exk0ie4Yw22ryxultc7eArOPlDjOC3I6bsda+Y4dLs/FACxRyXMacDYAHiJ6ZJ6fj+Br3vQfHOgeGvD9t8M/EQfVvDFve+eL7TrlZzazlcGSJyACD3ThTjINeVVk6bta57WHXOtz2I+AXl8SCO6ZdPic5F/M7ExHGQy4BzntjOc1k6T4TbUdQuUbyrW5hkSe2u/m22uxi2AT/F0GDxW3pHxc8H+GhpfhFLqTXPDcMoNrrcc2+e1JGGXYQG8vPOw8qclSQcV9Q+Bv2eND1mxa9i1EXFpdRZE0IV/MUnOd3cV5VbF8i02Z6vJRow5672PlH47aLqHxJ07Sdb1bxAs3iBF8iYiJUEUSPuiaPbzk5JY5zn0ryjSfhFp73EVxdarbxzTzuJ7y5LMJBwSeTy2c59SRmvq79pr4HaZoF/4et4iDaxQyFZTF9znJBC4yT+pr5R+Jvwd1DwDbW0Ot6bfWGl3TGaxu5VOWBxuATdx6+vHNXg6sqsfZqdl6GdZYeMY4inBNPbV/ket/tTaDY+Mfh/4P12LX9OvLtLddOOn23lqyIgJ3kE8E45/CviLVNMglnY4DhSVB3KR+hrtdYnlD/KyQiJfOSRc5J7LgcA8ZrI0O7gshqfnBYLO/C21zJ5W93iLqXCDoGGA3BHpnmvocHh5Yakoc3MfJYyqq1S9rHJXOk2kQiAcMCoLjPQnPHU9K5b4h6C+hjSHdCq3tubmI+Yrb4ycBuDxyrcHnivQNUt9Ktma3tVMkEkpDXUuN3lhvlITGVOOvJznFeefES2tbXUkWymM9sWcpIY9hI+XqvavW5tGjyJR1uclRRRUCLFFFFdZYUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFO4BRRRRcAoooouAUUUU7gFFFFFwCiiii4BRRRSuAUUUUXAKKKKLgFFFFIAooooAKKKKACiiigAooooAKKKKACiiipuAUUU0mkAE5pKKKACiiihgFFFFJCYUUUUMkKKKKQBRRSE8UAITSUUVABRRRQAUUUUAFFFFSwCiiikAE4FNpWpKACiiigAooooAKKKKACup+HKM+uThRk/Z26f7y1y1dd8MZTDrtyR3tWH/AI+ldOH/AIsTCv8AwpHpSWmxQXIHtmjeE4UZpnmg9QSacJlx0r6X0PnyxBdyrFIiSsiSAB1ViAw9CO9KqZ6daZDMmORUwnQchaojXsLHBuPJ4FWo9zOFQcetQLOvPHWtDTbtI5AGXNaQsZyutR0itbkbvvEd6Izk88mrGq3UUl0TGjLH/DuxnHvioUkA52nNavexknpcmjUkMcZ4qaBYjFOZJTHIi5jUITvORxntxzT7KW02zfaUmP7pvL8ogYftuz/D64rYv/B1xp3haw155raS1vJGjSOOUGRCP7y9q1Ubq6M5SUXZmZDf3Hl+X5rbCoQqDgEDpmrIJVUIGCR/WqVsys2SOfQVpPLF5UOxHVtvz7iCCcnp7YxTS6iloTNdNNMGVEiJULsjzjpjPPr/AFrZ0fS5710igjaSRjsCjru9K5+Nhk9c1saVqP2KZS28wnl1VsFuD3reFr6mE720Lkt2YY0tTAkc9vM5adSd5PHBOccEcY9alS4ZsszbnfksT3rMeeOWXfEHCNyN2M+/61btnG3nNaLcya0N5JW8qIA5Az/OtW0imhgWZlKxyg7GI4bB5xWTC8X2K32q/m5beSRg88Yq7bXCqhVt5OPlweAa2OZ6m5Zy5PIGfWu28O+IBoGuR3aok8av+8g6K69x7eo9CBXntpdBSOCfpWxJeRfaHMIdIyeA5G79KHroYO6d0fOtxeX/AIS+Oeu+Hi3keGb++a7tXuSFa1ErgrJG3QfMQCp+U45xjNdv8RdTPwz8Tx3+kW0T2c1ubPWtCniBt1eUYcKve2nHIA+6+CuCK7L4h+Dh4w8MXos2FvqzW8lutwVVt8Tj5ojkdCQDnsRxXgavrGufDnbqku/WfDskunlpslmi6m3m/vIw5U9VINeW4ui3Fa31/wCAe/SrRrxUnpbR/wCZ5l458CrHqk+peE/NuNCSJrsRzSAyWwGN8bjPJXOM9xg+tM8P3sl7p4aLKlP7o4BPBH+etbmuWdx4htrj+wLtnvJV8kmEGMajF7hsYkA69N4GeoOeL8Iamlrq8ayyeUhVgQqZEjAHapGQBk4G7tnODXj80YVr7JntrmnTs9Wh+uRLIGu7OJoZYmCTRM2e3Oeh6g4z27nFc5cyJduQuUYjO0nvXfeJ9IS2aDVIWc2V8GV5ZHyrkdQe4cHqD0OOxrhrqz+y38lrKgSRDuVj1IIGMe2Oa58TFxdu50UWpRNu+ihvtGtJwP3wXZIAQMFRjp/ex37j6VzbzT6fckYKOOBjiuhuNA1O2Wxl8kLHeQi4g3yIFlTcVB6+qkdjWdKn2t3+0BldjubcPnU/3vf3rKonJprRl03ZFa8uYrqEGYtbXKLvQFThj7emaes0d3EHOEcjkDoT3qvrn2yaYS3jyTPtG13OQydse1VwMw7k788Vzc752mjflVlY9E8U6H4Imt/Ctr4RutYvtWudOxqUN3Cu1b8txFDt5KHpk+orze6QxSMrKQ6sQ8bjBBHBFTW96wZckhlOR6j6VYKRXOc8P6nv9f8AGnUtVV46EwThpJ3KEtsoht2ilWZmUs6qpBjOTwcjngZ49ahZSMEdK1tK0K+1LVILKxiM9xcN5aRAgFj6c1Tkh5Bxgnjj1rk9m0rs3UtSLT9TuNLuDNbSeXKUaMtgH5WBVhz7E1Dw3apRGgkBkB2g4ZVODUJU9ay1WjL8xCtBBK59KFJ5FGfXrU6AIvPFWlvC+1Zcvt+64PzL+NVelKT09KE2gtc2/Oh1AB76ZoiiMUuYYtzOwHyq3Ixz3/nSR6gmoRrBeYjmHCTn9M/41lW8/kt8w3xn7y5xn/69XLyAR28bIfNtXJKSgcqe6n0Pt+IrZSe6JsiS6ie1dkfKnHTt+Bqo/QuAcdM/41YTUCbUW1yPMiXPlyA8of6j2qvJAckAhvQqcg1MtdUNJj7ecRzxs7MoUg5Q/MB6j3rstO1vTtQUWmowgWpOFuAOuf7/AL+9cGUwepB96kimaIPhsZx8nY0U6jhK6BrmVjs9a0Kfw7cNLBIJ4io2eaMiVP7h7H2NZMfk3a+fYsYpEHzQOfue3up9DW1oWvWX2ZbSd5Z7CQ/vbZhmSI4+/Gen4Vj69oqWj/a7OcPA3KTD5c+zDsf511SlGXvw+aM7OOjIbe2S8mMVuFtrxjta0kPySn/YJ6H2P4GqFxZjfIjI8MyHa0b8YI6g56GlmlcvGL2EgMoKyKMEjsc961LrU7i9soVeOHUUgyPtG3E5TH3XPU47E5+uOKy0loPYxrfUZrR1QsZI0yBG54HPb0rcSa015EWQiCYDasw6j0Djv9azjZw38e62O9guTGeHX/EfSqSmawdihI3DBoTcFrqh2v6nQWurXHh+dIb+I3FtkFXQ4Jx/datyzgsvEqkRFI7gnKq+Nj/7w7H3FYGmalBqifZJ2EAcjKsMqSO49PpTlsb3w3qCXtkN4jO4R5yCDxx61bcrcy1Q48t7PQ7G7166i8D2PhYR2mlixv5L+K6W2UTPIy7drTdSoA4U8c1X0fWLez1O3a8D6FrEZ/1qqxtbhT3O35kB9Rkd+Kz9BvrDWbU2s5m+0FiGtnYHIP8AEme+e35VNe2MmlW4RkfUNPIwjSDbJCQedh7Y7qePYda43GHI1TWj3TO6LmpKUn8zp7SaTTJ2ZM2epghhOjBkZG5BGOJI2/Sukhv7bUra5NvL9h19I96ae0gNtet0ygI5YZJ2nrXmYmW3ht2WdpNPk4W4T7qP12sp+6fX8xmtcypq8aWd5KlvdQRKYQ7BTOu4/NE68MQMdTnjj0rir0I1LKOjPSw+JdJu5758CfCN5408dWRGmw6YLFFvLyPU0P2R492xSMkHBchQvr0PFfffwO+JEuh6xJoVzdBYbuTZHYWqq/kyZwSGBDr7q657g1+U+heONY8I+JNM1Oe6e+fT9oinu4hPtUdEdG4dee/869Z8DfGe8l1i1dpv7WnY7i8Rc3car824MOWAAJBB3LjoelfK4qhVp1FPex9Xh6tHFUnSqOx+l/j/AEm48X6yLhYlkiGABMysNoPucf4VwHxQ+BfiP4jWEcyamLoWhlWCz1VVlSGMgYWNhznjvXiHw+/aA165muJtH1V9R0+eUtdOIE3wTHkSyKW5RscyKqg9SM5z9GT614xtPhbba3dai8GqX0xZYiI2j8grwQBxz1Bz0rk55Q1i7GlWi4KEFa2yPizxN8F9c0/zY2uYAZFZJxuJ8xRgopx2BFcLJ8JtViiEbQBbYjewjYMd4U/MM4yPb0PtXu3jJ725ljiuBDqETbZZhvVG6EMMqQSM8jvW78I/hL4X+JHiKew1jVZvD1jb2waLbdRvubONoZhnuTzzXrQx1SlT55yWnkcOIwFB3lys+L9W8FapYw+VJbHp9372cjBYEe3FeYfFvw9d+H9Q05bmB4UuIBNF5gwWUqvNfbvxc+HFp4T8VapYaFcm+023n8uGZ5UBkAAzyBg818//ALYPge38NeE/hjqqXEsl5qsN8tzDIQRE0TQABcDphx+Vezh8wVaUI3+L/K/6HzmKy/2FOU7PS34nzLRRRXrHhliiiiussKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKkAopKQnNIALUlFFABRRRQAUUUUhNhRRRQyQooopAFFFFABTSc0pNNpMAoooqQCiiigAooooAKKKKkAoopCeKQCUUUUAFFFFABRRRQAUUUUAFdV8OBnW5/8Ar2b/ANCWuVrq/hv/AMhyf/r2b/0Ja6cP/FiYV/4cj0qOIHmleMY6UI3ShySa+lPA1BRiplHFRxjI5qUCkS2PUZqzZ5Ey5qBB+VWbdD5i1ojJu5fdDNKo6+lWIG+xzqzRrJsP3HGQfrQhW3WOYSBpdxHlkdB602WRppGdup54rpstzG/QE5zgZFOaaQoIg58vrtJ4pY1xk1KsLy52qW2jJwOlWrktIfaBVxnir5xtTr0/rVOCLGM1d2kBc5AxwTWiRmx8WYh5hiEiNlQT0Bx2qe1USsm/cyei9ahkf7TM0hCqePkjXaOnpXTaTottc6T9ojvU/tLzwkenhSXdNpJcH2PGK1hFt6GU5KKuzFO2PZsDYxzn1q9FcQASBDIcbfLyBz65qCSHacEdPXtVq3tVZQaeqZm9UbFpcRJZusqO0xBETo4Cq24ZJGOePpUtvOFjJDESZxtxwR3qKCzIWFGIRXOFd+F64zn0qOJvKlYAB8HHTINbPQx0Zq29wySoynDZ4NaIkMtwSuSC3G481m2qxZhfzMyljuQpwnpg981qz5jvJC2OWJ4G0fgKq2hk7XNYO9rHJbSRFZg/JY8rjqMdK5i68Px6brmoXq2KXmn63ClpqUax7nhdWzFcqB6ZKt/stntW8txEbZAEYThzl93BXsMeuc81ct5GJVkBz/s9aiUb6MiMnDVHht3+zqbPQ/GNnp8RvNR0911LT7cPzcWLZEiL/txuOPqPWvm650+TV9PvJrWBo3tGV3hC8hWOAePfA+uK/RvRdQNjcRXUSRi5tlciRiPuMNrLjuD8px6gV8x/HD4Oi08VSeIdNuRp2lak5W6MfypbTt90tjpE7YBPRSc9K8nFYf3U4rY9vBY3mm41N2eW/D2X/hJtM1TSby1F75sInkjCklVjHNwmOkiLw/qhJ6rWFqfhmRry10q4mQxyyLDpuqyuEjjyfuSsf4Bnr2+lb2kaZrHh5HurVBb+YJNPkuAdrw+YDHMhI6HB6n+FuODUWseC9Y0jRNYttRKrHpLwtLaTk7vnJVHjIBGCO/TlfWuBwcqdpLY9lTSndPc4ew1C20XVLy01TT470hJbcr5pURydBIjL1KkZAOVP40xlS/hjS5IjuGG+KXPDjnB46dMGtC8sf7VtDLJBKxh2q8oT5kz90Menbg98Yqm+mlrUQOwwGJhnHTPcexPpXn2l8PQ7E4vXqX7LQJ9Y057TTxJqEqRGWW12ZeLqSY+csBxkjrnkVzLWNxYw27PHtWYEqGPPBx0rQQatoMVnqKO9rKzs1vIjbZDt4LDHOM5H4Gro1Sy8Q27/AGpRbXrNksowjue4/uk+nQ+1SlCem0ivej5o5lbU3d0qICHbPHrxmoorhkYeoPOO9XAJ9O1DDq0VzEcFHU5HqD+FRXtqu4TRKfKk+7jna3cVxNNarc6FruWI7iQEywOyFAWMifwjp/XFUo54xuUhiCRgA4471Hgplf4T/P1q0qxXEeD8jr3FDbmPSKuT+JtTttY1q5vLOzFhbOwEduH3lVAwMt3PHJxyazUQ5BHf0qx9hneGaVIZJIoQDJIiEqmTgbiOBk+tXU8O3DeGJNZFzaLbpcrbfZ2nXzyxUncE6lRj73vUcrk3oO6S3M0Wm9wMhcjOTUDwlG5q2sm4EFlWQchs5BrZibSW8MajLNvbVZHjiihVMLGoIYy7vflNuO4OeKTirFXOZZMjNIFzkfjUwG3jtUj2eLL7T50Q/eeX5O/950zu2/3e2fWsmirlPHarljfNaMysvmW8nEkRPDD/ABHY1G8cQt1fzCZixBj28AYGDnvnnj2qJB845qdYu6C1zt7T4U65qPhCfxXYWxufD0M/2eS83ALE5GQjjs2PzxxXV/s6aH8NtW8R6rD8TNcv9E0tbN/s0lhHuMk/8Ibg4Heun8PX2g+Ef2eb24sPG4k13VLpI73wk9rvhkiU5EjMeh9COa8X1Kzilja/00MbY/66BjloWPY+q+h/rXmw58dGrBNx1tpo/ke1VjTwTpySu7aieNLHSrLxJqFvoN5LqOlxSkW9zNH5cjp6lexrFVcqCR+NS3sGx1kQlopBkEjkHuPrXTfDjWYfDGsNrUtimoS2SFrW3nj3W7TnhPMyMYHJC9yMV3crpwtvb8TzLqpUvsn+BzVkJhdRtbgvIp3AfTn8qu3WutqkU0cyR26OxcCEYVcnIGPQVHdzSajPc3Cjyp3JaWJF2g5OTgDt7VoxQadrmj2lnb24s9bhL75Wlyl4CRtAHRHHI9G46HrvGLexg3bQyLbVmSH7NOi3FoefLbjYfVT/AAn/ACamaze2jN7YTGaFD8xX78f++PT36VmzQtbyPHIhSRTghhgg+hFSWd7NYXCywSGKRejD+R9R7UJ20YvQWSbdKs0R8mXOSF4APqK049SgvYhHep5c44E6Dg/7y/1FPFvZ68AYlTT9Qbjyj8sEx/2SfuN7Hj0I6Vk3ME1lM8E6MkkZ2srDDL7VSco6i0ZqX3h4xN+4dZCp2h423Ix/2SKl0bxHJpVzFHqELXNsh5TOG6ev5VmWOo3OmuZLdgyH7yMMqfqK1Yr2z1srDOghc8Dnv7E/yP51rFp/Do/wE79TZOm2evIt1ahHwOVU4dT6kdfxq1banq+iO73kT39gcOXcbyuOPmHcds1zc+i6n4amS8tGkCjlZE/r/wDXro9C8bwXoVbki1vehZhmOXrnPoaTT5tNJfgaxkra7Fz7H9uSTVNCFuYrj/W2APmRt/suD0PoD+BqDR7RbszJY2Yu1Ub7nRJ3Ili9WhPXjqCOR3BFXh4fOlWMPiDw5fImo73S+0l02qFz8jR8kSIw4I4Kt2wQadHeWXi8wvYA6R4ktzuETttJI/uN/k/WocI1E01Z9v8AI2UnBp7ruU4/EzWTSmdZdQsVBiZpVxNF6LKP69/0rX0u7tZZVudEnkG1hIgUfPG+Pz61UuJo9dvFGot/Y/iSMbfMePCXP+y3bn34P6Vma34bu9H1NGtFaw1AKG8mJ/kl4+9E3cf7J5HSvOrUuZWZ6NCs6b5kek+DPG1mL2MyzJ4e1mHIS6BKQzH/AGuyE9D/AAnvivoeL4u+I77w9YaVLKBd2kKiLTGm8q3EIB+ePqFbHzADKMPSvi7RNdi1D/QL2L7NeEmNZhH/AKwluRLnnjsR+Oa9K8Mw+LvAmnTzzae2t+HLGYGS0E3+k2IPKyxkZKKeuRlGxyK8p4FVJbantwzFqKT1R7RF8QJvETO8GoNfxraGzQQun7sBs7TgfX3OetYE+vT6AJpmmMzuq7Y0ZSQOTgtjgiuLiubSYXfjDwtGupwoq/a4rWQ281qSeWmhGdwPTdyoPOatnxPbeKLcSW7razRgCSDbiTHbjo31H41tGiovkkjnqYhtc8GbVt4yvr21l0+6vHFheBnckFQpA6DBBJHX0JwK8k/aL8daz4yuvDkGqXctzbaXaG0s1bAVYwE5AHc4Ge/HNdxfTpIgiuLcEIqqHt0KGM555PU9favLPjHY3NtNpdxNjyLkSyRYHTlQQffp+Yr0KVCEZc6Wp42IxFSpDllK55xRRRXaeYWKKKK6blhRRRTuAUUUUXAKKKKYBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUVNwCiiikAUhNITSUAGc0UUUAFFFFFwCiiikK4UUUU9iQoooqQCiiigAoJxRTSc0gEoooqQCiiigAooooAKKKKTAKKKKkAppOacelNoAKKKKACiiigAooooAKKKKACuq+G67tcnH/Ts3/oS1ytdb8M13a9cf9ezf+hJXThv4sTCv/CkelxqMCneWCafHETgAZNa2qeFdV0S3spr+xmtYb2LzrZ5UIEqZxuX1HBr6ZRPnXJXMfYR0qRFyanW2PcVPFbHPIpqJLkiKNcf4Vr6Vp811KAg/Sobex3uvH416L4N023XaWxmuyjS52clapyRujktR0u6jk82ROcdQMVRRCD716h4ptYFiIGOleePB+9YAcZrepTUHoY0qntEMiMqJIIjjchDdOVrpfhxcWNl4mtH1VidOZttwv95PSsIQpsXBJfncO1SrCygADk0oPlaY5xU4uJseLptPufEl7JpUflWBkPlKOy9qo3E811DbxSSM6QJsjU9EXJOB+JNQiBwRlSM+tWo7YlR9KpvmdyEuVJFaGJwXKMBtXnJxkdMD1rv/AAzBpeleHX1hrto9bglAggDbTyPvZ9q5G5gE8iOqFMIqtznLAYJ/H0q3b27MRk5+taU5cr2M6sedWuSXBe8czbSoc5AyTgdOpqe2BUZJ6UsSOnyRsw3jaVHf2q29mItq+U0bp8su4n72fTtTWupLaWhYmmnns7ZHlZo4QwjVjkKC2Tj05pv2KXbJMjebErKjNkA89OOvapvIzbIc4xnAqtImOD1HAxVO99SFYu2rwqy8seeRWzcTS313JKXaRmOSzHJNYVrGVKZUEZ7da3IQEnYxAhNxxn0rSOqMJbkql0XbnAPOK0LS6e1jaRJjFMuAu3g85B57cfzqp5ckr5UcVPDbght3B4wCOvNDM9yxEkjxrIowjZAJI5x1pJoItQtJra6iS4tplMckMq7ldSMEEelWdJhs/OjF4svkDO5oiN3Tjrx1p8cQVnKqWX1rMNmeP6r8Mk0DUhDDmTSb+L7LKj8+YMEIM/8APRBwrfxKMHkDPV/D7w5b+MvDGq+HdatFvNc0O2lszJ0lvNOkQmLH97bIFZc8g5HpXb3dnDqdrLBdIJIpV2sp/THoR1B9qpixuNG1XS9c0wtJqenLscyYAu4D9+JiO5xuB/vD3Nc7pJnbHEvqfDd5od3Yn7PueNJUSZow5CTrztyBwcHP0Oay5gkGyB4nAc/f/unuG9fY19PfF74H32oQXvifQoy+mQ3E1wFwf3MLAyshHYBt/wD31XgeprE1qkjD5d+1xjnPbB9fSvIq0OVs+ho1vaRTRg6/ZPrNp/arBZDEFgmaOMLt2qApIAHJAzn+Lk9c1ycmnyRgzQ4MZ+93BH+HvXq7TwaA8flPHfWt7b4uoFbIlXnEiqeki8jHYg9jWJZ6Rb6BqkV/Z3aT2MgfEflLKMMpXdtYYYc8jqMeoFc1WhGVrfM6qdVx3OHMxvFUSM63OAkM4fnbjGwk/pn6dKu+F9IOpTXkN1GyWlvbvNNIkioVwMKw3Hk7iPlHJGaszaI8cZ8tRdRLhJNnILfUfoe9Jqz2O2xXT7aa3KQLHcPM/mNLJklnIHQDIAx2XPWuL2ai7s6ue6sjm7nT5IIMsjbgeG6qaLmyks5yu+NnRQ2UYMrKRnqK6BVW58uKTBSZtiujYP4g1Uv7JkunlbbvZsiRRtz+HSspUlvEtVOjK0GrXj6Tc6TFezQWl1Ik01oGIikdc7Sw6EjJx9ayXgkhBDJ8vcVfeIQzs5H7psgkdVrQFu1xa/NE0yLneV6p6n6dD+NZ8vtNHuXzcpzJVdoIOR9ORTofMaQRqQd3ABOBWhe6QYovNidZYjwGHUexHY1QVMg5HTsa5ZQcXZm6aeqG7SjlZMgg4NDLuB9aRkwT2B6DrT1OcZ47ZrORaRE+QoNNAwB161pa1ot3ozQLdRGFpolmQHB3KRkHiqLRkbNxC7u+en1qLplOLTsx0krxDYwKnrir2jXUkF0kkRKtnHPII7g+o9qzGOGYZDds0sUrxkEHHetabUJJsmd5Kx9Q+Of2VH0H4A6L8TotSglttSm+fSID88fB+ZfyJx2FfOc17PBZy2lrcSLp08ivJbq/ysy52lh0JG44Puau3Hj7W7jRYNLk1K5axgbzI4PNbajeoGcA1XtCusM5jCpfEHdEANsw77R2b279q9LFVKFZpU1Y4MLCvRT9rK+v4FBpSX+VmLr9x/4sfWut8J6p4fs/EemXU+lDU4rba01heylI7p9vPzLggbsHb3xjvXNR2avMIckBm+Rzxj0qtcI0dwyOoEiZUkDhq4EnFXa0O1u703Oyt9Ns/ERvbXVpZIb9VV7a6t7cuAxbHlyKOQvPB5IwBzXIaxod1olx5V3HsYk7SCCGHqCO1dD4a8YT6TOPMnmt5CgUXCEhmXsr45I9D1FXNVggFsFRGubQne0BOSmf4kb/ACDXSoKtFyXy7/Myb5GkcGkxUYI3L6GuisdTtby1+zamr3EIULFeR8z2vsR/GnsenYjoc7UNHNsomhYz2rnCSgdD6EdiPSs9S8DAglW6g1x2lTdmbaNGnqOlyaZIjB1kjkG6GeE5jlX2P8weR3qiuyU9RE/Y44P+FaNlqTy201pszHL80kP8OR/Gv91x7delZ86+TKY2xKM8MBgmk+6A1rDxVqGlwC1kdprbduMbkjHrtYcjI/Cnahb2eqs81ikwyejIM/p1rE34Uqp3J/dbtU2n6hLYT+ZbvtOc7WPWr57+7PYNtjV0XxRc6LKsMxeSAHGCfmX6V32p+H7bxR4dt9asWWWNZDG9xb8SwyAZAde3GSCODg9CK5BdS0zxBD5d9blLocLLCAsmfcdG/Q1n2s1/4ZukurG5eIq2VdDgEj1Hr9a3kko6vmj+KJjJ37M6W68SPeW8Vh4oia6jQYg1ONcyKPRv738/rVq6u59JsIrHVmXVNDkb/Rr+2cOY8ejDuMjg81TtfEmmeI43g1Jk0+8P3X8vMMje4H3f5VShguNMlkS02TQyAmaxlOYph6r7+h6/yrKSbtJO6/rc3jO2he1ixaKC1upblL+xfIg1KPO9MH7so6gj357gmtXwl8SrzwnPBFe3V3byoSbe+jYOFU+n95T3ByD6A1zdlqc+iyyXujSSmJFZbjT5zlowcg5HdeeuOKkjsINTss28e+FwGMDMCYye4I6Hj8e9c8Vyy5o6M1dTmVj1mxsrbxhrP9p6RfReGfFW0vBNZjy7a+GOQo6Bj3jPXtnpWXqnxS8S2ZsrS78P6eunWKeUzaTbeWZXySZWPOWJ6g4HGMCvLor688Ku9s5aeyZxhiCGQ/0r0Xw58SvJgmhmaGWK6URSXjLksuQcSe+QPm6itPZ068ryVmCrSpxcUXrXx5ZeIBIsVyI5pDueCdfLfP06Hr2rkPi7KJW0gKJVjVZAiStnaPkPHbqTXe2/gjQ/E9vcXt9JBGRj7MqglpiTyAy8AAc5P0rhfi7pQ0aHRbUGY+WJl/fklsDZxzzWzpckTi53KWp5zRRRWBoWKKZRXQWPopuTRuoAdRTd1LuFAC0UmRS0AFFFFABRRRTuAUUUU7gFFFFFwCiiincAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKVwCiiii4BRRRSuAUUUUgCik3U0nNADiaaTmiigAooooAKKKKVwCiiiiwrhRRRRckKKKKQBRRRQAUUU0nNIAJzSUUVIBRRRQAUUUUAFFFFIAoooqQCiikJoAQnNFFFABRRRQAUUUUAFFFFABRRRQAV2PwsXd4guP+vVv/Q0rjq7P4U8+Ibn/AK9W/wDQ0rqw38aJzYn+FI9ViG1hzit7U/Eup67b2MF9fS3UVjF5NskjZESZztX2zWIIzjNSR5HFfVR0PmGk9WWQc9/xxUqBm4FLaWklw2FUn8K3bXRjGAWU/jW0YN7ESko7kcJuP7MWHeBCrmQLtGd2MdevSr+kaubRwM4p/wBmihTErgKfQ1SNvbiT5HOK6UnFpo521JWZranrbXfGc9qxtm459etWfs8O4/OasRwW2PvGm7yd2SrRVkVra28wSEMg2IWO5sZ6cD1PPSrVja/aLhIwVUuQoJOBknHWrEdtbYbDnpViG2gGD5hpqJLkJqejyaXqVxZTSRyS27mNmifcmR1we4qYaeYbaGQyRt5oJCq2WXBxz6dK0o4tPaNCGYvj5yfXNPMNoduGIGPSteQxczMjllhjeFHCxuQWBAOSOlaOm2v2iZUaVI2bJ3yHC9Cas2VjZyzbXdjkHAA79q0rfT7Pcq72PvVKBm6mhz7KQy4wD6irMQLnLNuJ6knNaz2FmyJ8xBxzgU+OwtUByzVai76Ee0TGtb7LK3cyRkPnCqcsvPcdqqumXk8sjBGCPatyGLT1gTLE9fr1qRdP0942dZSeOnpzT5TPmsY9jbkuOQO2TWvdQ/ZJ3iWaOTB5ePkGprW2sVblmHuKmuEsVlcKWKg4BYckUWsJy1I4JhDtO4HPJHpWjDZveyIkW0yMpcYYdAMn9KqyW9piPa55XnjvT47SMBSpYAhuQvtQyOtyxAnyAHHIyMEUqM4RwG2qSBj1psMCtH3LZ/DFXraxW4VlU/vMDC45P0qAbG28Rd0BwoJ+91rRntZjKiS4DFFwBgcY46cdPxptlbeWh8wY44zU8iJ5ilST8o6jHOOahkbnX6LrVnbfDrxVoJsw0Vxol9LcSnkmRYyVI+g4r8u9Vu1s7Z4XRpIJotjjP8XZvwNfqP4Ht7OV9XtZGE097pU9rBHt4Mki4wc+gzX58/HP4dN4Oe3skxLPCh8xkXgkHk/0rxsVF3bifUZfNOkrniF5rdxIyCVtrKgVZIxgnHRj/te9aOjeIY5w9peSiFJTkSgcI/8AfA7Z7jv161LH4ffxCbkrcWtp9ktHucXEmzzduPkTj5nOeB7GuWFswY8Aj0rw26tNp9Ge6uSaaOstIL/TElu/mtltLkQtPC3KSMpZcezAEg/WtTwF4T/4S3xrpOh3OpJZW15J5aXUhyiE/d5HqcD2qnqVxJaaS3h9J7PUU3xSi/tSxZgFyseT1Clm7ZBzzivafgr8HW1W7uLHUAokn083EQkBB3ZH3WHKt6N2NdVODnNLoc9WahBy2OO+JnwN8TfC6+k/tXTnWxLHybmIiWJ19nAxn64PtXnq6VKtmtxFKiMGKPAxyxGMg7T296/QTwH4juL/AEWbwn4sRr28SImC6ljBW/t1wDvU8CZOA69xhh3rzzxj8DotDv31vQNLs9UtIwxuNDuASkidf3LfejbrgZIzXoTwkZax0PLhj+V8s9+58Uzac9sdxXETgcA5H/1q0/Csxg1DyyflkQxsM8HjjP48fjX2Bb/sz+CPix4btNa8N3NxpBnUt9ncbtp5BUj1ByD06V4F4r+COr+APFUGmavFO0dxJshuLaMncSflK+vb5a5ZYSVKSlHY7oYyFW8Huea+KdKTTr6SSy80wFd6JLjcUzgg49D+mKwYkeeFgpLEtvIPPPrXdeJIJoLuQHBkglkYMy8n5ASDnscdPeuOhkgtNQjfEiWz/MhH3kPp74P6V5leNp6Hp0ZXjqU3tMbc/dY8Gomtyucjp2rp1gW4uI42ZMtyW/gPfJ9PrTWNhZTyCeE3KNG21Vbbtf1/Cuf2aN+ZjLFtDt/CmoNfxy3+sy4gsot7IlqMhjMT0c8FQnvn0rkpV9K39c1W11G309Lewisnt4BFK8ROZ2yTvbPfBA49Kw3XJ6VjUtol0LjfVvqbOkeGL3xpqT23h/S7i4uI4JLiW2i+fZHGm53z2UAMxz0rDlYMkQEaptXBK5y3PU102neItU0CzNtpl8LUSwPFNNZfu5JY5AN8UjgAsOMYPHWsWSzZVHB+bpjkVgozbb6GzcbJLcoMARleAOcE0BmVgyErg8EHkVN5Dqx+Q0vkbm2jHNNp7kHa+AvGVpofiWK/1PQ7LXZkUj7Leg+VK2OHwONw9DwfrVHULy3129uluIYrFp5GkgMS7YkBP3QOw7e1c60HJwMMBXa+CfBupeM7e+QW8kltaQm5nu9p2QqB99m6Ke2Tweh7EdaxTVNU6mxmsPzT5oLU4u4Se1v2ivEO9MIQRjgdMV69qXxT1GP4TeG/DL6Fpp0HTr1rpr+2gAuZGbqjv7frxXIanHa6hpEWmXZj/tOAB7LUlbCXER/5ZP6Efwk9DlT2xz1rrdzpSXGnXKubZvklgkGCD647EVUY06U05dNU+zFzTcWl10fodf4w1Jb3UE1TSbeBrKdVVxbqUjlx2df4XH6dRXG3uli4jlnh3BI+XikOWjyf1Hv/ACrU8G2d9c+ILW00ua3YXT7XivJNlu6gFjvz0GAfcdq0xb6fq8wvtGmltyis8lmAHkh9QM/fjP8ALqK3qf7Q3N7v+tDKFqVorY4UJ5eFkB254I6g1qwmG9gWKYqZBjEu7I+jHsfQ/nRfQoLkPtQ/xFQNy/h/s+3UVSMLxnfCWJxyoHb+orzv4ctTqXvLQtN4dkG9gcIuAZCp2qxzhSccE4OOx9ay7mBrdyrY3fyrorC/N5Elo7OGiDYQjO3P3gB3U9x17jmrOqeH5Eso53w0YTeGX5mRScBs/wAadsjkdCAaya10ZqldbHJxSKWVZCQM/fA5WttdVeBFS7Xz4nHyXMfJI9COjfQ81lXNoYblRJtSN+RInzKR6it9/AWuweFf+Eht7b+0NALCOa7tWEqQSHokoHMbem4AHsTVRqcnUhwcjKudM/cfaYnDRHoy8jPofT8a17DVbOHyIjbyRxNGpaOeThn6F4nx8mT2OR2NYdhI8LEwTGJyMMp5Vh6Ed66C/ttO1TQ7WRbeTStRRG2l2LW1383Own/Vt146H2q+ZX5k7MEnta5pTaXHqUwubK6dbuIBlkACzAf7S/xfUZBrKe3f7XvtytlqZOCinEFx/uk/db/ZPHpjpWfY3o0y4it9Sgm+zxtuIiISdMjqjkH2OOh/WtvzEvLJy0i3tu4wZVHzL6CReoI9f1oclUV9mFuVkMWoxSSSW9zbGF3JEtvJ98E+hPX6GifwtfaVNM9iftEAXLQvxIvqCvfHtVbUYY5kRLhmmhChY7rrJF/st/eX09Kksb3U9FDXE4ku9PQhPPRiUyRlRu7HjofSobsilq9SxonjG40d1ET7Yifmgc/Kfp6Vu/Fz4m33xNTR7vU55bzULcSRvdTtukdMRqise+0JgH0rMfTtM8YvHJbTJZ3ecyMVOMdywHXHqK9K/aT/AGabH4E+Cvhzr1h41svGUXitLxy+n25jitzALc7csSST5/OQMbferVSTjZkyiovRnglFFFIkloooroLCiiigAooooAKKKKADJpd1JRQA7dRkU2igB9FMpcmgB1FN3Uu6gBaKTIozQAtFFFABRRRTAKKKKACiiigAooooAKKKKACiiikAUUmaMigBaKbuoyaAHUm6m0UALupKKKACiiigAooopXAKKKKNxBRRRTFcKKKKVxBRRRSAKKKKACiimk5pABNJRRUgFFFFABRRRQAUUUUAFFFFSAUUUUgAnFNoJzRQAUUUUAFFFFABRRRQAUUUUAFFFFABXefBq1kvPFFzHEhdvsbHA/30rg69G+BN09p4uvHRihNi4yP+ukddmDSdeF+5y4q6oyt2PaI/DEyqGnZYV9zzUi2djaHvO304oeSS5fLlpPdjU0ULED5a+0UUtj5Fyb3HJqbRDEEKxD1xSteXEo+eQ49BVmO0LDlaspp5IHygVpZszcopmZtDL0LfWnrE3GBitqPTQAPkq1DpYY4IFVyNmbqIwVgYNz696tJaNjJHFbraWokOAT9KsR6YcYC8VagZuqjGhsx5DHc3nbgAgXIK9zn8qsxWjYGFNdDY6Srby5CYXIGPvHPT2rSttNiGMgVooGEqtjmYbM5X5ecY6VbFkVK7genauti0uHcOnSrF3YWgjtzCPn2kS555yeR+GK05bHP7bU5O2tpIXSVH2vnjafmHvWnbWzEqdpxWqmniWQuFVCTnCjitjTdKi81fNBZO4Xg9KErCnVtqco1mSFIBOe2OlSG0kZdpTgcgeld/H4YjEUDDqykkY6HJq0nh5SvK5x7Vdjn+sI85Fh8iEKdxznj3q1DBLDbyIoKrKAG47A5H613l3pNvFBEEixIMhvQ88H+dUYtIMrP+7OMDAJ96lgq9zlorQFSrB9+RgjpjvVhbJQ7jaTzw1ddD4dBIYpV+TR7dXO2MFQSAeefeloJ1kcO2nKojKbmfB3bhwDnt+GKt29oy9QSAOldaNNhHSPNSwadDGwaSIsvPAODnHH9KkFVvoc5penQz3CpdTG1iIOZNhfHHHApLfzIZd0fBB4K8GuhSxUYwvPrU/wDZSIizZjcyEjaG+YY9RUXsNyMIQu4yckn9KngthkhlJJXgg9DWyljtBwgFTix869jjtYZJS+0LGBlixHIAHXmpk0tQUr6I0fAGkLc69HulFvtifa7nGCVxn9TXxN+0j4sOoePr3TnSO2tVJgtwT8xjU4B/4Fya+v8A4p/G7wV+yvaxSeKIE8ReNplDWvhaCUEWw7SXTj7vsnJr8zPHfjdvH3xC1HxDcxbBfXZnNrE5AVS2dik9AOgrx6uKg78p9RgMNUUVzqxa8O6fqcOuz22kXEFvfRx3CCWaVEXy/LYuNz8ZK5A7k9Oa4lYDhupJ4zXdQWGlXnhm+u7zVmtdYimQW9j9mLeejZ3MZBwNvHB61sfC34O6p8TdSjhtIJYLHeFkvGQ+WOeQD3OMmuCpTlNxUep7EasYJyloa/7OHwfHjfxEuoalBI2j2ZzJs4MhHJAPsOa+r4/CkuheI7G6EJg2W5jZD/dKrt/pXZeF/DGjfD7RrXSNItilvBbNEJejO5HLH1zUjxC8kUOcHpuc5/OvaoUY0oW6nzOIxsqsnbY52S1SW5jl2AzI+9XPG04Iz+RI/GntdFbcSO4zux5Y6/X6VtWE8mjalDdwrG8kEgdBIodCQeMg9aztRK3cnnSR/vZGYtt4HYjjH1roscHMnuUdERNPeeWwVbQPI08kcY2qXP3mx0ye9dN4i0Sy+IOg2cmUOqWLCdi4Hy7GDKVPc5FYZtxbPHEs6vG2HJAOFJ9eOoq3p12LS5RznYGG4DgkZ5pON0aqTTuj4g+NGgJH8YL/AEmyszM08xMNrAh58xV2qij3bAFeR69osllPJFLC0LrGWVDxhlOGBH4H8q+t/wBpvwta/wDCx9Z8YaUzadaytawWBK7Xj2xFnf5TwwZQM++a+ebvSX1pobl284ecyS+ax4yGyWb3J6+prwK9DmctD63DVk4RfkcPazmBU2kj3PJOR0PtVSeZ5p5d/wB8Ej05zXpHia/0y/8ACsFhbWkFnJpshktmSFUeaOQ5fewG52BxjJ4AwK4iPRjqSyyWcU11NHC880KJ9yNFy7lvQV5tal7PS9z0qc+fW1jnMSO5VVLEE8AZNM2vv2kEH0xWhZXNzZXf2m1me2mAYB4mwwBGCAfcEg/WtXTNIeTUrZ5HjPmLnzJFLrkjGCPXkD64rz7Xeh13sM0rS/tMMBWORiRiQ7flHpjH9a3P7Bt47O3ZrtGleV1+zhGDIoAwxPQhsngc/LzWzoGntJY2UakI6Fom3DHKMSOe/U/lW1qujxatHG095b2rJKUwQzPGCM79oGSnGOOR2FejGklBSRyud5WOTj8OQB0dgI1TLeaVJLdwCPwx+NY2sW8pmV5FQ7RtRVRQFGeM4Az1611+rXFk2oldJhu4bO3RUVbyUSSOMAszEADlskYHAxUdxp8V5bwFm2o//LUjO0ev1rKUVOF0rG0bxlZ6nE2Xm6bqVvcwqI7mFxNHuAddytkHB4xxnBrvLT4++M4tX8X6rJcwTXHiizls9WjW1RInRwF3BEAVCMDBA/nWM+hm5hnCIknkAcINrHHf3rPfSLiXR5tYWSGW0hl+zyxrOiTggAqTHnJXpyAeleZP3bNnfBNtpGPZzJcBrK6OYxyjHgqcdatXel3GsJFHIPNmCZivMHaVHAVz6ehPToani8O3qzz291YXYusKgjZCjqzEEB1YZxjtx1FdPa2seiypaJCkihSk0Ttuw3RhkHggjr/OuapieXTc7KOE9pq9LHDmzTw3Lp1w0sd++PMuLfYwEL7iPLYnhsqAcjj5uuay76RbPUPPsHkhiJ3xEN8ye2faul1zRzaysEDNHj7zDhPRT7ehrmLm2eLcqk7TyUPUV0wm3BHFVp8s3odLeacy6XpGpXDxqdSR3iMTgByjFWBx9x844Iwcg96xkklivJAxWGTLPtH7tenRQOhPp3rGJOME8VoWmo+aFiusuBwsn8S/41vKaqNXORJxNS50yKK2EwW5tdRGJTGUKAL2PPOT1BHFbPhbx6+nXMy3Nlb3sN3GYp7S5XCyZGPMjbrHKOu8dT1yCRWdrWp3PiV9PDjfq6HyhfmY5uF4Eatk4BXpnuOvSsF8yzyIy7LgMQUJGG9foc1jKEdV0N1OSszsR4WTWLK5lsJRKBy8MiAEH6D7rfThu3Py1h6NrGs+BdTN9pdy9rIMo6Z3LIndXU8Op9CMVc8I+JP7F1Jbrz57eeGNlQoqneTxslDcFTyDnP0rf1b+zfEMUb2lqtpJtUSW0TFgshOCQzHK5PQc46ZOKlu5uoJ6xZ1DavoXxytLCO7tLTR/EdjbJaRi0jW2W4Rc7cEDDMM/xc/WuB8W+FtR8L6j9jZLlMLlY7yHyzIvqAflce4/KotW8G6t4bvZbe8spoJ422SwuhUqccBh/C2OffqK+nvA/wC18fFnhK28DfGfTrXxf4Xj8uCPUp7ZTf2KKAFBYAFgAPvjDfWiFSnVfJN2ff8AzLnQq01zxVz5MS9iuLUWt4hMan5OPmj9dp6gf7JyPpVV4ZdMnSW1lkRgfkYDGfof6V9UfGD9mHQW1KW+8A6gLvQLi2S4tYruUsw3Z4SbHTpgOPxFfOup+FtW8OLLFqNrLaKrbfKuYiocHoRnqPdSRSqQlReu3ciKVTRLUzrfV4Ltgl6v2aQg7pkXKsf9pR0+o/KtKfdaW4TyY3spBuBUh0f3Hb8P5VhvaiXlE8zjPlsfnA/2T/EP1ptjqk+mbxARJbSf6y3kGVb8Ox9xzTu3qzJqxfk0toVW601ypbOIQx59dh65/wBk8/WrHiDxvqHibQ9I0u9cvFpjTNECTkGTYGyPX92tLZzWl0BJYMyXJH76xuOVcD0PGf0I7VQ1qZJ3iYH95zuDL846YBb+IehPPrW7irJmN9bGbRRRUgS0UUVvYdwoooosO4UUUUahcKKKKLjCiiii4BRRRTuAUUUUAFFFFABRRRQAUZNFFAC5NG6kooAXdRupKKAF3UbqSigBd1G6kooAXdRk0lFABk0UUUAFFFFABRRRQAUUUUXAKKKKVwCiiikK4UUUU7CuFFFFFxBRRRSAKKKKACiiigAo6UhOKSkAE5pKKKkAooooAKKKKACiiigAoooqQCiiikAUhNKTim0AFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFei/AtQ3i67BGf8AQn/9GR151Xqf7Odn9u8b3qYJxpztx/11i/xruwSviYepx4x2w835HtirGAOOasREZAArX/4Rwgj5T+Iq3beHyGGQfyr7xQZ8Q6iM+KEuBV6G2bAxWtFo+1R8ufwq9BpTqR8mPcit1CxzyqIx47V2Uf4VbtLNi4GOK2/7KKqPU+1W7HTDu6VagYOoZdxaF5pGSMqpbIHtSx2zggbDXUx6ZtlIIO0H8quDRQzZAJWnYwdU5yzsXlHCnHTOK6fTvAs92isCRmtC006VIhErMsRcOVxxnGM11thqUdnEsRP7zoMipemxy1Ksn8Jxf/CB3MbFgxfHUd6T+wWRkRoGUgfMfXk813f9oSQvmaPaD0I71Kl9aXTx+ZgHHXHuaLu2piqk+qOOtNAyoJAFb+naRbwJmfG0Hnb1qXWIlV3e1IdEALEGqtrFNdsoOQDxkdqQ7uSuyU3NuiIAcEDvTUv0UkbsZ9RUN34bmjjhc5+ZSSQ2c8+naoE0OSRRy28nHNOwlGLNVWtykbv0YHkj3qzA9iochQW29+1ZY0G4Kp1IOcEd60dP8JXM7HClvXJpOy3YWiupbS6tNoGAKj1DyS37tCqljjIrbsPh7PgMRz71qv8AD6SSRiAqjPQVg5wXUSjc4UIoTJJ68cVoWyQzQoGTaoJ3OFyScZFdfH8NZDtLOv0rdsPhixgzlST3A5rKVeC6mypyeyPK/secYGAfarcVmFV0X7vHVfSvSrz4byxRIdnG5uQOTXM+KzoPw70aXWPFOt2egaRCfmubt/mc/wByNB80j/7Kj61l7ena7ZtGlOT5UtTK03w/datdxWllbvc3EhwqIP19gPU15j+05+0FqP7OtsnhrwbpBHizUIgkviy4CvDbqw5WzGTlsf8ALRunYV5F+1N+2frEWlWnh74aRvofhLWrMTNrSn/T9RQkqyMR/qVBBBQc+pr5GfVrjUrU2+t3FzO4RTBI0jOYdoOEAJxg5GfSvPr1JTlySVl2/wA/8j6jA4FUoqrLVmXNqU+v+JZNT167n1EyTmW6nuHZ3nOecsTkk12vw7+Emt/EzX3g8J2Eo05ZBu1G8XCxD3PTI9BmvWP2b/2RNQ+J0qa54njk0rwyhBijYFZLr/dB5C/7X5V95+GPhxo/hbTLbS9Ht4bKyhG1IoxgD6+p96ijhrr94aYzMo0Xy0dX+B83eCf2TPCXhrTki1vTzr17Iis81y7KAevyqDwD716/badb6ZZW1rp9pBp1rbKY44LeMKqg9fx969A/4R+2JHz4OOQfWmS6FarGRuVicc+lepHljpFHzU69So/fdzz+O3ZWY+WH+UqNwyOe9RNZyMQBGfSvQ4tMtoIpDv5IxgdxSRW1srYUBsnjitLmXPbocANIkLNujP5dKZNoykAMpHPJxXo09tGHYEfN34qlc6Ws2FD/ACbske9FwU2+h53c6ciWSRC2Cz7y/n5JLLjAXHt1qjBp7l8YNemr4YVypWQqwJG8V598Y/GOh/BHwtLretXCtkmO1tI2Hm3UvZFH8z0A5pOcYq7Z0U3Oo1GKuzw/9rzX7HwV4ZgtpbRbm7u2b7KyzYCtsQ5x1cckEcAetfG3h/xFdaLrFldX0ZvLAvuntW6SIT8y49+a6Txh8QtY8e+MV8W+IgkqNIPIsmz5aRA5ESL2X1Pckmum+N3xI0H4vatoq+HfCGm+DYYreO3kSy+VZXxyzE968KpJVm6nNa2yPsMPTlh4xouN77vscBfNaziMxo4RUG9d28gkfeJ7cnp2rFNoIdPnn87YxYRJCCQzhgdzAjjaMAEHruFaosr/AFy8uLXTreW7DSIn7hCq9QiZUcDJOBn1+tet+CvgbE9lYXeos19crM01zZwghVjTcBEDjLvIwwNvAA965PYyrPY9F1Y0Vqzz7w34Djufh3qepy2RF6t/HFHO7sCsYiJdAmMHJZDuzkYAxzVzwl4bjvLu3NxExS2u4lncjKosgdV4z/fQc+4r6Xufha2jfD670y6eJtViK3tzaoDlWkB3FcclQfk9to9a4T4a+HtN0rxPazarFJc6PdztpOrrhgsccgHky7+zCZcj0/Gut4KNPlOWOLdRScUUNF+GOrN4bOuWNkbrTl1i8UrGNzxiNyH3D0w4x9KxLzwo10YJUeO0tPNeMX0+Qm8Lu2nGTkjHbvX1H8DbH/hBJ5dTt7g3mnal9tlubC65jQySDYV99oGfWuS+M/wXj1C1uvFPhWMNZw/Pe20PPl5/iA9K3nhv3Xu6M56WM/fWmtD5d1nTIbJ4HjkWdnQO3lhlAz95MkdRxnGRzWTY3H2eee0mwttKdyPI3yxkcnt3HFd7rHhy51MR3ixPCqoqgrFtUAYXeOx5HJ7n3rF1jwtA5hh2SW8oBzcNlkvG3YUIoHycepr5yremr31R9PShzvRaGdD5tvrW2XEV3AcSRSLgSJ12kDvgjvzTNJ1jw3a6L4zttW0BbrVNSiQaXcREI1hMsmd3PVGBII6n5a6fwVoV3pmtJq0ejxanJprl57O8hZ4VIO0bwCOM479RWb4p0mXUNVm1O4wxuZScoqqVc8lcDsOf0xXz1WuqqcZPrsfS0sJOmlNRPMLm5ub64kuLuee5lYMWlkdnZm9STz2xXZ/Crxnp3gbxrpOq6volt4jsLKUNJp14p8qccjDj2/mB1rufGXw50vwR4W0260bxQZ59W05012xeIZsnEoxBnkksFVu31rx+4tFs5mHniWEk/eXkg9/rXPGdPFRcXoiHCphpKZ3v7RvxS0X4mfEi71/w34bj8MaRJDDCmnQbQE2JgkhQByecf1ryzyY7wGUfPHjBZQcx/Udx+oqe4tHTMybpIX5LDrjHU/Sl07TL8Ca7traUxxAGUxoxQA9MkdjXbSjDD0o009EefU5603K25z13pU8EJmdMRFtu8nqapouxvm5Xviu+1DSEvdGiv4dk8LkpJCgJe3b0P16jt/Tj5LQhCuGPzkKCRnH07V1vTc4ZRsOt0fDiFvOhJwquOWPp7N/Oprdba5uEa5cRpgqzhM7WxxuHpnr/AF6VnWd3LZTM0eCrDaysMqw9CK6iy0qz163eaK4FnJkKJZTlY3PRJP8AZPQSevDetbxjzxsjG/K7nPXDzJL++bcw+UTLzx9e4q1Y6g1nMrluDwR1DL6Y7j2qU2b28zW11blZDwYyO467ff2NVLq0+yFXRzNFkk4UqU56ex9qwacXZo2i+qZ7n+z/AOHdG+I3jvT9F8T+KV0Pw1fzCG4u5Jgrx8gqnORhiAATwDz2Od39pr4ceHPhv8VdQ0nwRcm+0uxWAi7d1m3yBQXZSMhl3cEEnkGvnOzvZbKVZ4G+70Ycn6MO4rtrfxMniKFSFKXSn99aK2PMH9+M/wB4enf3rzquHcpKpTfyPaw2JSThVZ1XgH4s614W1WUeeJdPmcvd2FzzbSZPJUDmPPZl4HQivo6eXSPjX4TuY5bm5u7SCEP/AGRcy+ZJCy/dKHuvoy/jXy1pdhBcPDOXkmt5H2iSLaHVjwcluAfrwa/QH4YfBT4f+Df2UbzxxJcWs3ipoGminluAPsrrJtARAflJxkjv9K8bF5p9SUVZu7tY9mOEhON6nXT7z4I8f/Ba80q5e60lJpLLdjypuGVvRW6Z/WvMr60eO4aG8iktrhf42XDf8CHf6ivtDXfH+n/Eh0i1JIbC9jb/AJcxtikwACVXoD/s4z7muG8VfD/S9Sj8i5CX1sxPk3EfDKfY9j7V9Tg5xxOnwy7Hy2Y0ZYT3/ij36/M+WriJoWVpORn5ZYzwf/r/AK1f1Wzu7SO0NyY5EkjEkU8bh96kA4LDuOhB5HevTfH/AMAtf8BW1jewMmp2d7CZxBtxOig4w6d/UEc15LNsDlUV4sH5omJO1u+P89q7J0Z0dJqx5NOrCr70HcZRRRWJsS0UUVtcAooop3AKKKKLgFFFFO4BRRRRoAUUUUrDuFFFFFh3CiiijULhRRRRqAUUUUXGFFFFFwCiiii4BRRRRcAoooouAUUUUXAKKKKLgFFFFGogoooosFwoooosK4UUUUxBRRRSuAUUUUgCiiigAooooAKKKQnFAC0hakJzSVNwCiiikAUUUUAFFFFABRRRQAUUUVLYBRRRSAKCcUE4pvWgAooooAKKKKACiiigAooooAKKKKACiiigAooooAK9t/ZHuLe3+JOoG4ICNpUijPr50P8A9evEq9x/ZB8EX3j74lalp+n/AOvj0iW4ODj5RNCD/wChCu/AO2Jg/M4Mek8LUv2Pr9ZtKcBnI/Oni0sbkgwsMe9VoPhDq2mtJHcvIXHRStTWHhK/t5GiaIketfoqdz83fL0kTGzigjlXYrk4w2fu06zgW7fy8AGuk0/wzItu4e2z8vOTV2x8NBsOluVI4qrmDmjF/sUQxbipY+g5p9tbw5A2EV39r4blWRd0RxXa+GPhvH4gcRNaCPP/AC1YYArOdWMFeTMk5SdkeSW9rb5JKgnPet/TtGhlj8zCgHt616Te/DLTNMu5LaRvNnB5CjirFn8PEiG9Vwo9TWPt4NXTJcJbWOKtdILwmFY18ssHPy88e9WJPBEeoY8sFZR0xXo8fhuzs9PeZ7pFdDgx98VC+orplvHNbWLzIzFVlxwTWLrNv3CfZuPxHkuqeHNTs5BbTRME/hbqKqy6DeaYYZLm3kMezlgMjqa9O1W6vdUkD3Nu0MJHEiDlay9WifVZ7K1tLw3FvEMTZwG+nSuiE5O1zJySZj6BpttrxaO3gLsoy+RjAroV8D2dqyEYJ7ohwav6HZ6Ho2syWyS3NtvC7jKuBkjtXoNj4NsrqaOWC7884yNxzXDVr+zd3ojojRdTSOp5fD4Zt2aMywyOBnjHHWtg+FdNW2DfZWXPQha9Mn8Lx21pbtuQctnIx3p6ac0gG2DzUHA2jIrkljObVM6Y4OUd0eZf8IrYW8UcrQttOcfLVq3063ditvEV454xmvT5dHWW0TfbjjsTgYqqmjWYhYPEYc8HHOeay+tc25X1WSdjjYtHuAAEXAIqV9MugzFpMfSu5ttP0+BOJnGRgZFMOm28khCy+YfTHNZfWTo+qdmcNJbXMSRYbK8nr1rUsl1SYRxWqkseVUDJNTeO/EOg/Dvw7ca5r8/2bTbYZYRFXnlOQNkcecu/P3RzXj3xP/aq0L4U6dp3xA0DxPZa14d1mGGL/hFZosX8cWSr3MRB+VlJy0bjDAdQamVZyXuq/wCR2UcBJu83Zfidp8RvjhpXwLv4B8QIL220ydQbfUbaMPaNJ3ikk6o34EEd6/L39uD42w/HD4sDVNLeBLKziFlFZwzF0QAk7x2BOecUn7VH7QOtfE3xHeWy6rfar4YvttxZvqqFfLYZDGIcYXPHSvnOMGe5R4WjuCoV3R14BzjB9RU1OWFrat7/APAPfwtBQV7aHTp4q1XxPomk+Fl8q5i0wzS20iqqMm75nXecZHBOPyr6/wD2S/2SYtVtbfxd42t9sGBNY6dOuWkPUPIPT0BrN/Yi/Zai8datafEHxXokS6BZcWNoiEx30i5/esp6qv5Ej2r9CrzVtHt5AkWnNEgRQFVMDGOK7Ic+jlqzzMbiVG9Km7Lqc7FbrHEAtsrJGoVVUYCgdBVH97NMqpBs57CuvuPHehaRpk8txBDaQxoZXluJVjCoByeT0FZ0XjbRro2s9o9rNDMoljaKVXDqehBHatlOTfwnhulZKV9Di9Rs3tivzyEkZ+UVmDSdRv3cQpNwN1d9rF/DJby3UzRWtuij5mPeuT0b4n6ZYzzBb+JhgrziumLk1ojBR1H6F4b1GUSCRJRleuOKvweGr62uI5SuQpyFYVsaX8RdPurd9moQF8ZwMZ6Vc0/xW13OqrGsqE4L9hWcpVNbo6VTg4oxNZ0m6upvtOzBcZIUcCst9Kuhb7Sv8edw69Oler6g+22icIiRMvL4yM/WvJ/jN8bvCnwW8KPqWu6hF5zbjaafBg3F24H3UXsM4yx4FYqvZXZqsM20o6s4T4vfFbQ/gl4Uk1vXp5CWJjtbGM5nu5ccIg/m3QDn2r4I+KL+JfHcFj8RvHTso1Iv/Zmi5wIoQx2EKeVi4+rEEntWN8R/Hmu/GPxbP4w8ZTMFYmPT9LiYhIY88JGOw9W6seazNe8b3HisW9vql4832SNITKzFm2gYVVJ6kKAPwrz6uJVR+9t0PqsHgFh1teT3/wCAcbe3h1G/Ml2+AOBGnp2Vf88V678Cf2cdU+Ml4dQvC2l+E4pNj3oX558dY4Qevux4HueK9p/Zg/Y90P8AaA8Up4jvIZdE8BWqqqWs0h83UXHBWNhyIx/E/cnA7kfoPH8N/CPhuyg0yxihtre2UJDbwrhEQdFAHAFKnThGfvu/oRi8XNU+WkrM+Urr4MaTovg220Lwtp0GlwWhedGAzJc3BQxrJI55YqGcgnoxGAMVa+G/wybwTrFlq4iha+skwVdi8csjOzFgD0Cp5cY/3Ca+oR4c0lpEigh3FjhVAJyTVq/8H6PoUif2nJBC2eYS2Wxj26V6vtqUfdSPChDE1U9dOrPkj9oq21KDWNM8f+HbBZIraGS21Swj43xNglsDqRj+tec2Ph3T/iFCtz4durVrLUIDC8NzcNFDBKcbJmx0ZCM8ivtK+h8NYmtXtJLuA718thjhv614J4W+BmoeCfiNd3XhyK3HgnWW33cFw202TdC4/wBn6USaa20Z34WXL7jaclt5+RzH2eTRrO3sDdQXIt1CtPCDtY45+oz3rf8ABGtaZoWoRzX0F5c2DBo7qGCYRiTP3fw9QetaniLwsbLzRbiCXEu0SLknaO49qq+H/BS3V9HDIDKjqeYUZnU9iRis6sY+z6nq4aM5VL2RzPxI+HlpqGuQXOi6VNpmm3EZlt7R7rKCLPzAKT0Y5Ygetbfgz9li2+I11BZQ6O1zBAvnXBF6u6HPGF45zx1r0PVfhjd6HrEn2eC+vLFFBge4iKsfl6kdu+B07GvX/wBnqG28E/aJ7nS7mG5vY9iSA7vNUHcWI/hI9PSvn8wwvPhf3T3Pp8DjJUKz5oq/TscD8O/2bfCfwg8O6nF470y1nvb5vLtZ4nc7kxnYdpGcEA8184fFT4SPPHHNpHhaKydvle6ZoypzkFlUHoQe/I+tfSX7W7ap4htB4g0izmv9MsxtutOJ2yyBc5ZO4I9O9fL/AMNPjboi+Ioxrel6hqXh2K2kaSzRjLJwhOQPlJwR+A+lfj2JwOPwVTnS08z9NwGJw2IoyqVJ3m94rp6HhV/4K1fwTcXUFtYy3kFzPHIJ5fKd1eFt20bgRjdgkY5GM1xGo+Cp75z5mmXjNvLZ86McscnovrXrnjjx9YT6pMWs4JdGuJGWGaKTAiyMj5gTk42gnnOO/GOK8H/EWy8AeIINT1zwvY+IrK4tJvItbmVjHJvVkWVeP4Gyee616+H+szSk0cOKWEg2lqcTH4Ov7IyJFp9yVfKtG0qAMvofyr0TwF4l8WeDfgt8RvDOm+FoZNJ177Mt3fT3Sb7MBzt2DurHjnofrXlWsyyoPtVofPstw3Tb3Plls4R8DCtwfqBS2njC1sPDWqaY9qy3moPBtvvPJWOJdxkjZMANuJQ89NtdNSlVqxUJ2eq/P1PNjPDxbkro5i4Or2L5W1aNWJDAldrD0IzzSXlhb3NrFc3qrgkgwQyr5kY4O7jPHP8AP6VHq+lOFtY7aISyO2xdmecngc9c5GPyrOsrJrm5VVk+yOjYJcE7cdTwOfpXuwvblbPnaripOSRi31ultdSRx5KA/L827Ip9rdT6ZcM9rNtLK0ZIHDKRggg9QR2NbX2cSTo6yAb8lWC8MoOCyjrjI5TrWVdWjtGzs6NJ5pB25GfQj2PNbXtscVrminiWGWL7PNA8lsm0J5jbpAuMYLYGcHJU9V6cjip5kt43gIO6OYFo5nA2yf7Lejf54rnVhLBs8MOvvWtY6Y8sRG5mjPJXtn1pyrpRtI0p0Jzl7hUu7VrKUyxLtHO5G7etaOi6euqIxtJRBfIdyKM7m9fwqzDcaUujala36XcmqKY/sBjK+WPm+cSE8n5fukcgjByDxTWwu7A2tzEs1peEkxhxsLgdGUng/wBaxmuaPNFm9NqE+Wa0NK38Q3mnXTC5jYS/dn+XPmf769/r1rqf7flvNGKWd9IlsOXjDZ8v6+q+/bvXL2muw6nMkWplbS5yR9uGcMf9vH8x+NZci3WjXZktpWtpeoCn5XBHUHoQR2rjlh1Waclqj04Yx4eNoS91/gb0Ou3ejyIl4pktjykyk/L9COcfy7V6PonxL+zaSRKNxjAaOXIzJzxuxgNj+8MMO4NeTWmpx3c/lwW+C0R821kYbC4+8Yx2452/XFPXFqiy2MpaFiGMQYgA/wCyf4SK9GlDquh5NWq232Z9BeGvFcPiXfm6luLtf9YlzJvlH+I968y+PmkW1hd6TcxW6RT3ImEroMF9uzGfzNcO948N4t1GZoJk+f7RA21lPqccA+/Q1o+PPFN34jsNHju7uC9a2WTE8YKSndsyJFPQjb1HBr2Xiva0HCotVa33ngRwvsq6nTen/AOPooorzD0iWiiitgCiiigAooooAKKKKACiiigAooooAKKKKLgFFFFO4BRRRRcAooop3AKKKKNACiiijQdwooooC4UUUUaBcKKKKNBBRRRRcAooopXAKKKKLgFFFFIAooooAKKKKACiiigAooozigAozimlqSlcBS1JRRUgFFFFABRRRQAUUUUAFFFFABRRRUgFFFFIAoJxQTimk5oACc0UUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABX1P/wAE5/B8vjT42a7a22tyaDeW/h2e5t50ZR5ji5tlEZzwQQxP/ARXyxX1X/wTfgef4462I4XmceHZ2ARN5H+k23OK7MHf6xCz6nnZi7YSo/I/QKDSfHlncmzumsNREaEmXULd4Mgekigqa5GXxVdWeutY6joSRoxOLm0c3EY/75BP6V7hpfiDxJY6W0MVrO8LnYwMA249DjmqOgQz6Hqf26Dw3bG4R93+oYHPrX3EarV20vLU/Nfduro5Oxk8PeWHute0i0Dj7tw7xN+TKK0bSz8JISYdXkvpPvEWCF1x9a6TxPb6p40Lx3Wk5tJfla2ljLR/huBxWb4U+AOn6bBM1tZy2l5ljGzsX4IPHUcewqPaq15ysHLHaMWxk+p6c0sL6ZDciNfvpcj7/wDhVq/8Q6neXge2t5Le3TGy3jb5Rj3rV8P+CNW0aRVutPtb4uMhkuTbuPbbIMH8627LWba3lVrzQdVtQjYbbbLOuR/tITWMq1NfCuawKlN6y0OJ1DXNdmuTI9gzbuoTFXdNl1S6icmxuI8DOCeK9C1jxBoFtcTSrIjME3iJo/LPToNwGTXP/wDC0NDtpwklnqCRt1d4QYx+RqI1ZVI+5TCVKMX71Qxg927xr9jb5uMHmtBNKuJoI8xpCoJ7/wBK3bf4keG7gxobuwiDDEYZyrMc4xtxW2NQsCUcW900bngx2Mxx+S9KyliJR3hYn6spbSMG38NxXVqonvGAUAYQDmsnVfh9aJNBLYxyJMTy7HG78K9LhfS3jUiC6QlTnMDDPPoRxTzLZF1+SRAuCC8TcHP0rkWOnF3Vzo+oxkrXR5PqmlKJvslzMfKUg7fLJyR71xnjv44+HfgvftYSz3ura2i+YmjaYnmXAGMjzOojH1yfau7+NnxW0zws8elaVBFq+syFSY3JWOIFsZYjknP8I5r448U+LfHl54/ju7afU7dZtRMS3Wn2ElvaPtbBJbaMgj1JJHU172FoTxVNTqrli++lzGNGNGq1e7XY9gsvj98Wvijp39sWmm2Pw+8KQylfNurOW91C6PUhI9uQP9raB9a8D+Jf7Znizw1q0g8L6zqF7yrmXxJHHE9pNyrLB90bOfTPr0riP2l/jZ4k1Pxlp+nWetarp9lpaAJN9paKSWXOfMZVYZbOACa5PUfjL4j8dqkus6rHDdtK5LrErCdyBjzfNJjAJz8wGepxWcqMKN4KC/M+gpKU+Wr0Oh+Ff7WPxYm1rxJJb3GqeL9avbOVbWEyS3QtZi3MscKEqcAnsQOCK9v8E/tK/GTwho+lnxjFPeT3ixy29jbX1kNTdGYhd1pMN3zEdMg+1fPsfxC1vwH4Yt7/AMY6rCJrtnj0nwxobJZW06K203N1JbhS0OQdqhsyYzkL15bw1491vxb4vu9W1G9tZ4LGP7RBbWlpGEjdc+V5abRja2D1z9a4lH2j5ba+h3ShH4mtD7+8X/tf+L/Dl3Zxax4Y8O+CUnCukPibXFa7YHoTbWysefQkV4x8Wf2n59A1tdah+MOt3cOoRMU8M+FrNYIrVsAMjSy5bYTnH8Qzxivlzwz8VdVsrVrHVrmw1YzXjSf8VDaC6SHcAHcBwduck8dMHjJqzf8AiXwzo/iLzLnwlBrK20jPaxW91MmnyDJCSGAnLKxAbAZQRxilGhCnG7C3vWSO7+Hn7RXxBn1bVPC/w50GGO215ytnZPGb29Wdz80wkk3HzGHDN0xzxWL+1D8NvD/wgTTdG1XxM+s+PoYlkvtOsLX7PaWe8BtnQh2JJywIz6Vci+MPiv4d/DD+1PB+j+FvBk+q3c1hPc6LEy6o6BQx2l3Zo4jkrlMcjFfP2qtqXiu7S6v7p7nUJpQGEm55ps/xE85OeMdeazkqkU1+B0Q5ZPm2JLXxVc6rr/2y3Ww0lLa3fyLedQ0KqqECNQwO5jkgZ6k9e9c1/aItLS4iiCI8uA2F5OD0q1rOmS6HfyW95E9lPFKA0cysGTjP+Fdf8Lvgb42+Mtnfr4V8LX+tCFWnku412RLtBJUO2AzHsoOSa4Xzt8r3Oy8Irm6Htnwy/wCCjnxM8J6XBpN9HomqadaW6Q20EmniHAXChQYiABjPJHb3rV8cf8FA/H+sWd/bW+kaf4Yu9iiH7NZmSQnj7xlPy8dMCvny4+FfiXwPMlxrPhHX7eeJS2JtPkVI2Gdp3EEMAcE9sZrR8Yajr/xW8V6j4juDfa9deXHcXt6bIxKNqqCGHCgDAUeuK6KbcYtvc5JUqVSd1G6Mb4hePvF3jK9i17xNrFxqGoPm3/0mdXIUDkBFwEXngY55rW+GPjDWdGvrcWmpX8InmWJbW3cgOoGeMHIx+Vcv4k0691uXVfEFvoq6dp01wcQwxmOGJm5EcYY5OOuBnA61z1hPLbX1vsDmQkhhHkEZ4wazVV06qktTo9lGdPlPsDR9a+KWkafeanqM/i1dCCbbma4tZLi2C5JIZSOQBjkevWt/4P8AxB0/4gWeqQW0LWepRRLiwSJpnmOeWDdEFdz4D/aotPDvwr0LQNUv764vLa3WCYbFKHjpk9eOK+d9P8R2+h/Hr+0vBn2u0sr8uJI4lwVJGWGF4Az0r6F1mrXskzwFS53Jcux9MaLoOt6zczWsOizW0qoAGZtgbj73rmu80nwFd6RaLFqnjWfSwWyYIyGPt1r5z1v4s3vhrzLi61k6etySI5Z5SGlw21gvc7W4bA474qjF+2DZ/DTT9aspoW8R+ILmY2Dq+3yktzE+545/mG7zDH0HKgjIzxhXxEaa3uOlhZzasj3r4u/tOH4FeDbWHRNcj8ZXl/NPBFDeTLELZ49u4uOrD5xjGM8818IeL/iXr/i/xe3iPxwv266EiTR2l4uyCWHORFHt6JxxtJGeueaXwV4D1rxHcXniP+yV8S2Omr5+rafaEG4t4iSS2wnL7Rz1PHesz4m6/wCGp7l9N0ea5u9JKJcWMUsbRG3kb76Lu6J3x09D3rxqknOLnLRdj2qFGNJpR1fcx9a1C48T6081pH5rXMjGMKdqIhPA9vT8K7f9mn4F/wDCyvG1xfeI2hTw1pcgaZGmKreSdRAGHIBH3iOQOOprkdB0W48ZXOiaPFO1pbWw+0XUlrCAYUY53FurOegzwOK+ntP8ZeE/BVr/AGT4W0e40u1hKFftxSdyeNxJHLMx5JPTPSqwuGhWkpzV0v6sXiq86cXGL1f4H6B/A/4mWd9NHpdta6NZWFpAIYYtPgbZGo4CKFBwAK9fu2jvJB5NsJBj5ibRgPzOK/L3w/8AtMaj4U8QfZI9ZXTLB5XdHDi3UryfunBPAx0yfxrP1L9v+z1Oz1B7S516a8jO2OBkI80+oJf5R9Rn2rSvh6Tqc6mo+R51JVVHlcXI/Qjw34v1Lxl4i1nw9qugP4OvrRs2ZOHku4x/HG4G3oOme9YXiGHQNBuXfU5brIJy1wQCTX56eH/+Ch3iu3mjtbOTWls2Uo0MximTnqSDz+teleFv2k774iRSteaxpCWojdWja0DyhwvyqycMuTgZGR3rTDqEp+7NfIxxNGso3UbH0rqXxA8DwzM7XW5eBhpOelbXgrxV4e8V+ILbS9M0x5WkODJOdsYx2Of5V8XHWtZuJdRYyaDOiR7082OYM/shVTg/72BU+jeMPGelzWt3Z2bo4IdFtppAevPJGK9h0IuLSbPPjCZ9yeJLVvDviG8s7fRdGiEkZVmmlyCp56fhXO6P4svtL1CPb/Y1rFFudiEI3KO2exz0r5+1X4ha9q3iye+Ph/XDAAjW0jSCZ5AOpfBAXPp6Gsrxl8d3064jni0VtMuxdMrm4tGV4RgBXaY/Lg5PTpjmuf2cYwtLU9bDe1pSuz661n4t22sXMV0mpWMaqgBtgSzOw65IFZtx4lu3sf7UsbOW5hkYpmENsUkZCZPf1r4Z0L9qnUNE1cXsNjaylMhHlaPdk5BYccHnOa7Wx/aY19fCGoa3JrFktzb3kUcWkmcB5w4O6VEHGFwAfrXlTjQoR5eayPd56td3S1PorVfFes6pDd2J0O4XUIQHkR2AG0Lnoe+CCPUV5Mf2ZtZ8T+NLbWtHgGisZVfUNPMoENyCw3EL/C2PwPevIdU/ay8SXl4L++s4vP8AmjdApRhg4UFjjtivQ/hp+014i1hobSLTLb+09RmS0hbcztbksBuODx1HJ6815eIq4WVNqTTW+3U9XC0cVGacNH6nA/tX/s26r8NtW1JvD+ln+xNTZV8lY/NEDZz8vB25PQjBGSOhr5Sv/C1/ZXU0V1BNCYZlj2spJU/7BxyCa/Sb44fHf4ifAPUrC11GDRdUmuITOjjeRtDbTkMB3I715Zef8FA01nw7fafrXh3Txq0l1FcQXGnwpiNYznawb7xJ5yDwAa+Sq/vGqmHtyS6n0sJOKUa2sl5nkPwO+BR+K8HiHQtJ1eHR1nsoptQfWlUi7mSQti3YY2Y45OTyc4Br5++Jei6VpHiC/wBP0hbh7CzKxi4vFUzM44YEKdu3cCAR2xXqfjXxppF94+ttWuLXU5YbjOo3djYusSyQkFm2Mp+Q+vpXN+BvBVt4j03xFrGsPLbWGmWa3ge6m8lxvkCoyRkZnHYr05zmtKOHhUkoRd5d76GGKqyprmt7va2pwPhOzj1u4XS7jfIsrBI2TA2tnjOegrT8Z/DzVPAfiHF2ySpgGOeAhkcH1I71ueJ/GunwaPpOj6d9mS3sQ8kdzFZhJXeQgt5j43NggABicdqzfBniy2v9Rmg1a4Oo2gPm/ZyxVCV5x1BPPGARn1r1eWhSjabu+jR4TlWqS91WXY5iPS7W7vYX27YjIrSqgCscHO5T2bqPfvVG9tbbUJns3Co67jC7Hoc/dJ756/yrdv7kw3qs0cdoLjMqKF4C7iOBnsQRj2rB1CWK8iYeaglfOFU4J57+/cUpqMkuVmcHJPUz/siQvbwskasq9x1ye5719R/sZ/s66B8dNY1y01i8ubSKxtVnRrTbyS+OcjpXzDY2lzql3BZyRNJcTyLHE4H3mJwCD06nBH413/jXw74u+Ania40O/mbTL/7PHMfstz8rxsNynKn35U8g18vmVCpWg6FCpyze3c+py+tGmnVmtNr2J/2i/hXpPw5+LHiPQNPklntLG5MMckpG4gAdccd64xtZtddsLHTdd3NFYxGC0uVOGiQkthvUZJPNYOt69d6leSXFzcSyyyHcWdySffNYc07S9WY/U124SlVpUoxqSu0tTkxmIpVJtwidVr6f8I3ozaLJp1tN584uk1LlndAuAqN/COSSOucZ6CsO11Tdai1lUXFuD8oY4ePPXB7j/PFLDrZk08abckyW2cxk9Yj7H0qld2DWwLDAUH5SP4h616kYJaxPGnUcnr0LZsZY/NkZXZI2UCfbwM8qCfXg/lSQ6gUeVJdoklfc8rZwT64HT61SivmjURuA8YGB6/n/AI1dhsX1JC8EfmxqMnbgFT/nsevatVZ7bmF2XbfVBCyOzbZMEK44DDv/APq6VL4iW1S3sVtrcRkBt8qOdsh4P3OdpGccHB4IA5rBBeCMrjzoCfy/wNSGRWRFSVnQDO1xyp7j3FU30YuolFFFQUS0UylzWtwHUU3caXdRcBaKTdRkUALRRRTAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiik3UgFpCcUmaSi4Ck0lFFIAooopAFFFFABRRRQAUUUUAFFFFK4BRRRSAKKKKQBQTikJxSUAHWiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACvrL/AIJp6M2tfHnWY0meExeHbiX92cFx9ptht6j+9+lfJtfVv/BNrULTT/jzqguZ0hluNCkt7YPGX3yvd2oA45GF3EkZ4U114R2rxfmefmCbwtRLsfqdpfhxYbPyk3qEYHfJM7sPrlua6K00+8t4ldblBG+eXDHkfRqo2elsiIh1ieWThdtrpE0iKP8AebHFdB/Zt7NbrG2q3rBOhGkx5wfxNe/Urrp+R8LCjLrv6j9Mtb+aVf8AS4N5x8sYkOR9N1WtWU6HCLnUtXh0+EuQpuJQgYnoo5yfwGaxPEHgfW9fsrePS/Feo6U8I2yK9msST89zHhgccZGfpWhb/CrRLaAl7Ke+u2dZPtE108siOB/Az8r3rldSGjcvlY6lQlbSN/mSaPpEniPz/tk0ljY7z5cp1B2NwpHUIeVH1x9KmbwvY6A4Gl3FzDNjDXFtCu5vqWOK8q+I+m6B4a1U2kum3icBmvI5pUAPoPU/pVnRdYvbwLa+HtfXUI0UljeZXavYHeefTpXZHCznBTjL3X5afqcc68ItwcPeXW+v6Ho6WmuQwzR/aYtcRgNo1MRlV9eASc/jV7SPCGmXVjm/sbW1u2zvFkGjQfT5jXCR6rrFsrLfHTZY1XIdVUMT7jNPtvHkVv5qywbVQDdIsUWw57A7ufyrGWHq/YevkaU69JfHr6no0XgTR5rX7LKkF1bAt8lwiv1pk/wq8OyhMWohKD5WtrmWIj/vlxXCwfFvw1p+8X08sDIQHC2isBuHHKk9cV03h/4o+E/ENxb2llqQnnm+WMLCwyfQnGBXHVpYmOruejTqYaaskr+omseELbRoAtveasGKnaUunmbPsGY5rlfEBNl4Xvp3tdRvr6KGRreKXeplkCEqoCsBkkDrXpckNjqSyI1kl1EAVyync3OSATjv/Kub1/wPBsM1hDcQY5kV7otHtxz8sm5cfhVUauqUzmrUvtQ+48M+A2kXHhHwVY+JfFOv6dZeL9SDSzx6mrXElmhJxGFDYD92PXoO1dB8RPHOj+KfCuqaPN8R4RPdwtDEbWy2+U5+64+Yng811z/Crw3f6XAkrNaToSTMpicEE88DAx+HFUoPhJoGlaqr2uq6H5ayDdDcRKG57Eg5zg166rUJ1HVqSfN6L/JnnTjWStCKs/P/AIJ+V/j3wk+ieJVgk/sjWLqLaraol68kVywYsZGVhnJBAI6DFZ1p4Q0i08N3WrXGqrqE9uiF9IgsnRZJDJtRBMTjGTyQPu5r9UfEP7PthqQtp9LXQxcLv3Nbqq+ZnjHOe1ec69+zVHFohtrjwzcsr4GbSY7VJByeGHt+den9Zw+I97m1ZusVVpJRlB6HxP4fk8J6FbW02ryS3uvOuZ52jjkVW/uRBs7UXoAPSreuahouraZdwaBNPbawsDMry2IIZRlijFR8qkZOa+s9P/ZQ0vULaJdQ0F4TCzbJWiKMQf7zbjmtiy/Zf8H2lyqXWkW195nDySzu7qemDh/09K7fbUIx5E0cssbFS52mfmXoNjb6l4gttM1eYaNaglpbm1tzNIpVCc4JGWbHr1OapX9uNI1gMIPtVilyY8RXAb7RsIP1AIPXpnOK/STUf2ffhn4M1O7ml0fTYYY2O6a8RiiHud7Nj8a841Pxf8MbfXHh0K10meZWIZNJ0M3R49DwK5o4eM1o/O52rNOZ3jB2Pnn4lQWPjTwtB4h0vw5Y6N9ovTbDw5p4uC1sqxA+aHKbSrHsDnOa8q0PQPHnhzUmutF0u/hlb5VmNoXKj1G5eK/T/Q/GMK/D+1aLw9H5T3DBf7QtI7I52/eCqxPp2zXC+J/HGka/FHZG/wBJ0m7SNnluSl1GiKoJJ+dduOOTwPrROHtLOV1bS+hnQx89YRgvmfnnd+E/iBdalJ4hv9CuL6a3b7RJJfWvmKxHHzIeG6jjBr6a+FnxG+PNn4Xt5ZBqejWMahbOwstOhgNwewCuFWJcfxHPsDWZ4x/bGtfCP2fSvhlbxT3eSG8Q6onnzzEcEwx8+WuegAB7k15tafHLx3f3l9rXibxXrCXqFRDZnMIm3EgkApghfSvPjGHtHyt/M9uXPUpr2kUjtte/aw+KfinTrpTr15oem2qybw99uklYA4Qt1JYggAACvFPFXxBu/EOo2Ed9CNcgmuI7qeKYv++kKjMe0NgKCSF24PX1rU17UrXww1sdT8OadqWq3V6txI95NjywFO1WSNgGB3b23DqFHrWbrWrado3j8SQWi61pT2pQgzeUqPtyZYyo+QqenGO1TWmoxfL0sdNGmk7W3PT/ABn/AMK713wjd6tqTHSNasUih07Q44JJLfZs2lBKzEphsMc/7XPQV5Bouj/2xr8Njp+nahOkkUpVYJ0cBgpO8M4AAGM9e1JdatYa2dWstItFvbYOHhudSnbzI487jhcgAnaAW68kDrXT+CLzV/BNrdapo8GmrezWhkjWK0lv5IAzFSVTlY2IUncx+7yK5qtWNaTaVka06box3ucn4f8ADuv3mrRWun3d/e3dynnITcpHENv+sDgklWHTGMjrjFX9V0GLQtSt7LWdXfTbwPJ/aEMl3I7QkANEyhR8wcMMccMp6V1vxE8Nt8L/AIdaR4z1a8ju/FfjAJeaZC9uqNaW6cPckKcbnbKKem0E4yePM7NZ/GfhfUZzFBLe2zJdqbe3PmzbztdcryMYDc8deOa81uK0W53Ru9eh1B12HWPBOpW81tcanbxXI+y311Olokc7DDvtwWlYqF3AnoATziuMhl0xtK+zTTKJmugJGaBPLWEDO5SfmL5428Aj61mR3Nu9xZtqQuxayKJHIkG5lPHBI6j3647V2PiGxuvD2iWy3tu58N6wn260+0wKCV3sizQqpBXOw5UnGRz2qXL2keZdAtyOz6lS58Yrpuoyal4dvJdKaM7VaDNvKUK4kztOFDnPyqcccjmuVjvJYmkuZ51nE0bxuADvCMcYGRgnHIxUC6a91iO3hmuZ3O23i25Zznj5Rzn2rpn+CHxAXTzdDSRLE6jEInRZAB0+QkGsV7Sd+WLfoa3hD4nY5C18Qajo8zzabeXWnB/k/ckgOq8ZPP6ds1rxeNdTv7Lff69evL9zYBkgBTg5+vH45qzd/CPxjbabDdyaPczSSu4a3jAZ0AxhmwTjJJ49qr2HgXxRfXHlLoksDFQFadxGoI6k7j3rJQxEXZKS+8056Mtbr8DPu2ZljkmgleWUAiSZjvb3Ge1dTbeOrTT4rKexsfIv0tWSe6kcMfPJOJYwANhUbMdeQT3rntTh1UsbfU9OvVlgAiDbTJtVRwOTggdsdqw9RulEnlxgRiJRHzEUZh/eYevP6Cm6kqVwUFM6K2gPiPVrO1gu4bZ7xtmXYuodj/H0IJPU89a7TU7XU/g5LZ3FpfWuoyKnmNf6X5hSJ248p96rnpzgEHPWuN+GvhK/8W+I7dLWEi2gmSWa5cFUjUHPJ65OOAK938Y6B4c0/TNQjluYLlGiKmKdzFtJ6HeXbJ/Cu3DUJV4SrbNbPY561VU5Kne6e6HeGvjzY3tgl01rdm5EZMkdvDuVSBkgkfnWvD+01bW0iZ0+UIvAM9qufzxmvGfh/ZnQ9Inc6hMr3ZVvLgjjZVxnHzNn9BSajq+qS3ptzFqkolYKn2YRSBj7bUzmvTWOrxpxct/Q4PqlJzaS/E9+8XftX6pqejaM0FzbxpBE1oi28BabaHOC/IB64H0ri7z4teNW1eO1n0q5NzJIiRw3FsqEtuGAUckEngYPFeY3cMCXMVt4h1PU9MktQdtlLbCSUqTuxwg2885OarDXNKl1KF5tT1No45A43TOWyDnIJ6EY61wSxdV3UnY7Y4eEbOKOoGuaxdXV0XsbOGXJDmXbxk4I4Xrk/hXQp4o8SeGtEtTp98TYtc2ks1nG29pLkMxjO0x/w7en065ryZm025ld5AzGViwL3LE9f96ukTToLDSRHHpEc0t0Y5be5adyYyCcjaJNpz/tdMVy16k5U7LX5nXRiozu2WvFfjW+8Q+KNVvL+6udRe4uZXJunZcuzcuR2Oe2BXQeGfEQ0HRDqMN9fWOr2s26Fobg7ARz8gUZ3cdzjivPL20utL0uC7d4XuLiaaKS1UAvBsIGW5P3txx9Kp2hlu1llcOSm0eWvJOTjoPwrxpwVSPLJHs0sRKlPmWp64njzxF8bvEun2niPxUfOdDEmoamXZLZdw+838K9TuHHrXm/j62Tw1qEdrp+oR3k0MkyvdQAGBikxCtEcnIIAOSBjOOetdJofxFvNJ+HuqaRbeHo9U0maGQXlxNa/vLaR2CxSRzKNyKCPuE7WYkEVwGlpbaxIsVxfGxuCw2zTxM0YTHONqlt2QAOMc1w81NU/Zxjsztk5zkpSlubafFnUdG8Iy+H7a4MNve5a9ljjUSnJPyLLjcEbhmUEAkVykeq3s1u8wmF4ltH5bGZ94CMcAKGPI56Dp14rT8QeH57rQptUiWS5tbcpHdCGFwlm5ZlSORj0JC5XrnJHUVjeGNZXw1ren6iLJblLaZJ1hOXVyhDbsH3GDnjBNYU4xjFygtQqylKajN6Dp0vb+Cw01I55J13A2qRlZiMlvu4y/GSD2/Cs3w/Pu8RWVwbc3UaXETSQthjIu8AjB4ORx+NfQ37SXxOsPiBcw69rnhyz0n4hausV+mo2N5usF014MRRoqElZQc7s8ggg18/6MdHt/Nn1H7TK0ZQW0VrtTeQ4LFyei7d2CMnOO1aYeo50+aUbPscteHLPlUrnYafeXN5aXWqXzaR9lE50dY9SUS3MCyK2JVhXBJjUf6zruAHJrjrlPL1Iww3S3CISPNRWUYH8WCM/hSXsUJv71tNhuRaRFpVW6kXzFj3fKWZcBm5HStrwj4j0Tw9eLq19arrU1ncwlNHvlfyLtNrBy7KwwVIUY/iDe1btqF5RVzJJztGTsinZXYcxxz3U72kcocxr98ruGcHoDjOCa1td8RDxJrl5cziY280v7qK5lMswjAwnznkkKAM966D4k+KdR+IlrdeLbHwVYeGvDjyJaN/ZFmUs0nCAY3no5ABxn3x1rzjTbafWtUgtLeOMTyMAJNjHaAOpxngdelRSft2ptWlt3t5F1XKguS9479hdR0qd9v2ePz8nC7DlgPpVG+sfsNqizZW7JD7VcMuwrkZx0Oe1alprn2eQpceXLHgqw/n9aj1XSIkt4ry03y2jgjgZAPcA+g/Ou1w5ldHEpdDnCctWvpRuHgdpLeaewi2iWRELCIE8ZPQfjWZPA8EgV12kgNjOeDyK17Txprdh4Wv/DdvqdxDod9PHc3NijYjmkQHYzDvjJxUXlHWIlZ/EQ6ror2Y86I+batyrqc8Gqtjcz2TNPbzCJ14xnlgeox3HrXReCDp11cPa6rqLWtpsMghKEiZv+eYf+An+8Rj1rA1e0FndyKgKoGOFIwV9jW0o+77RGKevKx8N0spYk+VKepH3Wp9xbmPy5PLWNJFBG08H1+n0qv5kNzBFGIliuATmXccOOMAjoCPXvUrx3NviC4DqEG5Fb0Pce1F7rUdrMbRRRUljqKKKsAooooAKKKKAClzSUUALk0u6m0U7gO3ClyKZRRcB9FMpcmncB1FN3Uu6i4C0UmRS5pgFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRmkyKAFopN1Jk0rgOpMikzSUrgO3UmTSUUXAKKKKQBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFTcAooopAFFFBOKACkJpCc0UAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABX2N/wAEs/siftBa/PdzRW4g8MTyxyywmTY4vLTBXHIOM8jnr6kV8c19IfsGeFpPF3xh1Wzj1GfSymhzSma2jV3IFxbjADED+LOfaurCxU60YvucWNly4ecvI/ZHVfiBpWk2Et7d63aiGLb5gj3F1ycD5SA36GqFv8XvDl9Biy8Y6LFM/wB37S2w4+jY/WvDNI+EuhBWjvvEviK5LAAb7pYFJB/2EJ/Wrr/AXwnYhZ28K3GrLIN3nvqcs+SfUKR/KvqfqtJaNv7kfCvELf8AI9v1DxPdWMAnl8X2sdu6grLZ2qzr9fl3cfjXK/8ACwRqkjLbfEq/Zhk7bbSX5+nFcloXhbwx4VaOa08JaZFJE2FEqPKVPtvJrqrf4lXtnuEDmBTkbIIQNv06VLwv8qv93+TMli0t/wCvxMy/v9M80X2qeOL7VWI2mx1aKeGLj+8EBx/nNP1HQbzU7pdQ0zw94euWAZhNDfBEfcP7pwOO3FdFZfFzUGbYTcyjGP3gH59alb4yQwW8ktxbzWgibaz3MZGfoRkH86pRxEdkv69LEuWHm73M6G+8Q6TAFk8LaIkPo+pW5OD6Z61Q1LxrdafH+88C2UCjO+YeXMo98Lzj3qPxB8bvBWqukWt22l6g68xi6gRmUexIrndT+JPwtvWEUvhhpTKcEWty0SH8A4AH4VpThN6zp39P+HIk4P4Jff8A8MW4PjBo+/bLeaLp7BgCPsI4/X+lX0+M3hu1ULLrl3Ix/j06NUQ/Qbx/KtjQ/hN4M1TRG8QReAtKntihuPMudVE54HXjcM+2a599I8EaqFlT4c2eGGVLCWHB7c4UfrTjPD1W0ovT0NZQnTScmtS6Pir4SuhK7x+J7hpBhmadUH5bqtQfE7Q5ZEa00e/wAT/pUkjgeuQqkfrXD+Nfh3ptxpjvp/grQ7K4mzmeTxLIjL8vDCMSdR7/AJV5snwt8Cx2dtNr/i3XrG7aPM9paFSin+6GbJP4LiuqnRw1SPN735/kZyclo5I+lE+KOjC0Mv23w/ppbIxPMpcY65Tr+YqpL8SrW+JSy1uO6Z8MiaVpjycdvmCH9cV4FpL/AAw0zUFTw/4W8Q6rqkTKRrOrX5ggB6FpCRyuOoC8itzXvi5c6JaObjVdKvjGBGiWU8VvCAOAFRev161H1SLn7sWvW3/BIm3y+67+h6ne32q3kiiKXW3x/fuo7Pr7ZJH5VFJpV5Ja7ilnCOQ32/W7iZj+Cba8ivfixrFt4dbU3td1mcKPs7qAcnjJJFZ2neMdX1QNcXdqwmMgEVok8ZBXHVmD/oBXSsMtm7HD+8eqR7LE9qjiGS409Zm27lt7Azgt04eaQg/XFdp4Y0Oyla2jntzcMH35lggjTr6RoOOPWvm6y1Hx7eS6hPY6EkiIu1IHjUsy5H3FJySf5Uyb4p+KvDF0F1u11LTAy7wLxDHuHfaMdKzqYKM9Iy1NOeskm1dH0l4x8FaJPe3Mz+EbPUmMmBFFbwOw54IEnFfPvjqfU/h1fTnR/BOqeHrG5Z2d8wvAhJyXCQg4J7DOOelYGo/tKalJLLPHPG+whmDjIx05A/SvF/FPxVGt6xObm+1K7YPuXy5GRVH1JwK6cPhXRtzyX4mkI1Krfu6H0Xa/FGc+C4JJdeEd0Jz5yXdtIiIpAA2lcntzmvm39prxJrHxCn0Hwt/ak0XhyV3u7+9i3NHIE4VBgc55IHuM9K7y28XaDJ8GtRN4LIMl/FIDcTGa5OVYYBCkbT3BPavGPG2nR+NdHsbWDS75IZW325gtiu5s43K5UZH6V0ToQlSkl3+83wkfZ1lNrYk8L+KfC/gyJ7XR20zRZIAWW5Wzl82Q/wB0yhWfPvwK6TxJ8TdXi8NWWpXtx4f8SafeWMjmxuNTaUqyk5MkLAOCuOg4PY14pqHg/V7OW4j1C3ntXhYf8fkG3en94bRg10GkaBo9+dCh1i0uJdK3n7S+mXyCeaNjyFQ5CHP96uVVKlnCKsj15UqfMpt3Z5tefDzUNThh1ie9SLULkedJZvb7FXJyBlT3GO1ctr1hr1n5ZmtY41A4Ec6lQM8Dr/Pmu08R/DvyvEN/DYXN1b2iyMbeK/n2kx9gzjgnH0HpWPr3hmKW20sppaWsscG2afzPNW4bJO8+hwQMe1eDXoWT5U0/U9ylVWl3dehw7yw3cBkur3yZVT5ILeAnkDgE8fnXc+FtP8I3nhewGr+NdTstTkkCjTbHSjIsaljyXLqGY57Dvg1QTw60saKjpJgEA+XsUg9eePwqNdH06G0ZXWWO9EitHLGwZFAzkFepOcY7dc1wQpyg+ZpHTKakrJtHpH7W/jqw8f8AxYt9LiuGsNI8NaDa6RpqCHeZTHECFbBAXezHJ6D3rifh7q114N0HVbnUtHvE0O/iayGowh0j3Bt20MPlkOVAIJ9+cVn6npVprF2L658+e7dcyuRgOwxj8CBzj8KnstYFp4a1nQpZHTTbxlkW2YOwjdW3Bo8nCn+Ekgkrmmo2qOT07Cb9xRicpe+JmutsduivIM4RY8jHU8EfWl1jxrd6lpNlatG+YAVMrOW3jORx27/XNSQaHCky4l8o9d7DB/PNaviC1ktbWGG+sn+1qkQjMu7CQ7SRg5wd2QfauBKpaV5HU3DTQ5Cx1e9jvzdR6hLZzqjFZkLBicdARzz0rTHirVJDEx1G7c8h2llLc+wB/nT47W0kcglbZ/4SwJUn3PUUj+H72SA3Edo8kCuIjJEMruIJAyPUAmsLzgtJGtoz0aLOra/A+m6cbS61b7eyP9tEku2IPu+Xy8HJGOuec1iwXkjXAMk10687lWchj/PvWtB4fvAIjJAIAWwHuJAij8627Gw8yxeCae2midxI0McO/cw4B3Bcg49DV8852bdhKMYLRHFSS3XJNzcfhI1VJI3ldpJHeRj1Zjkn8a9D1TwHZyQGWJNRsiRlfMi3QsPXLEEfrT/GmiaRqEmkt4f0tdKih02CC8WW93me6UHzZhkfKHODt7VnKlNq97lKpG6VjlvBzXEGuWzRx3NzBvCSRxLksDxjnjP1rovH3nW+oyabFcQXFuVQgxbWPIzgkfxA8YrKsdJubSYSEg4OPkPmfyro9P1S40G+hvIZDBcwSLKkjw52sCCp5GOoHWuqmn7Lkbtcxm1zqSVzLsJprKyiiaGQ7RjPnLn/AL5FWP7a+wyrOt1cW7oQUkhLqVPY5wK6A+NLuTVb+7vZ7aS7vTJ57S2iHJc5YqNuFOe64x2qrda6t5E77HliaQK7rCAgJ79uPoK1co00kpiUXLeJmXvjE6usi3usXF2rSGU+ewZt5XaWLdegHHTinWL6HdWU7y67IbyJ41gtktsiRGJ3ndwBjg475q1a3NmZWxPExIKsFOBj3q/Ba2/ll0VZBgHEarjOelYyk9ZSabN4wvZI5o2s5cEpGy543ID/AEre07S7KfRNQgn0+abUJJIWtrqH5VgAJ8wFMfNuBUe2Per2q6xpS6Db297Z6jLfQ3xmUBvLjMLINyhsHDFgD0xWNq3iTSbuTbY6ddWkRICpPdq5H1baufyrD2l43Zo4JS0ZW0/S7bStbH9taXfX1nGziW3jfyXY4IGGwcYbB6dsd657+zJSj4juNyjnC1pSXzut0yQsyxYaRlcHaM4GD9T2qsviBVtHiEcmCQTyOtcFSpJ7I7qdOn1Ymi219FJ5MctzDHIwVt4bZjPUgenWur8AeFdU1LXbS2tYbmS5eQCEICCr54x7/wCNc3DrL+Skj2siQhgjOWGAx5H6CvVfhJ4+0vwf490vUrhHuLazvI5GljkG1wrA5HHfFeFjalaFKThG7PocvpUKlSKnLQ6Dxb+zd4z8NaBd6hqeiara2CrmYzIyRljwu7PBOTxnmvCrvSri0S6VLWf7WGUIybiFQ5DDp347+tfop+0N+3L4P+Ivwu1TQbPTLyC4neN1kllQr8rZ6CvgibxVaz3UkUQdfOIUEFeuRgZPSvDyfFY6vTcsTTsz1cdSo8qlNKEu250Hwq03w9Y+GfFMvizSf7Vu7vTbi30q3K/Pa3C7X805wFyoYLjPPavKJraQPIvkbUUBRkNkAHp9a2tc1gwTTWvlzLNbOVl/eKQCDjqDgj6VgjVjIrBPPMmcj5/519VT9p12PmazpN+69S3pmp/Z2W3e0jkjY7vnXOw+nIravv7S0y8uYo/D1teC2jE0k1tB9oiVCobcWUEADIB9DkVzVhrUtpK0hediyELiXbgnoe+fpW8vjK9Hh5orbVL62vHZlnTzy0M8RAwCvYjnrnOe2KcoRck2iadaag1CWq9CzJ4s1Lxf4bg8N6dF/ZqmYSHTbHzFj1Cck7ZGQts8xVOwYAJBHeuT0m91DRL+5ngvLiwvoUaIFCyuS3yMuR04Jzn6U9NYuntPJC5mDl/NQ4JGANuPYgnPXmqTXrPOTOmW5+bABB9elb04qm7RRzVpusuao9RqwTxWUs+1VjLeSWJGScZIx+HWlttUmhZQ+JIcANEeFIHH5+9dX4J+HmsfEObWrfSjZs2ladPqcoln8tZIogC+zP3mxzjviuSubmNkhQW4Qou1mDn5zknOO3XH4VcKnvOMXqjCdK0VKWiZFetC9wTArLB1VXOSPX9afdCyjit/s7TSSmLMwlQKFkyeFwTkYxycck8VCZU6eWcn/aq74hOkNqJOiLepYeWmBfsjS79o38rxjdnHtitfi1MPh2KEyMixsylQy5XK4yM9ferdlKl80dtdSeWmQonYZ8oZxk9yo/8A1VWuHZ4oA0xkCphVJPyDJ4H8/wAagBKk003El6lzV7BdL1C5tFuYLwQyNGLi2YtFKAcBlJAyp6iliu5Z4Ehdy0cWdin+HPXH5VSOTU9p/H+FNPXQLFiiiiqAdRRRVgFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUuaSigBcmjcaSigBd1G6kop3AXdRupKKLgLuo3UlFFwF3GjJpKKQC5pKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKVwCiiipAKKKKACignFNJzQApakoooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAr3v9i/UtX0v4r30mjpBJO2lSJItwxVTH50JPI75ArwSvf/2Kby1sPipqkt021Bo0oUkfxefB/TNd+B1xMPU4Mf8A7tP0Pu3Q9R8c6hcSrF/YYRW43CVyo9yOM/jXeyPruk6NDei48yYZW6+wqUAPbacsfzFcRa/ELRYLRI57lPK67doxS2/7RPw18GO95cyQW90FMYaPLSHPXCivuJaan53ySm7KJuXXxGjtHjbUL29ghHyyB08wpnoSV5x7kVe0v4n+ELuaNItQFxK2eGRwc/iMV5rbfFqP4oyzTeFPBepeJLaJiHvNZubewskJH8ZZSzfTNee6j4G8fy30sOmajYWCSP8ANbeHG+0eWPQzbccf71ClCXQr6vb4nZn1pD4z0SFN8sQCdWkl+VfzOBVK7+P/AIK05jHE0WqSqcCDT4Wn59OPlz+NeIad8JNPS0t5Nc8651BFG+fVNRe5YkekUeB+bVe1LwBZS6bNFpElybmR9+6QmOFTjHEa/wBTR7OMt7mcYxi7XPQde+O93r+bPT/h/o8IZNwn8QrGxAPAIjUfpmszQIoNHSLULjwnY+I9TdiWS4jSzsIf91AAGHuxP0rjfDXgDxFp9yss2uyRKv3UiRIl/lXQz+HLmzXfPfC6mJz5k0hc/mapUoRTiuo5Ss9Gd9q/xt8U3thFptvqOleEbJYyrw6LZm5f6KSFVR9KqvrOna3oCadaWOrG8cZn1i7WKd5MeizOwTJ/uiuTW6tdOiD3F3HKMfMc5wfYVHP8QNG0q3ElujXErHB3DOPr7VH1amlaCsV7act9TWj0S9SFfKljjUdQtuobHuVY5NXdG0bUFuo3mltGtu4+yESN7ZL4/SuKtPjrZ298UuwwU8BUjbZ9eMZqj4i+Pdrp0pzmOLoPKQc/nyK3tLa5j7OTfwnqXiTwZp2u2UtncWVn5UnWRsI49wd1eaSfBL4f6DaZ1PWAgL5LtcqW69PlFeReL/ijFrc4ez1KSOTqBNlgT6cVwMev67rd0IkvWuTuOEVen4dqj4dLnVTw82r3sfZ+qeMPhf4f8Kizi8QXSyxx7V8hzJIOOMA8V8533iHwjd3MhtDrV9cGXet1ciKE9e5U5P5Vwscd1Oghn8tHLZY/xH8avppMCkLMgLKOqr/Mmqgmi40IUzp4vEWoSGQ2/iLUYlD52QT4Cj/eIqzb61E91tk8R6xcmdgGjfUGYf4AVz2n+DBrUqGON3RRyokwp+pNF58K7+cCUTJF5TfNBaTg8flW6T35QcYbXsdTF4gs9C8RKssEt9dxFoyrOkwIPB9QeO+asnwz4Sm8+6vdJl3StvjS8v2dI8/7C449s1wN9pV3o/7uCK5KkYPlEc/U1har4m1ONWjlMiRoMfvVzilKcY/EgVGU9YSPoK3+K2h+GfC11oljo+hpayOrnbZrIWK9PvMePqK5bXP2gfPgiEsMMawfKm6KPCj244H0r51vtXeZmEl5GQ3PTFc/ex6lqNpNNYw3Fzbxna88UR8tT2BbpmuGeKUL8qOynl8N5M+lNN/aW02W7SyGj/8ACTam5wscUIjQemWYH9Fql8S/iPpEllPfXfhHS9JuwFRYtMlZZHYA9gMZyRzxwPevEfDl7qXgfSbhbd9Ne6vSBLcOrPNGveMMDgg9wPzqzpmuXfh/W5vEesQ2Vzdvl4NPkj+TzCOJGQEAADoD+NcixFSo1fT9DrWEp03eK/4I7Sbm78Wrd3OqW1taKFKxK8Vw0jfQICce5xXbN8FoY/hPbeJre5vNT1g3rQyaW8BjjjhwQrEsN+c4PTkcV5b4r+LviXXmfzdTmi3HAitQIUHsAoHFYEet6lJEsd1ql3Fu5IkmfDfrWXto3s25eZ1OjUaVrLyOn8Q+GbjRxZR6kx0i8ePe8UlrIGZT0ODgY+lcdP4SluLmX7Fclk3ZCPC4IX1ya23v9KicTzgXUiAY86VnJI74NTP8VL5bRrGCCFbNiGKKgAGOn86wqeyfxs6Ie0ivdRlzaHdaRoP2lNUjkvFl2rZ+U42rj7+7p17Vzx1iS5kK3HlzAqVZwnIP4/zqfWvEL6g7bAYs/eCdDWXa2L3sri3WRNvzHJ7V59WouZRp7HZCLt74hgedgSqxkexOK0dF1BLMmOa8jktXx5sJiZuB6eh96lOnXFpArtDcFOm/b1qGOwa+lVRHhGOMYx+tYqLTv1L5roTxFLoN1qk76bcSWdkD8kdxbs8gHu3ekRdKTSoWg1JP7S88g+eZEQR7eOAMdc96i13S2tJG3LtIA4I6/nXL7nil2lkIz35rnq35mn1NadrKx3MXg7Wb2RZbdbKWJud1m0bkf99Nmrl1pOsaMqBU1Fo8bizQmNUPpkA5/lXJrD/o5kgdSVA4R8Ee+K0tK8Y6no7BIb64U+gckCsmpqyZunB+RaW8v9YvrezMF1dXkziOGI3GNzHgAAjvV7XfCus+F9Ra01izi0u5jwJLea5DTj/gIPX2NWNJ8P6D4jsbzWr241AXVmwmubS1Ee6ZM/Myk9D9BVK61+28a38sTwEMhZba8umBmaIfdWZlADMBj5qFKOq2YmpJq2pS0vWBpF7cnU7C8vIWH7jypTCFOepwMt9OKkbWYNSJW3NurMfuzD5/zY4NUbmW80qc2k1ucxHIiceYB6EZz+YqlNBbX7b3ieKUnJ2jg/nTvO2gvdZtXVnrUEe8wv5Z5DJGCv4Y4qg17fOoVhKAO2MCn6Rb6/pxLaRdzqAciINxj3Un+VaNx4n1O0mA1nTI7gvyXhOxj68f/WqOdxfvKxbipLRmO0sp++hJ9SBmkurhmsfIEQK79+TgHOOmcZrrdHl0nxLOkFoZre6kYIsExAZ27BSeDWtefD2e2uLqC7sNQt5IOXWS2GV+tROpS76l06dRrRHlQfy9pKzJ82cLKRx6AGpDJakHzDej5h3RsDv2612EuhWUakideD91lxn8jWTPaxyP8luvHG5B1qlZikpR0ZSs7vTV0/UYAEJdVZZLqEmXIPRCpwvvmsUwwSB8XhXuqmM8mt9rHaxCxrnBU/KM1mTaPcqxMcY2Hgt6VhOKS0NYN31Kn2OGSNc3wX6qePetvRfDU5mhmtr+zmIORGbpY2P4Nis6LQbm7dhtRVA678n8quWOkTaVMs6NGGXkCRCQa82q+iZ7OGjK/NKOhJqVreLG6yxzPkcmNkcH8jWNbW0SzH7TFcrHyOEIIrVmkDNIS8MW7+FI8Y+lGmanaafdb7wy3UQ/5ZxOY8/U1jG6jZI3m1KabZnzaTaXKD7PMPM5ysp2k+mKzrzSJYJizQyQQOSVH38D68Zr0c/E3SjYSWp8Ow/Z2G0MJMyL77mBx+FRD4n6MmkTWEnha3ug5BjuJJfnjx6ELz+NKNSstOT8gqUMPLXnX4nmsULAgZYA98VoXOmxm1jZXcSHO7jj2xWnea1p14cppkUH+7IQaglmtpoERBLAw/i3bhXU2200cMUopp6lLTLIC4JJyQOh/wD1VW1LbHOxG0c5wMVq29qyvlL7arf30yKk1LwPqcdsl35YeFx8rqRtb6c00nzXbFKSdPlS1M7TdTS2heMRxbXGGJzk/rVW0sbe91FYprlLOKTIEzAlFbHGfQZ4J7dahOnukgRmVW6Yz/8AWqX+zpjwoL/7vNXZRbaJc5VYqLWxVvLCXTryS2uF2SxttYBgfyI4I96Lwwm6kNujxwljsR2DMB7kYzWnHppkgKTxSD+7IsZyp/qKTUvCep6T5P2uynt/PQSxb0I3qehHtTU43s2ZuhO10tDIAycEHpiniP8A2asDRrrr9nf8eKUaTdgZMeB7titE0c7hJbogEfHCKfxqQJtGdgUH0Oc0GyljHzPGv/AqAMcbg30rVGVmtxaKKKYx1FFFVcAoooouAUUUUwCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiilcAooopXAKKKKQBRRRQAUUZxSFqAFzikLUlFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAV2Pwt1q90PX7mawiaaZ7Voyqgnguh7e4FcdXuX7Idpo194/12HWrx7GF9DlEE0abiJfPgx+m6u3BxcsRBJ21OTFyUKE5NX0Ox/4QTx9rumW+qX3mW1hMcJFHLh8f7o5qz4RPh3wz4ljsriG0k1Fjzdam25Ij9Dxn6179oPhHwTawSi+8d6wkrqQgiiyq/mK4q3/AGXvAnjHVbuW6+IVxasWJjaW2AJHvmvs50ZQV4K78z5GOIjO8ajsvJHbeG9P0Sa5ju5dSt9WuM5AMo8pf91Bx+lejXHiHybWOMSrs/uIMLj6Cvma5/Ys8XPqM6+C/E9hrEMY3Rt5xhdvbGTzVCGH4vfCSf7N4l0i4msojhnJEi49mFWsR73LUhY5p4aE1enUv66H0umqxtIS0p2nsBU6avcji1k2qeCWNeL6Z8bfDz2yS3Jkhm/iRx0Naw+NVg1uZbWFJYscENzXapQezOF4eovsnqwuLsyje3mKeSwyTUs0AuBvaXcR2kfP6V4ifjpf3rmK1iESnjA61RXxHr2qsxWVoQx5IPNEWnsDw895aHoXxBD2kK8SuOpCN8teZXXiB/OESttU8bcVoTnUZABLdSS5GCC/FU00cvNlgC1U7vY3pqMFaRQvYY5yqRyOZf4jv4rNk8M3csTHzdwfjaDn8a77R/BH2yT53WIE85rt7H4a2KW3zXcYY9Du6UezT+IJYhQ0R8+z+Fp7T/WqWVeRit7w/wCLF0HTZ7aCzRDLwZ9nzj6GvTvFXhLSvDsURub1LiOT7xiOWFYaeHPBGsGNbfULqLby0bdz+VZ+z5XeJftozj7y0OdttcsbuAo8biQnLMq8/nVm9lsRbxzeZOYCcb1iyM+9dLrXwgsLezjvbDU3WGTjy3GM/jVnRPC66BZyC7O2AjPzcg+9bQu9GYynTWsS/wCEU0BtOI1LeyMoMYGUJNbd54itNM09ILOwieBh0BAP41wF9q9lBv8As7+YemT2rmrrxPbwu4MsnPtWsmluZexdR3O3k0p/Ek+6O0EaE/dEvFSJ8HVl3yXqWUMPVnlfdgV5xB8UtO8PqzTSybR74rlPH3xk1rxnon2TR1NrZZxJJvwziuKtiKcFvd9jrp4atJpLRdzv38LeCPEb69arr+laVFpkJbzZId0ly+PuxgVx958YrrRfhW3gLTjENIa5NzJHHCBLO3YOw52j0rxtNRksozFFnzW4kkNRXOrrHEUtlYyH78p614E8Q6jvse5HCpaN3Olh8Tabo2nTsLdbnWJhhXkXKWw9VH973rgr+7eaZnMrtKxyWY8k1DNdSO2O56mqs4JYE/NmuWpV51yrod0Kai7liDVpIV2oBn1YZOajvbuW7ZWmaR5s/ebkAe1VzEc5wRSpiMlmyWrn521Y35UtRzT+VkupY/kKrHU+oUcH+9yKZOXlY46VCyqgwVwfaueUn0NEkTG6ZzuzjjFbvhcxGWSWSRVZV4VieRXNptLD1J71c86SGIqjhe/ApQdnzDkrqx2NxrqhPvkxjPAPSoodUj3xBDuVjksefwrj2upphtdtueuKvWELLG8pzwO5rZVZSZn7NJC+JdX+03cgJL9gT2rnH2seFA9xU9yjSysQcgntTBAcc9RXLNuTuzaNktBIt0aHjgdcHGaltTLIG2EKo9DzUbDKYLYHeq5kSBvkJzUPQvc6DSry80y+iurdzvjOcN90juD7Gugh06ybUZNUEMUWmOCZYfNKmJj/AHce9cQmoMqgqfqDWxoXis6fMY5kSW2k+V0YcEGplyyVio80WdXYapo19bSW0lik91nbBevMy5XsCv8AWtq2+C3ijVPB2s+KbTTYY9H0sAzTed1z6ZrzjxHo8enGO9sZd1rMdyoDyh9K6LR/iFrSeGLjQLq7mXTLkYIVzg/UVvTrRnD2ctH0Mp0pRlzrVHIQa3IzkNFl+gIc8Vt2+uPEiiaFbrj7so3isO98NXNrKPLUyRtyHWhLSeBgr7l7VF5r3WaNRavE2tT1axvocixltrlTuV4p22591OaqWl1qN7dmRb10z/rHeRjkfTPNV5rR403lifaqbB4sMDge1ZyprsXGo+51Ft4pgtR5V3bDdnAlByPyqfUfFNxaQbUs4PIccTImeK5mCeGYgXCgMOjDmrdpq7LcC2RIzGxxyMA/WonZ6S2NIOS1iRR666uzDbz7Vft/EMhQDajDoQajvdCtpJzGCbec8/IcrWZc6NeacS2BKg6sprFwcleOqNY1OSVpaM3Wvrdl3CIRuf4o2Iq7ALW5tJD5twHA4K4YfiK4Z9UdWIKkEdjUsGtSow8sMp/2a8qrRb2PboYmMdJaoTU5WjuHUyBxnglcVmtcM3/1q0Lx5r1yzDn1NZ5t23YOB61rDRWZy1buXu7ALhyjDnHtUJlIar8lh9nthJ5y/N/COtUGQD1Naxs9jCSlHcspKghOQHY/pVdmZWyuR9DTdnbNDLu74ppWIlO+he0+/wDImDSNIV9FOK2T4n1OO2a3hu2uLM8mCYB1/I/zrmRH69a2tBWwNwBfeZ5ZGMoelY1FH4rHVQlJ+5exRlnMrbjEisT1j+XFXdPe4DBsyomfvHkVsalZ6HDBuspz5w6CQcGsOTWLpF8sTZjHQKazjJ1FojolTVKXvu/odXH4quLCFYrS0t3VTkySKWcn65rd1b4oXeqLbf6HHBHBCIgrMW6dSN2cZ9K8our53PDOPXJqo1zIersfYmmqCdmweN5LpHoF34ltbtmaZQHPUgf4VTlu9JulxJnPs5FcV5zev5Uvnse/6V3wbjoeTUmp6nQ3Nrp+T5UcjDt8+azbqOOMr5aMnru71niVl6E/nU6yvKPnJOOlaXMR1FFFAx1FFFABRRRQAUUUUAFFFFMAoooouAUUUU7gFFFFFwCiiincAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooopXAKKKKLgFFFFK4BRRRQAUUUUgCiiigAooooACcUm6hjSUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFeqfs4kjxvfYGT/Zz/wDo2KvK69X/AGbSo8c324gf8S2Tr/11ir0Mv/3qn6nHjP8Ad5+h9G/Z2leMu+BnkZrajltrcDLknHTNY0bJ5nJLYq1JPFGy5Wv0VaHw71Nyy1qSxmE1jPLbyjkNExUiuil+IOu6tafZtRuftlsRgiZQSR9a4b7QUAZVGD6077axyHkA9gaLJ6tGTSZ6RobfD1LF4tW0CGSWQEGRUHeuE1L9lyHxdeXF14U1ZbO2kOVti3A9qzZdQhjHzPk+lFl4mubR82lxJbMOjI5WsJUIPoUnUhrCRgeMvgjrfwbtor/VpDNHkZkgO78xXTeHfF3hu/0+GWOOaRwMSbOgrfHiTUPFVvHa6vdNfwjjEhzgV2PhXwroEdrJZ7IEMw/iQfzrOFGVJXi9B1cQnG1Ra+RwFxr/AIYubtY7O4cy4yY92SPwqlF4v0fTr11nf5l7MOa39d+BNn4W1C41iK4BWTJ27v5GvOEvNF0fXprm9kWRiMASDfx7Vop1U9UrBBUqi927Olu/iPYNI5hOF9uKxbv4qMI3jiLEkYHNZ994q8PzW9z5USR5zsEsXP4V5w2tpDPI6ocbjjK1FSu49Top4eMtbHd2t/f+ILoM8jBM9ya9C8OaDFFsaZhxzXz+vxMu7ElYoWA9Qta+kfFjWZXRI7eSbnoBzWUMTSTs3dmlTDVGvd0R9H674/OmactitoksSYIY8DNeea38U7i/k8ufakXTaK5PxV471ZdIV30p48j7xFeRX/i7UJ7pGa3fGegFOrio0tETh8Hzq8j6K0y6tr6AmLADUmo2mm6Navc3zLtAzgnk15roPxDkttK2paBZQOC3BzXJalrmueJ9QZbuOVLfPyg9DSq42lTgnu2XDCTlN62RoeM2HjO58ywhEVrH/EOM4rn7E3KnyIyREDgkd67TTZZLOxa0itRIrdWxnHtVBtHu7WZZEjVUPJ2r0rxuWVV+0fU9RTUFydjnr1reM+Xjn+I0x76wgtWURqzEVteI9LhmtgwcibHLFcVwNzpsxnIWTipq3puyRpTtNashuZ98zFVwuaiXc7dOK6XSPB51DaJZtgNdEnw606FVMt7gH/aFc8aFSpqkaSqwg7HF29qsyjaQXPaq9/pd1CSzREJ64r0S58L6Hotv5sN2ksgGfmbP4VzGseJIXtHgCj2INbToKEffeooVOZ+6jiLj93k7sGs95XJJPI7VrXWjiS1acSfMeRzWQ1tLGpLDNePUTO+NrDYJWE4Zua1JHBAbBNZcETSOAB+daogYIMnp2qY3sORAjeZMuQcVom/WCPywvUcmqLKd2QMUpUkEnk0ldbA7MrzSAE8YpplQYPU1FcKwzmq+SOahyZaiTtLjJHNVWjZ3zxmnMeM00Pg1LdykrAkEjHAIFWEtHDYOCahExHepkl28hsGkkh3NyxlkSDyriISRdge1V7hntpdwXMJP3fSpbeUzW+NwqzZosmY5CCKU4pe8iqcub3Waeg61JF82wSQ45U84rYXSLPW45Zo7gRkDPlkc5rk2RtPkJibKntV3S9SMM4eM49Vop1/szenccqLg+aP3FbULKWIspJKg9+KzzACoBIrU8TalNdSBkQKPUDrWBDdqv+sOa6XKPTU57N6j50EfXGKpPc+W2VwTWmt1aMpyN1Z1yI2dmjXg+1ZSRUb9S/Y6oJJFNwcY75rXktvtiCTT7ob8cqx61yAjJPII/CrVq8kDBo2KsPSsLO3u6HXFxb95XLt0qO7JfW+xhx5iCq8WngyA28quvo3WtW21gMhjuo1kB43EVE+ixyjzLWXYTzgdK5pSe1RfM6o0utJ/Iry6bcgFguQfSsqaJ4mIIOa2ba6vdNmzKpkjHWrV1e2OpqfkCSeo45rncLax1Rtzpq0tGc2107QGLaAPWqjuTgEDitZrBpGKoQagu9CuIU3HletVG0TObc0ZzuppI3UkAipY7KRyeCKie2dXwVNW2YqLWpI8i54HSkW4ZOR2pVtXA6ZPpVuOwWSMjad30rN22Z0JSexTkvDK2Wp6SI454psti0RORge9RrARyc1VkReV9S55COmdo+tRS28JAwTup0YkUYGSO9SwAJIAyZpxTFJohi055vuKTVkeH7pkLbFAHqcU67kkiYGI7F9KSS/ZowGkZT9a2Ts9Uc7V1puUZrb7O2HIB9jTFKnO2pTAsrff3H3NNMPk/jWnmjNeYlFFFIodRSbjRuoAWik3UuRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUwCiiii4BRRRTuAUUUUXAKKKKLgFFFFFwCiiii4BRRRSuAUUUUXAKKKKQBRRRQAUUUUAFFFFABRRSbqAFozTcmigBd1JmiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAK734MazaaH4puZ7y5itYms2QPLIEBO9DjJ+hrgqK3o1XQqRqLoZVaaqwcH1PqWL4k6IJP+QvZAf9fKf41pL8R/D7KD/bmnAj1uk/xr5Ior3P7bq/yo8l5XTf2mfXF38VNAEG1dYsGf2uU/xrFn+JelnkavZE+1wn+NfMNFJ51Vf2UNZXTX2j6VX4iaW75Or2WPe5T/ABq7D450Vly2t6ePY3Uf+NfLtFSs4qr7KG8sp9JH2LpHxL8PWqYfX9NB9ftkf+NXY/jDoq3II8RacAvQ/bI//iq+LaK2/tyr/IjF5PSe8mfcmt/GXQdZ0xreTxTp44xgX0f/AMVXjGt3+gPdNLHrtlKeoIukP9a8CorOpnM6is4IullUKPwyZ67c+IbQSYTVLcqPSdf8aj/4SS0P3tQtz/22X/GvJqK4/wC0Z/ynZ9Tj3PXI9e0wkF7229/3y/413PhH4j+GtFkRri6tnHceav8AjXzVRWlPNJ03dRRnPAQmrOTPszXvjX4L1bTFgWezQ+pmQ/1rlLLx/wCCYZ9889m+Onzqf618vUV0yzurLVwRzRyilBWUmfRetfFrw7JfL9kFv5WcZ4rUm8eeGNSsYoxe2ETjBJe4Rf618wUVxTzGc5c0oo3WXU0rJs+ntQ+JugaPpjJaXllNJjAEcysf0Neb6l8T7m7Y7LuKNM8BXFeU0VU8zqy0SsXDAU4dbnc3XiyW6J33it9Xqk2uDOfPT/voVydFcjxU5bnSsPFbHXDxI6L8lyF+j1Xl8RzScG5J/wCB1zNFL61MPq8Tfk1qRlwZ8j/eqv8AbwxyZF/E1kUVDrye5aoxRuDUEUffU/jR/aSScFlx7kVh0UvbMPZI6KC4tk/5axjP+0Kme9tscTJ9N4rl6KpV2ugnRT6nQNeQ54kT/voUguof+eqf99CsCip9q+w/ZLub8k8DD/Wp/wB9CqU7RDO11J9jWbRUupfoNU7dSd5Ae9Rlge+BTKKjmL5UP3gdqkiZSRkgfWoKKOYfKaou1ijwsgz6A1ANTkRsq361RoocmxKNjVTV2bhzVi31FFYN5ir9WrCorNxTNE2jsf7VtbiIpJNGPqwrDvreEuWjniI9A4rKopx93YhpXuWBhBjcp9waljmBPJUfjVKitOYOU24JYGGDJGv1YU5pIEORLEfowrCopczKWhuK8Dg5mjH1YU03Qt2zHOv4MKxaKVyr9jrtP1y3ZNlyyYP8W4VoHRtGvImmGqWkMp5CtOoP864GiocUzVVXazVzblT7NdFY7uB1H8SyAg068vZAgUTxuPaQGsKihKxk3d3Om057Xyy01xEGx0LiqV3f26yttAb3XmsainZdgUmlY0I75BJvZQQPWrcWsQq+4xg49axKKlxuUptGpqGpR3R+VQPpVIFO5qCio9mV7RmlFewouCookvIsAqBms2iqUbEud90W3vN3XBqJpkfqtQ0VViGPGxWBHFErA4wc0yiqJsFFFFIYUUUUAFFFFABRRRQAZNLuoooAN1LRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABQTiiigBN1Jk0UUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAf/Z';
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
    const dashboardUrl = 'https://work46121-gif.github.io/raven-site/dashboard.html?add=' + encodeURIComponent(ravenId);
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
  <a href="https://work46121-gif.github.io/raven-site/dashboard.html" class="btn-secondary">Sign in to existing account</a>
  <div class="divider"></div>
  <div class="footer">
    RAVEN splits bills with AI, tracks group trips, and settles up instantly.<br>
    No app download required.
  </div>
</div>
</body>
</html>`);
  } catch(err) {
    res.redirect('https://work46121-gif.github.io/raven-site/dashboard.html');
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

    // Try models in order — fall back if one fails
    const modelsToTry = ['claude-opus-4-5-20251101', 'claude-sonnet-4-5-20251022', 'claude-sonnet-4-6', 'claude-opus-4-6'];
    let lastError = null;
    let raw = '';

    for (const model of modelsToTry) {
      try {
        console.log('Trying model:', model);
        const message = await getAnthropic().messages.create({
          model,
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mt, data: image } },
              { type: 'text', text: `You are a receipt parser. Look at this receipt image carefully.

Extract ALL line items and return ONLY valid JSON. No markdown, no explanation.

INCLUDE: food items, products, any purchased items with prices
IGNORE: barcodes, transaction IDs, payment method lines (VISA/CHIP), member numbers, store addresses, "APPROVED", "CHANGE", "AMOUNT" lines, tax category codes (E/A/S letters)
FOR COSTCO/WAREHOUSE: lines start with item number then item name then price — use the item name only

Return this exact JSON structure:
{"bill_name":"Store Name","items":[{"name":"Item Name","price":9.99}],"subtotal":0.00,"tax":0.00,"tip":0.00,"total":0.00}` }
            ]
          }]
        });
        raw = message.content[0]?.text || '';
        console.log('Model', model, 'responded, length:', raw.length);
        console.log('First 200 chars:', raw.slice(0, 200));
        lastError = null;
        break; // success — exit loop
      } catch(modelErr) {
        console.error('Model', model, 'failed:', modelErr.status, modelErr.message?.slice(0,100));
        lastError = modelErr;
        if (modelErr.status === 401) break; // bad API key — don't retry
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
              body: JSON.stringify({ from: 'RAVEN <reminders@getraven.app>', to: [p.phone], subject: `🪶 Reminder: You owe $${parseFloat(p.amount).toFixed(2)} for ${bill.name}`, html })
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🪶 RAVEN SMS server running on port ${PORT}`));
