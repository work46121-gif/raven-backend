# Trip album uploader details and summary notifications — October 21, 2026

## Release status

Implemented and tested locally. The user approved deployment and the notification migration after testing and Railway recovery. Railway's status page still reports builds/deployments paused (latest observed update: October 21, 18:15 UTC; incident QH8L8B3E). Do not apply the production migration or repeatedly redeploy while that remains true.

The previously approved bill-preview release remains pending too: backend cf075db was pushed but not active at the last public probe; site 07a2786 is local. These album changes build on those commits, so deploy them in the order below.

## Changes

- Grid tiles show the uploader's profile photo at bottom-right, with initials when unavailable.
- The viewer places the uploader's name, avatar and local upload date/time below the media. Existing uploads already contain uploader IDs and timestamps; no backfill is necessary.
- Save photo and Save video share/download the original file. Preparing the file requires one tap; the next tap opens the device share sheet or requests a browser download. Remove is visually separated.
- API enforcement and UI permissions allow only the original uploader to remove an individual album item. Trip organizers cannot remove other members' items.
- One bounded profile lookup per 24-item page; failed profile lookup falls back without blocking the gallery.
- Album media still loads only inside the album. Trip entry and Trip Center do not fetch the gallery.
- Stable batch IDs group multi-file uploads and retries into one summary per eligible recipient: “New photos added in a trip”.
- Reuses the existing private push-event queue and opted-in device delivery. The uploader is excluded. Current trip membership is checked again before delivery and before returning the authenticated inbox feed.
- Summary delivery waits 90 seconds after the most recent upload in an unclaimed batch. Delivered/claimed batches are never reopened by retrying. Old clients without batch IDs coalesce uploads into five-minute windows.
- The authenticated inbox feed exposes only event ID, trip ID, trip name and timestamp. Lock-screen text contains no names, captions, media, or financial details.
- Uploads remain compatible before the additive migration. Notification feed failures do not break the existing inbox.

No financial calculations, payment records, existing media, upload limits, account permissions, subscriptions or purchases are changed.

## Migration

File: output/raven-trip-album-notifications.sql

Adds nullable upload_batch_id to raven_trip_album, adds trip_album to the existing notification-kind constraint, creates a recipient/date partial index, and installs a private insert trigger for batch summaries. No existing uploads are updated and no old activity is backfilled. RLS and service-only access remain intact. The migration is transactional and rerunnable.

## Verification

All 14 applicable suites passed from output/account-release-backend using synthetic fixtures, local HTTP/in-memory PostgreSQL, and network-intercepted headless Edge:

- test-trip-album.cjs — private storage/schema, uploader-only deletion, organizer denial, pagination, profile fallback, unchanged cleanup.
- test-trip-album-binary.cjs — real local 50 MiB photo/video uploads, limits, signatures, auth isolation, concurrency limits, retry dedupe, batch headers and pre-migration fallback.
- test-trip-album-ui.cjs — actual album/travel UI, avatar position, uploader/time, Save photo/video, canceled share retry, browser download, separated actions, uploader permissions, batching, retry/cancel, paging and 320/390/768px layouts.
- test-trip-lazy-album.cjs — no gallery requests on trip entry or travel view; lazy loading, retry and close races.
- test-album-notifications.cjs — SQL migration rerun, ten-file batch dedupe, retry dedupe, sender exclusion, membership, delivery-time checks, no old alerts, no balance changes, private inbox feed/read state, provider skip/retry.
- test-push-upgrade.cjs and test-push-upgrade-sql.cjs — existing notifications, reminders, recipients, opt-out and private permissions. Updated the VM harness to supply existing Sweep dependencies; no payment implementation changed.
- test-guest-payments.cjs, test-bill-preview-ui.cjs, test-plus-badge.cjs, test-guest-profile-ui.cjs — pending guest-payment/badge release remains intact.
- test-raven-sweep.cjs, test-trip-custom-splits.cjs, test-sweep-payment-summary.cjs — exact cents, receipt splits and existing settlement behavior preserved.

Syntax checks passed for all changed scripts and all six executable dashboard inline scripts; whitespace checks passed. Mobile screenshots were visually inspected at output/trip-album-uploader-viewer.png and output/trip-album-mobile-preview.png.

No live customer uploads, production notification sends, financial mutations, or physical iPhone testing were performed. Device-specific Save Image/Save Video destinations depend on the native share sheet and require a device smoke test after release.

## Safe deployment order

1. Confirm Railway recovery and verify release branches against their remotes.
2. Push/deploy the backend album commit (also contains pending bill-preview backend cf075db).
3. Confirm /me/trip-album-notifications and the guest-payment edit endpoint return JSON 401 without credentials; confirm the album helper contains the new byline/save UI.
4. Apply ONLY the approved album notification migration; verify upload_batch_id, trigger, recipient index, preserved constraints, and private permissions with read-only queries. Do not create production test uploads or alerts.
5. Push/deploy the site album commit (also contains pending bill-preview site 07a2786).
6. Verify dashboard buildAlbumNotifications and travel helper version 20261021-uploader, then smoke-test with an authorized account and existing media without sending payments or deleting media.

Rollback: restore prior application commits if necessary, retain the additive nullable column/index. If notification triggering is the issue, disable only raven_trip_album_summary_added with explicit operational approval; do not remove existing media, event history, or financial data.
