'use strict';

// Push-only. This does not call the manual reminder endpoint (which sends email).
const DAY = 86400000;
const key = value => String(value || '').trim().toLowerCase();
function array(value) {
 try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : []; } catch (_) { return []; }
}
function schedule(trip, now = new Date()) {
 if (['deleted', 'cancelled', 'canceled', 'archived'].includes(key(trip.status)) || key(trip.type) === 'roommates') return null;
 const due = String(trip.due_date || '');
 if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
 const dueTime = Date.parse(due + 'T00:00:00Z');
 if (!Number.isFinite(dueTime) || new Date(dueTime).toISOString().slice(0, 10) !== due) return null;
 const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
 // First nudge on day 3 after due date, at/after 10 AM Eastern; no nighttime
 // sends or bursts of missed reminders when the worker restarts.
 if (Number(parts.hour) < 10 || Number(parts.hour) >= 20) return null;
 const age = Math.floor((Date.parse(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`) - dueTime) / DAY);
 if (age < 3) return null;
 return { due, cycle: Math.floor(age / 3), day: `${parts.year}-${parts.month}-${parts.day}` };
}

function recipients(trip, profiles, debtors) {
 const emails = new Set([...array(trip.member_emails), trip.creator_email].map(key).filter(Boolean));
 const linked = profiles.filter(p => emails.has(key(p.email)));
 const people = new Set(array(trip.people).map(key));
 const aliases = p => new Set([p.first_name, [p.first_name, p.last_name].filter(Boolean).join(' '), p.raven_id, p.raven_id && '@' + p.raven_id].map(key).filter(Boolean));
 const result = new Set();
 for (const debtor of debtors) {
  if (!(Number(debtor.amount) > 0.02) || !people.has(key(debtor.name))) continue;
  const matches = linked.filter(p => aliases(p).has(key(debtor.name)));
  // Duplicate first names are ambiguous. Never nudge a guessed account.
  if (matches.length === 1) result.add(matches[0].id);
 }
 return [...result];
}

module.exports = function createReminders(db, debtorsFor, env = process.env, clock = () => new Date()) {
 let busy = false;
 async function context(trip) {
  const [receipts, members] = await Promise.all([
   db.from('trip_receipts').select('id,splits,paid_by,total').eq('trip_id', trip.id),
   db.rpc('raven_push_linked_trip_profiles', { p_trip: String(trip.id) })
  ]);
  if (receipts.error) throw receipts.error;
  if (members.error) throw members.error;
  return recipients(trip, members.data || [], debtorsFor(trip, receipts.data || []));
 }
 async function eligible(event) {
  const { data: trip, error } = await db.from('trips').select('*').eq('id', event.source_id).maybeSingle();
  if (error) throw error;
  const slot = trip && schedule(trip, clock());
  if (!slot || event.event_key !== `trip_overdue:${trip.id}:${event.user_id}:${slot.due}:${slot.cycle}`) return false;
  return (await context(trip)).includes(event.user_id);
 }
 async function tick() {
  if (busy || !require('./raven-push').configured(env)) return;
  busy = true;
  try {
   const now = clock();
   // Keyset pagination, not Supabase's implicit first 1000 rows.
   let after = '';
   for (;;) {
    let query = db.from('trips').select('*').not('due_date', 'is', null).lte('due_date', now.toISOString().slice(0, 10)).order('id').limit(100);
    if (after) query = query.gt('id', after);
    const { data, error } = await query;
    if (error) throw error;
    for (const trip of data || []) {
     const slot = schedule(trip, now);
     if (!slot) continue;
     const users = await context(trip);
     if (!users.length) continue;
     // SQL serializes per trip, checks opt-in/session, and deduplicates across
     // Railway replicas/restarts and edits to a trip's due date.
     const { error } = await db.rpc('raven_enqueue_trip_reminders', { p_trip: String(trip.id), p_due: slot.due, p_cycle: slot.cycle, p_users: users });
     if (error) throw error;
    }
    if (!data?.length || data.length < 100) break;
    after = data[data.length - 1].id;
   }
  } catch (_) {
   console.warn('[push] Overdue reminder scan pending');
  } finally { busy = false; }
 }
 const timer = setInterval(tick, 60000);
 timer.unref();
 return { tick, eligible, stop: () => clearInterval(timer) };
};
module.exports.schedule = schedule;
module.exports.recipients = recipients;
