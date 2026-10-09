# RAVEN notification upgrade

- Owner-only Admin account snapshots and recent-member API show `push_notifications`: enabled, not_registered, service_unavailable, or unavailable. Counts/platforms only; tokens are never returned. Registration is not a guarantee the OS will display a banner (Focus and later permission changes can suppress it).
- New native signups get an optional Allow / Not now dialog when onboarding finishes. Allow uses the existing native permission + authenticated registration flow. No automatic opt-in, no popup just for logging into an existing account. Later OS revocation is cleaned up when the app becomes visible.
- DM, group and Trip Hub messages: “First name sent you a message on RAVEN”. Trip comments: “First name added a comment on trip Trip name”. No message bodies or amounts are placed on the lock screen.
- Trip notifications now use text trip IDs, matching the production schema. The former UUID-only trigger silently skipped the short IDs.
- Push-only overdue reminders begin three calendar days after `due_date`, then every three days; 10:00–19:59 America/New_York (DST-aware). Missing due dates, cancelled/deleted/archived trips and roommate ledgers are excluded. Completed travel can still have an unpaid bill.
- Uses the existing Trip Hub balance/settled-credit calculation. Recipients must be explicitly linked by member/creator email; ambiguous same-name matches are skipped. Sender/provider retries recheck current membership, date and balance before delivery.
- Per-trip SQL locking, unique event keys and a three-local-day guard prevent duplicate/burst reminders on restarts, concurrent workers or due-date edits. Missed windows never backfill a backlog.
- Existing registered native apps receive server-side wording/reminder improvements without another download. The new signup dialog and admin UI are bundled into the next native build. App Store users lacking the push plugin require a public release and must allow notifications. TestFlight does not update App Store users.
- Browser/PWA notification permission is separate: this release does not implement remote Web Push subscriptions/VAPID. Admin labels explicitly distinguish native registration from that browser toggle.

## Database

Apply `raven-notification-upgrade.sql` to the existing phone-alert schema. Full fresh install: `raven-phone-alerts-migration.sql`. Both are transactional; no old activity is backfilled. Existing device registrations and balances are preserved.

## Validation

`node output/test-push-upgrade.cjs`

Install the isolated SQL fixture dependency under `output/push-test-runtime`, then run `node output/test-push-upgrade-sql.cjs`. PGlite runs the real migration and triggers against synthetic data only.

`output/test-phone-alerts-settings.cjs` covers the actual bridge/Settings handler in a mocked native browser fixture, signup consent, retry, and OS revocation. Run with Playwright available through NODE_PATH. It does not prove delivery to a physical iPhone.

Physical end-to-end check still required: enable push in the updated app, background it, then receive an authorized test message/comment. Check provider delivery logs without printing tokens or message bodies.
