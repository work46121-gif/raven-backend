require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Anthropic
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

    const message = await anthropic.messages.create({
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
  "items": [{"name": "Item Name", "price": 0.00}],
  "subtotal": 0.00,
  "tax": 0.00,
  "tip": 0.00,
  "total": 0.00
}
Include only ordered items with their prices. If tip is not on receipt, set to 0.`
          }
        ]
      }]
    });

    const text = message.content[0].text.trim();
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

    const { error: billError } = await supabase.from('bills').insert({
      id: billId,
      creator_phone: fromPhone,
      name,
      total: parsed.total || 0,
      per_person: 0,
      status: 'selecting'
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

    const billUrl = `${baseUrl}/bill/${billId}`;

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

    const { error: billError } = await supabase.from('bills').insert({
      id: billId, creator_phone: fromPhone, name: billName, total, per_person: perPerson
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
  const { data: bill } = await supabase.from('bills').select('*').eq('id', billId).single();
  if (!bill) return res.status(404).send('Bill not found');

  const { data: items } = await supabase.from('receipt_items').select('*').eq('bill_id', billId);
  const { data: selections } = await supabase.from('item_selections').select('*').eq('bill_id', billId);

  const uniquePeople = [...new Set((selections || []).map(s => s.participant_name))];
  const peopleCount = Math.max(uniquePeople.length, 1);
  const myTax = ((bill.tax || 0) / peopleCount).toFixed(2);
  const myTip = ((bill.tip || 0) / peopleCount).toFixed(2);

  const itemsHTML = (items || []).map((item, i) => {
    const claimers = (selections || []).filter(s => s.item_id === item.id).map(s => s.participant_name);
    const claimersHTML = claimers.length > 0
      ? `<div class="item-claimers">${claimers.map(c => `<span class="claimer">${c}</span>`).join('')}</div>`
      : '';
    return `<div class="item-card animate-in" id="item-${item.id}" data-price="${item.price}" onclick="toggleItem('${item.id}', ${item.price})" style="animation-delay:${i * 0.05}s">
      <div class="item-check">✓</div>
      <div class="item-body">
        <div class="item-name">${item.name}</div>
        ${claimersHTML}
      </div>
      <div class="item-price">$${parseFloat(item.price).toFixed(2)}</div>
    </div>`;
  }).join('');

  const billContent = `
    <div class="bill-info animate-in">
      <div class="bill-name">${bill.name}</div>
      <div class="bill-meta">
        <div class="bill-tag">Total <span>$${parseFloat(bill.total || 0).toFixed(2)}</span></div>
        <div class="bill-tag">${(items || []).length} items</div>
        ${uniquePeople.length > 0 ? `<div class="bill-tag">${uniquePeople.length} confirmed</div>` : ''}
      </div>
    </div>

    <div class="progress-wrap animate-in">
      <div class="progress-label">
        <span>People confirmed</span>
        <span><span style="color:var(--sms)">${uniquePeople.length}</span> so far</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${Math.min(uniquePeople.length * 25, 100)}%"></div>
      </div>
    </div>

    <div class="name-section animate-in">
      <label class="name-label" for="userName">Your name</label>
      <div class="name-input-wrap">
        <input type="text" id="userName" class="name-input" placeholder="Enter your name..." autocomplete="off" autocorrect="off" />
      </div>
    </div>

    <div class="section-label animate-in">
      <h2>Tap everything you ordered</h2>
      <div class="count"><span id="selectedCount">0</span> selected</div>
    </div>

    <div class="items-list">
      ${itemsHTML || '<div class="empty-state">No items found on this bill.</div>'}
    </div>

    <div class="extras-section animate-in">
      <div class="extras-title">Shared charges</div>
      <div class="extras-card">
        <div class="extra-row">
          <div class="extra-label">Tax <span class="extra-note">(split evenly)</span></div>
          <div class="extra-value">$${parseFloat(bill.tax || 0).toFixed(2)}</div>
        </div>
        <div class="extra-row">
          <div class="extra-label">Tip <span class="extra-note">(split evenly)</span></div>
          <div class="extra-value">$${parseFloat(bill.tip || 0).toFixed(2)}</div>
        </div>
      </div>
    </div>

    <div class="summary-section animate-in">
      <div class="summary-card">
        <div class="summary-row">
          <div class="summary-label">Your items</div>
          <div class="summary-value" id="itemsSubtotal">$0.00</div>
        </div>
        <div class="summary-row">
          <div class="summary-label">Tax (your share)</div>
          <div class="summary-value">$${myTax}</div>
        </div>
        <div class="summary-row">
          <div class="summary-label">Tip (your share)</div>
          <div class="summary-value">$${myTip}</div>
        </div>
        <div class="summary-total">
          <div class="summary-total-label">Your Total</div>
          <div class="summary-total-value" id="myTotalAmount">$${(parseFloat(myTax) + parseFloat(myTip)).toFixed(2)}</div>
        </div>
      </div>
    </div>

    <div id="billIdData" data-value="${billId}" style="display:none"></div>
    <div id="taxAmount" data-value="${bill.tax || 0}" style="display:none"></div>
    <div id="tipAmount" data-value="${bill.tip || 0}" style="display:none"></div>
    <div id="peopleCount" data-value="${peopleCount}" style="display:none"></div>
  `;

  let template = fs.readFileSync(path.join(__dirname, 'public', 'bill.html'), 'utf8');
  template = template.replace('BILL_CONTENT_PLACEHOLDER', billContent);
  template = template.replace('Loading...', billId);
  res.send(template);
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
