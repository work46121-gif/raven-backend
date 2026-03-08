require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Twilio
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ─── HELPERS ────────────────────────────────────────────────────────────────

function generateBillId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 5; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function normalizePhone(phone) {
  // Strip everything except digits
  const digits = phone.replace(/\D/g, '');
  // Ensure +1 prefix
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

function parseMentions(text) {
  // Extract @names from text like "@Jake @Mia @Leo"
  const matches = text.match(/@[\w]+/g) || [];
  return matches.map(m => m.replace('@', '').trim());
}

function formatMoney(amount) {
  return `$${parseFloat(amount).toFixed(2)}`;
}

async function sendSMS(to, body) {
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

// ─── COMMAND HANDLERS ────────────────────────────────────────────────────────

// SPLIT $120 Dinner @Jake @Mia @Leo
async function handleSplit(fromPhone, text) {
  try {
    // Parse: SPLIT $120 Dinner @Jake @Mia @Leo
    const match = text.match(/SPLIT\s+\$?([\d.]+)\s+(.*?)(\s+@\w+.*)?$/i);
    if (!match) {
      return `🪶 RAVEN\n\nUsage: SPLIT $120 Dinner @Jake @Mia @Leo\n\nInclude the total, a name, and tag everyone who owes.`;
    }

    const total = parseFloat(match[1]);
    const mentions = parseMentions(text);

    // Get bill name (everything between amount and first @)
    const afterAmount = text.replace(/split\s+\$?[\d.]+\s*/i, '').trim();
    const billName = afterAmount.replace(/@\w+/g, '').trim() || 'Bill';

    if (isNaN(total) || total <= 0) {
      return `🪶 RAVEN\n\nInvalid amount. Try: SPLIT $120 Dinner @Jake @Mia`;
    }

    if (mentions.length === 0) {
      return `🪶 RAVEN\n\nNo one tagged. Try: SPLIT $120 Dinner @Jake @Mia`;
    }

    // Split evenly among tagged people (creator already paid)
    const perPerson = total / mentions.length;
    const billId = generateBillId();

    // Save bill
    const { error: billError } = await supabase
      .from('bills')
      .insert({
        id: billId,
        creator_phone: fromPhone,
        name: billName,
        total,
        per_person: perPerson
      });

    if (billError) throw billError;

    // Save participants (use name as identifier since we don't have their phones)
    const participantRows = mentions.map(name => ({
      bill_id: billId,
      phone: `unknown_${name.toLowerCase()}_${billId}`,
      name,
      amount: perPerson,
      paid: false
    }));

    const { error: partError } = await supabase
      .from('participants')
      .insert(participantRows);

    if (partError) throw partError;

    // Build response
    let response = `🪶 RAVEN — Bill Created!\n\n`;
    response += `📋 ${billName}\n`;
    response += `💰 Total: ${formatMoney(total)}\n`;
    response += `👤 Each owes: ${formatMoney(perPerson)}\n`;
    response += `🆔 Bill ID: ${billId}\n\n`;
    mentions.forEach(name => {
      response += `⏳ ${name} — ${formatMoney(perPerson)}\n`;
    });
    response += `\n${mentions.map(n => '@' + n).join(' ')} — reply PAID ${billId} when you send your share!`;

    return response;

  } catch (err) {
    console.error('SPLIT error:', err);
    return `🪶 RAVEN\n\nSomething went wrong creating the bill. Try again.`;
  }
}

// PAID B7K2
async function handlePaid(fromPhone, text) {
  try {
    const parts = text.trim().split(/\s+/);
    const billId = parts[1]?.toUpperCase();

    if (!billId) {
      return `🪶 RAVEN\n\nUsage: PAID [Bill ID]\nExample: PAID B7K2`;
    }

    // Get the bill
    const { data: bill, error: billError } = await supabase
      .from('bills')
      .select('*')
      .eq('id', billId)
      .single();

    if (billError || !bill) {
      return `🪶 RAVEN\n\nBill ${billId} not found. Check the ID and try again.`;
    }

    // Find participant by phone
    const { data: participant } = await supabase
      .from('participants')
      .select('*')
      .eq('bill_id', billId)
      .eq('phone', fromPhone)
      .single();

    if (!participant) {
      // They might be in the bill but we don't have their phone
      // Mark by updating first unmatched participant with a name hint
      return `🪶 RAVEN\n\nTo mark yourself paid, reply:\nPAID ${billId} [YourName]\n\nExample: PAID ${billId} Jake`;
    }

    if (participant.paid) {
      return `🪶 RAVEN\n\nYou already paid ${billId}. ✅`;
    }

    // Mark as paid
    await supabase
      .from('participants')
      .update({ paid: true, paid_at: new Date().toISOString() })
      .eq('id', participant.id);

    // Get updated participants
    const { data: allParts } = await supabase
      .from('participants')
      .select('*')
      .eq('bill_id', billId);

    const paidCount = allParts.filter(p => p.paid).length;
    const totalCount = allParts.length;
    const allPaid = paidCount === totalCount;

    let response = `🪶 RAVEN — Payment Confirmed!\n\n`;
    response += `✅ ${participant.name} paid ${formatMoney(participant.amount)} for ${bill.name}\n\n`;

    allParts.forEach(p => {
      response += p.paid ? `✅ ${p.name} — Paid\n` : `⏳ ${p.name} — ${formatMoney(p.amount)} owed\n`;
    });

    if (allPaid) {
      response += `\n🎉 Everyone's paid up! ${bill.name} is settled.`;
      // Mark bill complete
      await supabase.from('bills').update({ status: 'completed' }).eq('id', billId);
    } else {
      response += `\n${paidCount}/${totalCount} paid`;
    }

    // Notify creator
    if (bill.creator_phone !== fromPhone) {
      await sendSMS(bill.creator_phone,
        `🪶 RAVEN — ${participant.name} just paid ${formatMoney(participant.amount)} for ${bill.name} (${billId})\n${paidCount}/${totalCount} paid`
      );
    }

    return response;

  } catch (err) {
    console.error('PAID error:', err);
    return `🪶 RAVEN\n\nSomething went wrong. Try again.`;
  }
}

// PAID B7K2 Jake (name-based payment for unregistered phones)
async function handlePaidByName(fromPhone, billId, name) {
  try {
    const { data: bill } = await supabase.from('bills').select('*').eq('id', billId).single();
    if (!bill) return `🪶 RAVEN\n\nBill ${billId} not found.`;

    const { data: participant } = await supabase
      .from('participants')
      .select('*')
      .eq('bill_id', billId)
      .ilike('name', name)
      .single();

    if (!participant) return `🪶 RAVEN\n\n"${name}" not found on bill ${billId}. Check the name and try again.`;
    if (participant.paid) return `🪶 RAVEN\n\n${name} already marked as paid ✅`;

    await supabase
      .from('participants')
      .update({ paid: true, paid_at: new Date().toISOString(), phone: fromPhone })
      .eq('id', participant.id);

    const { data: allParts } = await supabase.from('participants').select('*').eq('bill_id', billId);
    const paidCount = allParts.filter(p => p.paid).length;
    const totalCount = allParts.length;

    let response = `🪶 RAVEN — Payment Confirmed!\n\n✅ ${name} paid ${formatMoney(participant.amount)} for ${bill.name}\n\n`;
    allParts.forEach(p => {
      response += p.paid ? `✅ ${p.name} — Paid\n` : `⏳ ${p.name} — ${formatMoney(p.amount)} owed\n`;
    });

    if (paidCount === totalCount) {
      response += `\n🎉 Everyone's settled up!`;
      await supabase.from('bills').update({ status: 'completed' }).eq('id', billId);
    } else {
      response += `\n${paidCount}/${totalCount} paid`;
    }

    if (bill.creator_phone !== fromPhone) {
      await sendSMS(bill.creator_phone, `🪶 RAVEN — ${name} paid ${formatMoney(participant.amount)} for ${bill.name} (${billId})\n${paidCount}/${totalCount} paid`);
    }

    return response;
  } catch (err) {
    console.error('PAID BY NAME error:', err);
    return `🪶 RAVEN\n\nSomething went wrong. Try again.`;
  }
}

// REMIND B7K2
async function handleRemind(fromPhone, text) {
  try {
    const parts = text.trim().split(/\s+/);
    const billId = parts[1]?.toUpperCase();

    if (!billId) return `🪶 RAVEN\n\nUsage: REMIND [Bill ID]\nExample: REMIND B7K2`;

    const { data: bill } = await supabase.from('bills').select('*').eq('id', billId).single();
    if (!bill) return `🪶 RAVEN\n\nBill ${billId} not found.`;

    if (bill.creator_phone !== fromPhone) {
      return `🪶 RAVEN\n\nOnly the bill creator can send reminders.`;
    }

    const { data: unpaid } = await supabase
      .from('participants')
      .select('*')
      .eq('bill_id', billId)
      .eq('paid', false);

    if (!unpaid || unpaid.length === 0) {
      return `🪶 RAVEN\n\nEveryone has paid ${bill.name} already! 🎉`;
    }

    // Send reminders to any unpaid participants with real phone numbers
    let reminded = 0;
    for (const p of unpaid) {
      if (p.phone && !p.phone.startsWith('unknown_')) {
        await sendSMS(p.phone,
          `🪶 RAVEN — Reminder!\n\nHey ${p.name}, you still owe ${formatMoney(p.amount)} for ${bill.name}.\n\nReply: PAID ${billId} ${p.name}\n\nThanks! 🙏`
        );
        reminded++;
      }
    }

    const names = unpaid.map(p => p.name).join(', ');
    let response = `🪶 RAVEN — Reminders Sent!\n\n`;
    response += `📋 ${bill.name} (${billId})\n`;
    response += `⏳ Still owe: ${names}\n`;
    if (reminded > 0) response += `\n✅ Auto-pinged ${reminded} people`;
    response += `\nManually remind: ${names.split(', ').filter((_, i) => unpaid[i]?.phone?.startsWith('unknown_')).join(', ')}`;

    return response;

  } catch (err) {
    console.error('REMIND error:', err);
    return `🪶 RAVEN\n\nSomething went wrong. Try again.`;
  }
}

// STATUS B7K2
async function handleStatus(fromPhone, text) {
  try {
    const parts = text.trim().split(/\s+/);
    const billId = parts[1]?.toUpperCase();

    if (!billId) return `🪶 RAVEN\n\nUsage: STATUS [Bill ID]\nExample: STATUS B7K2`;

    const { data: bill } = await supabase.from('bills').select('*').eq('id', billId).single();
    if (!bill) return `🪶 RAVEN\n\nBill ${billId} not found.`;

    const { data: participants } = await supabase
      .from('participants')
      .select('*')
      .eq('bill_id', billId);

    const paidCount = participants.filter(p => p.paid).length;
    const totalCount = participants.length;
    const totalCollected = participants.filter(p => p.paid).reduce((sum, p) => sum + parseFloat(p.amount), 0);

    let response = `🪶 RAVEN — Bill Status\n\n`;
    response += `📋 ${bill.name}\n`;
    response += `💰 Total: ${formatMoney(bill.total)}\n`;
    response += `📊 ${paidCount}/${totalCount} paid\n\n`;

    participants.forEach(p => {
      response += p.paid
        ? `✅ ${p.name} — Paid\n`
        : `⏳ ${p.name} — ${formatMoney(p.amount)} owed\n`;
    });

    response += `\n💵 Collected: ${formatMoney(totalCollected)} / ${formatMoney(bill.total)}`;

    return response;

  } catch (err) {
    console.error('STATUS error:', err);
    return `🪶 RAVEN\n\nSomething went wrong. Try again.`;
  }
}

// BILLS — show creator's active bills
async function handleBills(fromPhone) {
  try {
    const { data: bills } = await supabase
      .from('bills')
      .select('*, participants(*)')
      .eq('creator_phone', fromPhone)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(5);

    if (!bills || bills.length === 0) {
      return `🪶 RAVEN\n\nYou have no active bills.\n\nCreate one: SPLIT $120 Dinner @Jake @Mia`;
    }

    let response = `🪶 RAVEN — Your Bills\n\n`;
    bills.forEach(b => {
      const paidCount = b.participants.filter(p => p.paid).length;
      response += `📋 ${b.name} (${b.id})\n`;
      response += `   ${formatMoney(b.total)} · ${paidCount}/${b.participants.length} paid\n\n`;
    });
    response += `Reply STATUS [ID] for details`;

    return response;

  } catch (err) {
    console.error('BILLS error:', err);
    return `🪶 RAVEN\n\nSomething went wrong. Try again.`;
  }
}

// HELP
function handleHelp() {
  return `🪶 RAVEN Commands\n\nSPLIT $120 Dinner @Jake @Mia\n→ Create a new bill\n\nPAID B7K2\n→ Mark yourself as paid\n\nPAID B7K2 Jake\n→ Mark someone paid by name\n\nREMIND B7K2\n→ Ping everyone who still owes\n\nSTATUS B7K2\n→ See who's paid on a bill\n\nBILLS\n→ See all your active bills\n\nRequest Automatically Via Every Network 🪶`;
}

// ─── MAIN WEBHOOK ────────────────────────────────────────────────────────────

app.post('/sms', async (req, res) => {
  const fromPhone = normalizePhone(req.body.From || '');
  const rawBody = (req.body.Body || '').trim();
  const body = rawBody.toUpperCase();

  console.log(`📨 SMS from ${fromPhone}: ${rawBody}`);

  // Log message
  await supabase.from('message_log').insert({ from_phone: fromPhone, body: rawBody }).catch(() => {});

  let reply = '';

  if (body.startsWith('SPLIT')) {
    reply = await handleSplit(fromPhone, rawBody);
  } else if (body.startsWith('PAID')) {
    const parts = rawBody.trim().split(/\s+/);
    // PAID B7K2 Jake (3 parts = name-based)
    if (parts.length >= 3) {
      reply = await handlePaidByName(fromPhone, parts[1].toUpperCase(), parts.slice(2).join(' '));
    } else {
      reply = await handlePaid(fromPhone, rawBody);
    }
  } else if (body.startsWith('REMIND')) {
    reply = await handleRemind(fromPhone, rawBody);
  } else if (body.startsWith('STATUS')) {
    reply = await handleStatus(fromPhone, rawBody);
  } else if (body.startsWith('BILLS')) {
    reply = await handleBills(fromPhone);
  } else if (body.startsWith('HELP') || body === '?') {
    reply = handleHelp();
  } else {
    reply = `🪶 RAVEN\n\nHey! I split bills over text.\n\nTry: SPLIT $60 Dinner @Jake @Mia\n\nReply HELP for all commands.`;
  }

  // Send reply via Twilio TwiML
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(reply);
  res.type('text/xml').send(twiml.toString());
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'RAVEN is live 🪶', version: '1.0.0' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🪶 RAVEN SMS server running on port ${PORT}`));
