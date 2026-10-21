# Bill preview payment details and layout — 2026-10-21

Status: implemented and tested locally; production deployment is not yet authorized for this follow-up.

## Changes
- Bill creators can open Payment details directly beside an unlinked guest in View Bill.
- Editor loads existing bill-scoped Venmo ID, Cash App tag, and Apple Pay number; supports save, clear, and retry.
- Registered users keep control of their own profile payment methods. Guest edits require verified creator authentication and the matching bill token.
- Participant ID and guest identity preconditions reject stale edits after reassignment. Late editor loads do not replace a newer editor.
- Pay remains directly accessible. Assign/Change RAVEN ID and Remove are grouped under Manage.
- Plus artwork is 18px next to the name with a 24px independent tap target; profile artwork is 20px. The badge still opens RAVEN Plus Member.
- Mobile rows separate identity/status from actions, truncate long names, and stack the status on narrow screens.
- Reuses the already deployed private guest-payment table and atomic save function. No new database migration.

## Verification
Passed:
1. output/test-guest-payments.cjs — normalization, creator-only reads/writes, share-token check, cross-bill rejection, stale assignments, clear semantics, RLS, atomic persistence, unchanged balances.
2. output/test-bill-preview-ui.cjs — actual dashboard preview at 320/390/768px, adjacent badge, profile vs badge actions, guest prefill/save/clear/retry, account-switch rejection, long names.
3. output/test-plus-badge.cjs — stable identity badge, existing Trip Hub/classic/live bill/profile integration and accessibility.
4. output/test-guest-profile-ui.cjs — existing standard bill guest creation/retry/payment/profile flows.
5. output/test-raven-sweep.cjs — exact cents, ledger and settlement regressions.
6. output/test-trip-custom-splits.cjs — shares, charges, quantities, payer correction and atomic update regressions.
7. output/test-sweep-payment-summary.cjs — debit/credit summary and mobile regressions.
8. JS syntax, dashboard inline-script parsing, and Git whitespace checks.

Browser tests use synthetic records with network interception, not production accounts or financial data.
Visuals inspected: output/bill-preview-clean-mobile.png and output/bill-preview-guest-editor-mobile.png.

## Release
Deploy backend before site. No native build or schema change is required.
Backend files: raven-guest-payments-server.js, raven-plus-badge.js.
Site files: dashboard.html, raven-guest-payments-client.js, raven-plus-badge.js.
Do not deploy the whole root workspace; release repositories contain the scoped changes.

