# Profile badges and bill-scoped guest payment details

## Scope
- Plus badge appears in Friends/linked bill profiles, own settings, and Trip Hub profiles.
- Creator badge is tied to @melad's existing immutable account ID, never a display name or unverified handle.
- Optional Venmo ID, Cash App tag, and Apple Pay number appear under each plain-name guest in the standard bill wizard. Explicit @RAVEN IDs continue to use that account's settings.
- Guest contacts are used only when that exact guest is the bill's selected payer. These are manually supplied, not verified provider identities. RAVEN does not send money.
- No subscription, limit, balance, payment, or existing account permission changes.

## Storage and authorization
`output/raven-guest-payment-methods.sql` adds an RLS-enabled table. No anonymous/authenticated direct access. Only the service role can execute its atomic save function. The API requires verified creator authentication and the bill's editing token to write; only the current payer's methods are readable by the creator, linked members, or a valid payment link. View-only HTML does not include contacts.

The save function locks the bill and participant rows, rechecks owner and guest identity, rejects linked accounts and invalid contacts, and upserts atomically. A subsequent assignment to a registered account suppresses old guest contacts. Foreign keys clean contacts when the bill, participant, or creating auth account is hard-deleted. Shared financial records are not modified by this migration.

Drafts stay in browser memory, not localStorage. Failed contact saves show a retry attached to the already-created bill; retry never creates another bill. Only guest payment contacts enter the new API, never receipt contents or balances.

## Verification
- `node output/test-guest-payments.cjs`: normalization, creator/token checks, private reads, atomic/idempotent SQL, role restrictions, stale identity, cleanup, unchanged amounts.
- `node output/test-guest-profile-ui.cjs`: actual dashboard functions with synthetic browser/db/network; mobile 320/390/768; persistence, failed retry, payer links, Creator/Plus profile display.
- `node output/test-plus-badge.cjs`: classic/live guest payer rendering, Trip Hub/profile badge, identity spoof rejection and accessibility.
- Existing Sweep, explanations, custom splits, payment-summary and deferred-photo regression suites.

Production migration requires explicit approval. Production smoke tests are read-only; no fake financial data or real payment execution.

## Separate follow-up
Supabase's existing advisor reports RLS disabled on pre-existing profiles/participants and other tables. This release does not broaden those grants or silently change existing account permissions. Those legacy protections need a separately scoped review; the new guest table itself has RLS and no client grants.
