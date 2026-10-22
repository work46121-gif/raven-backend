# RAVEN Plus — private pilot foundation

## Status and authority

The owner requested implementation of the proposed Free + Plus model on October 21, 2026, and subsequently approved deployment of this private preview and its private tables, plus the earlier outage-delayed updates. This is a **tested local foundation and private preview**, not an activated paid product. No purchases, production deployments, migrations, subscription grants, paid features, quotas or account changes have been performed for Plus.

Existing pending guest-payment, album and newsletter releases are preserved. This work is additive; it must not be described as deployed just because code exists or a Git commit is created.

## Implemented

- Owner-only `/admin/plus/preview`, using the existing server-verified admin middleware; an **Explore Plus** entry in the Admin workspace. No public paywall or launch page.
- Self-contained, mobile-first, box-light RAVEN design with the existing Wingcheck artwork, $5.99 monthly / $39.99 annual preview, explicit annual billing, Free vs Plus allowances and six interactive lifecycle examples.
- The preview is sandboxed and disallows network requests/forms. Sign-out or account changes discard/close it. Loading has a timeout and recoverable failure state.
- `raven-plus.js`: shared server/preview membership rules, production vs sandbox separation, paid-period expiry, cancellation through expiry, revocation, free joining, active-trip projection and current-member sponsorship evaluation. No badge/handle/email allowlist grants a paid entitlement.
- Private membership ledger, normalized event history, trip sponsorship table and service-only SQL functions. All new tables have RLS and revoke anon/authenticated/public access. The migration seeds no memberships or sponsors.
- Internal verified-event persistence handles duplicate events, conflicting event reuse, stale events, transaction/account binding and account-deletion cascades. **It does not verify Apple signatures. There is no public ingestion endpoint.** Only a future verified provider adapter may call it.
- Authenticated read-only `/me/membership` and `/trips/:id/membership`; actor IDs come from the verified session, not query/body values. Trip reads recheck confirmed-account membership. Responses omit billing IDs, receipt contents, emails and financial amounts. Missing setup/outages return an unavailable response, never a fabricated Free downgrade.
- Nothing calls these routes on dashboard/trip startup. Album/media/receipt loading is unchanged; there are no new startup requests or paid dependencies.

## Proposed policy — not enforced

| Item | Free | Plus |
|---|---|---|
| Price | $0 | $5.99/month or $39.99/year, proposed USD |
| Joining other trips | No cap | No cap |
| Active trips | Host one | Sponsor ten (draft; awaiting owner choice) |
| Shared album | 10 photos + 5 videos per trip | 5 GiB total per trip (draft; awaiting owner choice) |
| Individual photo | 6 MiB | 50 MiB |
| Individual video | 50 MiB | 500 MiB target; NOT enabled |
| AI scanning | Not yet specified | Not yet specified |
| Trip Pass | Deferred | Deferred |

The preview uses the app's existing MB naming convention for binary-size limits. Checkout must publish precise size/storage units consistently before launch. No promise of unlimited media or free permanent storage is made. Existing upload limits have not been lowered or raised by this release.

Joining is not a sponsored-trip slot. Explicit trip sponsorship must be implemented atomically before paid rollout, with an agreed cap. Current linked membership and an unexpired, non-revoked production entitlement are both necessary. A departed/expired sponsor cannot keep granting new premium benefits; another valid sponsor can retain them.

The original five selected accounts keep their **cosmetic** badges. They have not been silently enrolled, charged or granted free subscriptions. Any complimentary pilot entitlements require a separate explicit owner decision.

## Before charging anybody

1. Confirm ten vs unlimited sponsored trips and 5 vs 10 GiB shared albums (owner questions are pending). Set AI scan allowances from actual usage/cost measurements. Define retention, over-quota, sponsor departure, refund and cancellation terms; do not silently delete existing content or lock balances.
2. Obtain authorized App Store Connect setup for products and sandbox accounts. Use StoreKit with localized product prices and native purchase/restore/manage-subscription flows. Verify signed transactions and notifications on the server using Apple's maintained library, trusted certificate chain, expected bundle/app identity, product allowlist, environment and signed `appAccountToken` account binding. Do not trust a frontend `verified` flag. Reject purchase replay into another or recreated account. Store private provider credentials outside source control.
3. Implement atomic sponsor assignment and upload/scan reservations, with concurrency and abandoned-upload reconciliation. Enforce in the database/backend on every write path, not through badges/UI. Test period renewal/expiry, notifications out of order, duplicate provider events, refund/revocation, grace/retry policy and purchase restoration on device.
4. Audit trip creation before enabling quotas: the legacy `/trip/create` route currently trusts a supplied `creator_email`. Bind creation to authenticated identity and update all callers with an ordered compatibility rollout; otherwise creation limits can be bypassed. This foundation deliberately does not enforce quotas on that unmodified route.
5. Finish and load-test 500 MiB **resumable/direct private uploads** with server-authorized reservations and cleanup. The current binary server route is 50 MiB. Do not simply buffer 500 MiB files in Node. Confirm actual storage-plan limits, quotas and bandwidth budget; do not buy an upgrade without approval.
6. Verify which flight features are truly available (status vs alerts). Leave unfinished exports/extended history out of the sellable offer. Ensure bills/settlement/basic reads remain available without Plus.
7. Test the complete paid pilot in Apple sandbox, including fresh onboarding, logout/account switch, deletion, restoration, refunds and cancellation. Then obtain explicit production deployment/migration/activation approval.

Relevant official references reviewed for the proposal:

- Apple purchase rules: https://developer.apple.com/app-store/review/guidelines/#in-app-purchase
- Supabase cost/allowances: https://supabase.com/pricing

## Local checks

New `output/test-plus-membership.cjs`: JS membership and lifecycle rules; embedded PostgreSQL rerunnable private schema; duplicate/conflicting/stale events; cross-account rejection; production vs sandbox; sponsor departure; confirmed-user and linked-member reads; rejected anon/client SQL access; account-deletion cascade; auth-only API calls; sanitized output; bounded offline handling; unchanged bills/trips.

New `output/test-plus-preview-ui.cjs`: intercepted synthetic browser only; 320/390/768/1280px layouts; both prices and billing labels; six lifecycle examples; no external requests or checkout; admin entry/dialog isolation; focus return; account-switch/sign-out; failure recovery. Screenshots inspected at `output/plus-preview-mobile.png` and `output/plus-preview-desktop.png`.

Passed regression suites: Sweep, custom splits, guest payment details, trip album, album notifications, Plus badges, weekly newsletter worker and UI, and legacy newsletter. Backend/helpers and generated dashboard/preview scripts pass syntax checks. No test sent email or touched live financial/user data. No real purchase, physical-device StoreKit test or production migration has been run.

## Release / rollback

- Backend source: `output/account-release-backend`; site: `output/account-release-site`. Root mirrors are maintained separately without overwriting unrelated changes.
- Owner approval is recorded for deploying this private Plus feature and applying `output/raven-plus-membership.sql`, with checkout/limits OFF, and deploying the earlier pending updates. It is not paid launch, purchase, credential-revocation or newsletter-content-rotation approval.
- Deploy backend before the Admin button. The preview can work without the migration; membership read APIs safely return 503 until setup is applied. The migration alone activates nothing.
- No `live` flag or checkout endpoint is provided. Finishing payment verification and enforcement requires another reviewed release. No one can activate sales just by toggling a browser flag.
- If the private preview fails, remove/disable its entry and read-only routes. Do not drop membership data as a rollback. Existing core functionality is independent.

## Release hold — updated October 21, 8:45 PM Eastern

Railway's latest official update at October 22 00:22 UTC says builds remain unavailable. Its October 21 security disclosure reports possible access to some customers' decrypted environment variables and recommends rotating all secrets stored in Railway and checking service logs. It has not been established that RAVEN was affected. No secrets have been displayed, replaced or revoked by this work.

Deployment cannot finish while builds are paused. Do not apply the dependent production migrations out of sequence, push a frontend-only release, or queue an automatic release that bypasses credential review. Credential rotation requires an approved, coordinated response because immediate revocation while redeployment is unavailable can interrupt the running app. Official references: https://status.railway.com/ and https://blog.railway.com/p/security-disclosure-wednesday-october-21st
