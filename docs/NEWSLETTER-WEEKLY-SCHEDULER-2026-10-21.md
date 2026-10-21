# Weekly newsletter scheduler — 2026-10-21

## Status and authority

The user requested: “finish the weekly scheduler, I want these out every monday at 10 am.” The existing planned timezone is America/New_York. Implementation and local tests are complete; production activation is NOT complete.

Two questions remain unanswered in this turn: permission to use an automatically rotating evergreen-tip catalogue, and approval to deploy/apply the private weekly migration and activate after Railway recovers. The ten new tips remain drafts. The original adjustable-shares issue remains approved. No customer email, production migration, subscription change or paid-service action occurred.

Railway still reports builds/deployments paused as of the October 21, 19:15 UTC update: https://status.railway.com/. Earlier album/backend and guest-payment releases are also pending; preserve them and follow their deployment order.

Target first scheduled send, if approved and activated in time: Monday October 26, 2026 at 10 AM Eastern (14:00 UTC). Do not claim it is scheduled live until the database schedule and running worker are verified.

## Implementation

- Existing Node backend worker checks every 60 seconds and once shortly after startup. No laptop/chat dependency, new service, cron subscription or paid dependency.
- PostgreSQL is the clock and lock authority. Schedule calculations explicitly use America/New_York, including daylight saving.
- New private tables: raven_newsletter_schedule, raven_newsletter_weekly_runs, raven_newsletter_weekly_deliveries. Migration installs paused and never enrolls subscribers or changes old campaigns.
- One campaign per local Monday and one delivery per account/email. Freeze the eligible, confirmed, opted-in audience once; late opt-ins wait until the following week.
- Only approved content can be queued. Content is snapshotted per weekly run. The original issue and ten new drafted tips reuse the approved RAVEN email design. Review copy: output/newsletter-weekly-content-review.md.
- Rotation is disabled by default. Without separate rotation approval, each approved issue is used once; an empty queue reports no_approved_content. With rotation enabled, the approved catalogue cycles predictably.
- Delivery consent, current confirmed email, lease and enabled schedule are rechecked immediately before the provider call.
- Store the exact provider request before sending. Network retries use the same body and stable Resend idempotency key. Database failure after provider acceptance cannot create a new payload/key.
- Five-minute leases recover interrupted workers; stale workers cannot overwrite a newer attempt. At most six attempts. Backoff for network/5xx/rate-limit errors; explicit provider/auth/quota failures are visible.
- Rate-gated claims across replicas (at most one new claim/second), bounded 20 deliveries per worker pass. Start is approximately 10 AM within the worker cadence; inbox arrival and time to complete an audience depend on provider latency, volume and limits.
- Same-Monday recovery is allowed until midnight Eastern. Expired weeks are recorded as needs_attention, never sent as a backlog. Ambiguous requests are not retried outside the provider deduplication window.
- Admin-only GET /admin/newsletter/status exposes next send, worker heartbeat, eligible count, approved-topic subjects and aggregate results/errors. No subscriber emails or private financial data.
- Private Admin workspace shows status, next Eastern send, accepted/pending/failed/skipped counts and failures. “Accepted” is provider acceptance, NOT proof of inbox delivery.
- Existing preview, preferences, monthly opt-in prompts, signed unsubscribe/one-click opt-out and legacy campaign sending remain intact.

## Tested

Run from output/account-release-backend. Set RAVEN_SITE_PATH=../account-release-site for test-newsletter.cjs.

Passed:
- output/test-newsletter-weekly.cjs — paused/rerunnable schema, exact Monday boundary, fall/spring DST, concurrent ticks, frozen audience/content/request, default no-reuse approval, enabled rotation, duplicate claims, lease recovery, old-lease rejection, unsubscribe/address/pause recheck, no late backlog, quota handling, aggregate admin status, service-only permissions, untouched old campaigns.
- output/test-newsletter-weekly-ui.cjs — 320/390/768px admin UI, status/error/date rendering, escaping, offline/account-switch handling; all 11 email templates mobile-checked. All network traffic intercepted.
- output/test-newsletter.cjs — existing subscription/claim/dedup/unsubscribe/monthly prompt migration behavior and dashboard/onboarding syntax.
- output/test-newsletter-api.cjs — existing consent, auth, unsigned/tampered links and provider headers/idempotency.
- output/test-album-notifications.cjs, output/test-guest-payments.cjs, output/test-raven-sweep.cjs, output/test-trip-custom-splits.cjs — pending releases and financial behavior unaffected.
- Syntax checks and git whitespace checks.

No production database/email testing was performed. Provider account quota and suppressions must still be checked through authorized access before activation; do not purchase or upgrade anything.

## Activation checklist (NOT executed)

1. Obtain the pending content-mode and deployment/migration approvals. If rotation is approved, mark the reviewed tips approved in raven-newsletter-issues.js, update the content-review record, and rerun tests. If per-issue review is chosen, leave rotation disabled and only approve the specific reviewed issues.
2. Confirm Railway has restored deployments for this account's plan. Do not repeatedly push/redeploy during the pause.
3. Deploy backend including the prior pending album/guest-payment changes. Confirm admin status endpoint is authenticated; a missing migration must fail closed with 503, not send.
4. Apply output/raven-newsletter-weekly.sql. Verify all new tables have RLS, no anon/authenticated privileges, and enabled=false. Existing subscribers/campaigns must be unchanged.
5. Check sending identity, provider configuration, current opted-in audience and available email allowance. The sending-only key previously could not read provider delivery logs. Do not assume quota or delivery success from the preview.
6. Activate only the singleton schedule row with enabled=true, the approved rotation_enabled choice, and next_run_at=raven_newsletter_next_monday(now()). Clear last_error. This chooses the next future Monday; it does not send a missed issue immediately.
7. Verify a recent last_checked_at and the intended next_run_at from the protected status endpoint. Verify the approved content catalogue. No actual test customer sends are necessary.
8. Deploy the website and verify the new admin status panel. Preserve the already-approved pending album migration and frontend changes; do not combine migrations blindly.
9. Report the actual live next-send date to the user, or clearly report any remaining blocker. Do not call the scheduler active before these checks.

Pause: update only enabled=false in the private schedule with explicit operator authority; immediate consent checks stop subsequent sends. Never clear sent records or regenerate idempotency keys to force a retry.

## Provider references

- Resend idempotency keys persist for 24 hours and matching retries must use the same payload: https://resend.com/docs/dashboard/emails/idempotency-keys
- Resend distinguishes transient rate-limit errors from daily/monthly quotas and invalid idempotency payloads: https://resend.com/docs/api-reference/errors
