'use strict';
// Real Trip Hub HTML, synthetic records only. All browser traffic is intercepted.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { renderTrip } = require('./test-trip-custom-page.cjs');
const S = require('../raven-sweep');
const E = require('../raven-sweep-explain');
const base = { id: 'TEST', share_token: 'token', invite_token: 'invite', name: 'Payment summary test',
  people: ['Alex', 'Blair', 'Casey'], simple_split: true, settled_people: {}, sweep_payments: [] };
const bills = [
  { id: 1, name: 'Stay', paid_by: 'Alex', total: 90.01, splits: { Blair: 30, Casey: 30 } },
  { id: 2, name: 'Dinner', paid_by: 'Blair', total: 30.02, splits: { Alex: 10.01, Casey: 10.01 } }
];
const partial = { ...base, sweep_payments: [
  { id: 'first', from: ' casey ', to: ' ALEX ', amount: '0.01', created_at: '2026-10-20T12:00:00Z' },
  { id: 'undone', from: 'Blair', to: 'Alex', amount: 9.99, reversed_at: '2026-10-20T13:00:00Z' }
] };
const settled = { ...base, sweep_payments: [
  { id: 'one', from: 'Blair', to: 'Alex', amount: 9.98 },
  { id: 'two', from: 'Casey', to: 'Alex', amount: 40.01 }
] };
// Old intermediary payments may legitimately include both directions.
const both = { ...base, sweep_payments: [...settled.sweep_payments,
  { id: 'three', from: 'Alex', to: 'Blair', amount: 1.01 },
  { id: 'four', from: 'Blair', to: 'Alex', amount: 1.01 }
] };
const money = n => '$' + (Math.abs(n) / 100).toFixed(2);
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 1000 }, isMobile: true });
    let html = '';
    const errors = [], financialRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request();
      if (request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
      if (request.resourceType() === 'script') return route.fulfill({ contentType: 'application/javascript', body: '' });
      if (request.resourceType() === 'stylesheet') return route.fulfill({ contentType: 'text/css', body: '' });
      if (/mark-settled|sweep-payment|edit-receipt/.test(request.url())) financialRequests.push(request.url());
      return route.fulfill({ contentType: 'application/json', body: '{"success":true,"data":[],"profiles":[],"comments":[],"messages":[],"total":0}' });
    });
    async function check(trip, receipts = bills) {
      const snapshot = JSON.stringify({ trip, receipts }), before = S.build(trip, receipts), writes = [];
      html = await renderTrip(trip, receipts, writes);
      assert.equal(JSON.stringify({ trip, receipts }), snapshot, 'render does not mutate records');
      assert.deepEqual(S.build(trip, receipts), before, 'balances and version unchanged');
      assert.ok(writes.every(w => w.table === 'trips' && Object.keys(w.value).every(k => ['total', 'debtor_count', 'settled_count'].includes(k))), 'only existing trip summary writes');
      await page.goto('https://payment-summary.test/trip/TEST?t=token&app=1');
      const info = E.describe(trip, receipts);
      for (const name of trip.people) {
        const row = page.locator('[data-trip-member-row]').filter({ has: page.locator('[data-open-profile]').filter({ hasText: name }) });
        assert.equal(await row.count(), 1);
        const detail = E.breakdown(info, name);
        const expected = { share: S.cents(detail.share), paid: S.cents(detail.paid), sent: S.cents(detail.sent), received: S.cents(detail.received), 'earlier-adjustment': S.cents(detail.earlier_adjustment) };
        for (const [label, cents] of Object.entries(expected)) {
          const meta = row.locator('[data-balance-meta="' + label + '"]');
          assert.equal(await meta.count(), cents ? 1 : 0, name + ' shows only applicable ' + label);
          if (cents) {
            assert.ok((await meta.innerText()).endsWith((label === 'earlier-adjustment' ? cents < 0 ? '−' : '+' : '') + money(cents)));
            const color = await meta.evaluate(el => getComputedStyle(el).color);
            assert.equal(color, label === 'received' ? 'rgb(119, 221, 168)' : ['paid', 'sent'].includes(label) ? 'rgb(242, 141, 155)' : 'rgb(152, 150, 168)', 'credit/debit colors retain readable labels');
          }
        }
        assert.equal((await row.locator('.person-balance-display').innerText()).trim(), money(S.cents(detail.net)));
        assert.equal(expected.paid - expected.share + expected.sent - expected.received + expected['earlier-adjustment'], S.cents(detail.net), 'displayed amounts reconcile to the cent');
      }
      return page.locator('[data-trip-member-row]');
    }
    await check(base);
    assert.equal(await page.getByRole('group', { name: 'Recorded settlements', exact: true }).count(), 0, 'no empty settlement line');
    await check(partial);
    assert.equal(await page.locator('#row-person-Alex [data-balance-meta="received"]').innerText(), 'Received $0.01');
    assert.equal(await page.locator('#row-person-Casey [data-balance-meta="sent"]').innerText(), 'Sent $0.01');
    await check({ ...partial, sweep_payments: JSON.stringify(partial.sweep_payments) });
    await check({ ...partial, sweep_payments: partial.sweep_payments.map(p => ({ ...p, reversed_at: '2026-10-20T14:00:00Z' })) });
    await check(settled);
    assert.equal(await page.locator('[data-trip-member-row][data-is-settled="1"]').count(), 3, 'all settled only when actual net is zero');
    await page.locator('#row-person-Alex').evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: 'output/sweep-payment-summary-mobile.png' });
    assert.equal(await page.locator('#row-person-Alex .person-balance-display').evaluate(el => getComputedStyle(el).color), 'rgb(48, 209, 88)', 'settled balance keeps original RAVEN green');
    await check(both);
    assert.equal(await page.locator('#row-person-Alex [data-balance-meta="received"]').innerText(), 'Received $51.00');
    assert.equal(await page.locator('#row-person-Alex [data-balance-meta="sent"]').innerText(), 'Sent $1.01');
    await check({ ...base, settled_people: { 'casey::receipt::1': 5.01 }, sweep_payments: partial.sweep_payments });
    await check({ ...base, settled_people: ['Casey'] });
    await check({ ...base, settled_people: { Casey: 999999 } });
    await check(base, []);
    // Long names, real four-part summary, and six-figure amounts at phone widths.
    const longName = 'Alexanderthetravelerwithaverylongname';
    const longTrip = { ...base, people: [longName, 'Blair'], sweep_payments: [
      { id: 'a', from: 'Blair', to: longName, amount: 100000 },
      { id: 'b', from: longName, to: 'Blair', amount: 0.01 }
    ] };
    await check(longTrip, [{ id: 4, name: 'Group trip', total: 200000, paid_by: longName, splits: { Blair: 100000 } }]);
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.locator('[data-trip-member-row]').evaluateAll(rows => rows.every(row => {
        const boundary = row.getBoundingClientRect();
        return row.scrollWidth <= row.clientWidth && [...row.querySelectorAll('[data-balance-meta],.sweep-balance-open,[data-open-profile]')].every(el => {
          const box = el.getBoundingClientRect();
          return box.left >= boundary.left && box.right <= boundary.right;
        });
      })), 'rows contain all labels at ' + width + 'px');
      assert.ok(await page.locator('[data-trip-member-row]').evaluateAll(rows => rows.every(row => row.querySelector('[data-open-profile]').getBoundingClientRect().right <= row.querySelector('.sweep-balance-open').getBoundingClientRect().left)), 'name and balance never overlap at ' + width + 'px');
    }
    // Non-Sweep trips keep their existing settlement behavior.
    html = await renderTrip({ ...base, simple_split: false }, bills);
    await page.goto('https://payment-summary.test/trip/TEST?t=token&app=1');
    assert.equal(await page.locator('[data-balance-meta="sent"],[data-balance-meta="received"]').count(), 0);
    assert.equal(await page.locator('[data-balance-meta="paid"]').count(), 2);
    assert.deepEqual(financialRequests, []);
    assert.deepEqual(errors, []);
    const luminance = hex => hex.match(/[a-f0-9]{2}/gi).map(v => parseInt(v, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    for (const text of ['#F28D9B', '#77DDA8']) {
      for (const background of ['#0C0C12', '#13131A', '#0E271B']) {
        assert.ok((luminance(text) + 0.05) / (luminance(background) + 0.05) >= 4.5, 'small-text contrast on dark and highlighted rows');
      }
    }
    console.log('PASS payment summary: incoming/outgoing, partial/full/undone, both directions, aliases/JSON, cents, legacy credits, empty/non-Sweep trips, unchanged balances/data, accessible debit/credit colors, and 320/390/768px layout. Synthetic records only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
