# RAVEN Sweep settlement repair

Sweep nets assigned shares and existing payment credits in integer cents. A $10 debt in one direction and a $5 debt back become a single $5 payment. Equally shared purchases costing $10 and $5 instead produce $2.50 net; gross spend is not itself a debt.

Only net debtors pay and only net creditors receive. Opposing debts cancel first, then exact-balance matches are preferred before largest remaining balances. Nobody acts as an intermediary or forwards reimbursements. This is a direct-payment heuristic, not a claim of globally minimizing transfer count. A person can have two recipients when necessary to reimburse everyone correctly. Each recipient has its own confirmation and payment record.

The UI uses "Owes" and "Gets back" instead of a signed "net" figure. Explanatory text appears only in the RAVEN Sweep information popup and contains no participant names. Share metadata includes the payer's own cost, even when a legacy receipt omits it. RAVEN never transfers money itself.

Install `output/raven-sweep-ledger.sql` before deploying. It is additive and rerunnable. No existing receipt, share, or recorded payment is rewritten by installation. The private service-role RPC compares a trip/receipt snapshot under a row lock and writes exact-dollar payment records and outstanding total atomically. Receipt writes take the same trip lock. Stale clients, duplicate clicks, changed receipts and incorrect amounts are rejected.

Sweep payments are separate from old receipt credits so a $5 net transfer never marks $10 of gross shares as paid. Undo reverses a record without deleting history. Recorded transfers survive percentage/dollar bill edits. Payer or member-identity changes require reconciliation if an active payment refers to them. Legacy credited amounts remain respected; old data does not identify actual transfer recipients, so it is not silently rewritten.

The Trip Hub is server-rendered. Reload it after release; this change does not require an App Store or TestFlight binary update. Existing pages with old balance versions must refresh before recording payments. The direct-net-v2 algorithm identifier is included in the version hash, so old intermediary-plan pages cannot record a newly routed payment using stale recipients. Previously recorded transfers are respected without rewriting history.

Tests: `test-raven-sweep.cjs` (math and PostgreSQL), `test-raven-sweep-api.cjs`, `test-raven-sweep-ui.cjs` (fully mocked mobile page), plus custom split, bill editor, and comment pagination regressions. No real customer bills are changed by these tests.
