'use strict';
// RAVENBOT uses the payment engine's integer-cent results, never AI arithmetic.
const S = require('./raven-sweep');
const money = value => '$' + (S.cents(value) / 100).toFixed(2);
function describe(trip, receipts, current = S.build(trip, receipts)) {
  const people = S.parse(trip.people, []);
  const original = S.build({ ...trip, settled_people: {}, sweep_payments: [] }, receipts);
  const canon = new Map(people.map(name => [S.key(name), name]));
  const bills = receipts.map(r => {
    const payer = canon.get(S.key(r.paid_by));
    const shares = Object.fromEntries(people.map(name => [name, 0]));
    const total = S.cents(r.total);
    if (payer) {
      for (const [alias, amount] of Object.entries(S.parse(r.splits, {}))) {
        const name = canon.get(S.key(alias));
        if (name && name !== payer) shares[name] += Math.max(0, S.cents(amount));
      }
      shares[payer] = total - Object.values(shares).reduce((sum, amount) => sum + amount, 0);
    }
    const others = people.filter(name => name !== payer);
    const roundedShare = people.length ? Math.round(total / people.length) : 0;
    const equalRoundedOthers = !!payer && total > 0 && others.length > 0 && others.every(name => shares[name] === roundedShare);
    return { name: r.name || 'Receipt', paid_by: payer || r.paid_by || 'Not recorded', total: total / 100,
      shares: Object.fromEntries(Object.entries(shares).map(([name, amount]) => [name, amount / 100])),
      rounding: equalRoundedOthers && shares[payer] !== roundedShare ? { others: others.length, each: roundedShare / 100, payer_share: shares[payer] / 100 } : null };
  });
  const balances = people.map(name => {
    const paid = bills.filter(r => r.paid_by === name).reduce((sum, r) => sum + S.cents(r.total), 0);
    const rawNet = S.cents(original.netByPerson[name]);
    const net = S.cents(current.netByPerson[name]);
    return { name, paid: paid / 100, share: (paid - rawNet) / 100, before_settlements: rawNet / 100, settlement_adjustment: (net - rawNet) / 100, net: net / 100,
      payments: Object.entries(current.payoutsByPerson[name] || {}).map(([to, amount]) => ({ to, amount })) };
  });
  return { version: current.version, outstanding: current.outstanding, bills, balances };
}
function explainsBalance(message) {
  return /\b(sweep|owe\w*|owed|pay\w*|paid|reimburs\w*|settle\w*|balanc\w*|netted|offset\w*|both|breakdown|cents?|rounding|shares?|totals?)\b/i.test(String(message || ''));
}
function reply(info, person) {
  const selected = person ? info.balances.find(p => S.key(p.name) === S.key(person)) : null;
  if (person && !selected) throw Error('That person is not on this trip. Refresh and try again.');
  const lines = [];
  if (selected && selected.net < 0) {
    lines.push(selected.name + ' owes ' + money(-selected.net) + ' in total.');
    if (selected.payments.length > 1) lines.push('This is ONE balance divided between ' + selected.payments.length + ' recipients, not extra charges.');
    lines.push('', 'Payments to make');
    selected.payments.forEach(p => lines.push('• ' + money(p.amount) + ' to ' + p.to));
    lines.push('Total: ' + selected.payments.map(p => money(p.amount)).join(' + ') + ' = ' + money(-selected.net));
    if (selected.payments.length > 1) {
      lines.push('', 'Why more than one recipient?');
      selected.payments.forEach(p => {
        const recipient = info.balances.find(b => b.name === p.to);
        const other = (S.cents(recipient.net) - S.cents(p.amount)) / 100;
        lines.push(p.to + ' still needs ' + money(recipient.net) + '. Other people\'s planned payments cover ' + money(other) + '; ' + selected.name + '\'s ' + money(p.amount) + ' completes that amount.');
      });
      lines.push('Sending this entire balance to just one of these recipients would overpay them under this plan. They would need to forward the excess. Sweep avoids that extra handoff.');
    }
  } else {
    lines.push('RAVEN Sweep — current payment breakdown');
    if (selected) lines.push(selected.name + (selected.net > 0 ? ' gets back ' + money(selected.net) + '; they do not need to forward money.' : ' is settled.'));
  }
  lines.push('', 'Bills paid');
  info.bills.forEach(r => lines.push('• ' + r.name + ': ' + money(r.total) + ' paid by ' + r.paid_by));
  if (!info.bills.length) lines.push('No bills have been added.');
  lines.push('', 'Paid minus personal share');
  info.balances.forEach(p => {
    const result = p.net > 0 ? 'gets back ' + money(p.net) : p.net < 0 ? 'owes ' + money(-p.net) : 'settled ($0.00)';
    const adjustment = p.settlement_adjustment ? ' ' + (p.settlement_adjustment > 0 ? '+' : '−') + ' ' + money(Math.abs(p.settlement_adjustment)) + ' in recorded settlement adjustments' : '';
    lines.push('• ' + p.name + ': ' + money(p.paid) + ' paid − ' + money(p.share) + ' share' + adjustment + ' → ' + result);
  });
  const roundedBills = info.bills.filter(r => r.rounding);
  if (roundedBills.length) {
    lines.push('', 'Where the cents come from');
    roundedBills.forEach(r => {
      const otherTotal = (r.rounding.others * S.cents(r.rounding.each)) / 100;
      lines.push('• ' + r.name + ': ' + r.rounding.others + ' other people × ' + money(r.rounding.each) + ' = ' + money(otherTotal) + '. ' + money(r.total) + ' − ' + money(otherTotal) + ' leaves ' + r.paid_by + '\'s own share at ' + money(r.rounding.payer_share) + '.');
    });
    lines.push('These saved receipts put the leftover rounding cents on the payer. That can make the payers\' combined shares differ by a few cents. It is not an extra fee or an extra payment.');
  }
  if (selected && info.bills.length) {
    const parts = info.bills.filter(r => S.cents(r.shares[selected.name]) !== 0).map(r => money(r.shares[selected.name]) + ' (' + r.name + ')');
    if (parts.length) lines.push('', selected.name + '\'s receipt shares: ' + parts.join(' + ') + ' = ' + money(selected.share) + '. Recorded settlements, if any, then adjust what is still owed.');
  }
  if (!selected || selected.net >= 0) {
    lines.push('', 'Payments to make');
    const debtors = info.balances.filter(p => p.net < 0);
    debtors.forEach(p => lines.push('• ' + p.name + ': ' + p.payments.map(v => money(v.amount) + ' to ' + v.to).join(' + ') + ' = ' + money(-p.net) + ' total'));
    if (!debtors.length) lines.push('None — everyone is settled.');
    if (debtors.some(p => p.payments.length > 1)) lines.push('A person with two recipients still pays only their one total. The two amounts fill the recipients\' remaining reimbursements; neither recipient has to collect and forward money.');
  }
  lines.push('', 'How Sweep works');
  lines.push('Amounts owed in both directions cancel first. People who owe then pay people who are still owed money directly. Paying the largest bill does not make someone the only person who should be reimbursed.');
  lines.push('Remaining to pay across the trip: ' + money(info.outstanding) + '. Personal shares include the receipt\'s cent rounding.');
  lines.push('Record each payment only after sending it. RAVEN does not move money automatically.');
  return lines.join('\n');
}
module.exports = { describe, explainsBalance, reply };
