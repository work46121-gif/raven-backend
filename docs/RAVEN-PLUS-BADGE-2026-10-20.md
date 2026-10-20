# RAVEN Plus Wingcheck badges — 2026-10-20

## Scope and approval

Owner selected @melad, @t, @arsalan, @nicholas110 (corrected from @nicholas), and @will, and approved deployment after testing.

This is a cosmetic badge only. It does not activate subscriptions, charge anyone, grant permissions, change upload/trip limits, modify payment records, or enforce the future monetization tiers.

## Identity and presentation

- Fixed account UUID roster in raven-plus-badge.js; resolved read-only from the exact requested RAVEN IDs. No first-name/handle fallback. Renaming a selected account retains its badge; recreating a deleted account does not inherit it.
- Trip membership decoration uses existing linked profiles with unambiguous aliases or explicit account identifiers. Global first-name matches alone never award badges.
- The custom purple wing/check with green plus appears next to linked names in Trip Hub balances and receipt payer/share rows, shared bill participant/payer rows, dashboard receipt participants, own profile/settings, member profiles, and friends.
- A real accessible button opens “RAVEN Plus Member.” Escape, close, and outside-tap dismissal; focus returns on explicit close. Events cannot trigger the underlying receipt/profile/payment action.
- No extra profile API calls, fonts, or per-person image requests; the vector is inline. One small shared dashboard script and inline backend helper.

## Verification

Passed against both root and release sources:

- New output/test-plus-badge.cjs: five UUID assignments; guest/name/handle impersonation exclusion; one-character @t; real Trip Hub and classic/live bill render; refreshed bill participants; dashboard identity markup; tap/keyboard/escape/outside behavior; deduplication/account-switch cleanup; no nested buttons; 320/390/768px layout; no mutations. All data synthetic and all browser network intercepted.
- Existing Sweep UI, payment-summary, receipt-gallery-background-loading, and receipt-color browser regressions.
- Sweep core/explanations/custom splits/API and PostgreSQL regression harnesses (local/synthetic), exact-cent accounting, stale-token rejection, and preserved transfers.
- Server/helper and generated dashboard/bill/trip script syntax; scoped diff whitespace checks.

No physical iOS-device session was exercised. The badge uses the existing hosted web views; no native rebuild or database migration is required.

## Release status

The implementation is tested and ready to push. Railway currently shows “New builds are temporarily paused” and “Deploys have been paused temporarily” on the existing primary backend. The active service remains the prior Sent/Received release. Do not claim these badges, the earlier debit/credit color update, or receipt ordering are live until successful deployments are confirmed.

Official incident: https://status.railway.com/incident/JUA1PC5H
Existing service: charismatic-success / raven-backend (96c144cf-398a-4ecb-9c94-8c75aa05f68c)
Existing site: honest-learning / raven-site

Resume by deploying the exact approved latest main revisions on these existing services after Railway resumes builds. Do not purchase a plan, change hosting/permissions, or alter accounts to work around this incident.
