# Trip balance payment summary

Display-only change to the Trip Hub's “Who owes what” rows:

- `Share`: personal allocation across receipts.
- `Paid`: receipts fronted by that person (unchanged meaning).
- `Sent` / `Received`: active recorded Sweep payments, shown only when nonzero.
- `Earlier adjustment`: signed legacy settlement credit adjustment, when present; never represented as a newly recorded transfer.
- The right-hand amount still uses the unchanged Sweep engine. A settled row is zero only when its actual net balance is zero.

Incoming and outgoing payments are summed in integer cents in one pass over the already-loaded, validated ledger. Undone payments are excluded. No additional database calls, external services, dependencies, migrations, permissions, or payment writes were added. The existing route's trip-summary synchronization remains unchanged.

The compact summary sits below the name/amount header, wraps between complete label/amount pairs, and no longer squeezes long names against the balance. Receipt spending and recorded repayments have distinct accessible group labels.

## Verification

All tests used synthetic fixtures and mocked browser traffic, with local PostgreSQL-compatible tests where applicable. No production receipts or payments were created or changed.

Passed:

- `node --check server.js`
- `node output/test-sweep-payment-summary.cjs`
- `node output/test-raven-sweep-ui.cjs`
- `node output/test-raven-sweep-explain.cjs`
- `node output/test-raven-sweep-api.cjs`
- `node output/test-raven-sweep.cjs`
- `node output/test-trip-custom-splits.cjs`
- `node output/test-sweep-balance-colors.cjs`
- `node output/test-receipt-gallery-deferred.cjs`

Browser suites use Playwright and the installed Edge browser. Set `NODE_PATH` to the bundled runtime's `node_modules` directory when needed.

Coverage includes partial/full payments, receipts fronted by multiple people, incoming and outgoing repayments for the same person, reversed records, case/whitespace aliases, JSON ledgers, one-cent amounts, legacy credits, empty and non-Sweep trips, unchanged balances/version/financial input, record/undo refresh, and 320/390/768px layouts. Mobile preview inspected at `output/sweep-payment-summary-mobile.png` (not shipped).

## Release scope

User approved deployment after testing in this conversation. Backend-only hosted page update; no site, native build, database migration, or monetization changes required.
