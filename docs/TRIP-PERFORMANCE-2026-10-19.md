# Trip opening performance and larger-video request

## Scope and approval

The user requested faster trip opening, a separate album entry, and 500 MB per
video. They approved pushing the performance update and explicitly said not to
purchase anything. No subscription, billing setting, production data, permission,
or database schema changes are part of this performance release.

## Implemented

- A separate in-app Trip Photo Album action. It opens without loading flights or
  travel screenshots. Trip Center also links to it; no Safari window is opened.
- The album JavaScript and gallery API run only after the user opens the album.
  Trip Hub and Trip Center both make zero album requests before that action.
- Inline JPEG/PNG/WebP receipt photos are replaced in the HTML with on-demand
  image URLs. Access requires the same nonempty trip share token as the existing
  expense page, plus matching receipt/trip IDs. An invite token does not work.
- The image route does not proxy external URLs, rejects non-raster or mismatched
  signatures, uses private/no-store caching and does not write any records.
- Existing stored external photo URLs remain unchanged. Receipt thumbnails,
  detail images, and the saved-photo gallery use lazy loading/asynchronous decode.
- No payment calculations, persisted receipt fields, optimistic edit versions,
  settlement records, account permissions, or existing sharing rules change.

## Tests and limits of the measurements

All tests use synthetic data. No customer's trip, photo, video, bill or payment
was changed to test this work.

- All 20 local growth/financial/auth regression suites passed.
- Private receipt-photo tests: token and trip isolation, wrong receipt, invite
  denial, no external proxy, format signatures, errors, and unchanged financial
  page data/edit versions passed.
- Synthetic 17-receipt fixture with 1 MiB inline photos: initial HTML changed from
  approximately 95,485,245 bytes to 399,667 bytes (99.58% less HTML). This does not
  measure customer-device opening time or imply every trip gets that reduction.
- Full rendered Trip Hub browser tests passed: existing collapsed receipts open,
  images load/zoom/close, the new entry is visible, no client financial writes.
- Separate album tests passed: zero initial/gallery requests before entry, lazy
  script fetch, retry after failure, close during load, back navigation, cleanup,
  and 320/390/768px layout.
- Upload/gallery regression tests passed: previews, large MOV, retry/deduplication,
  progress, cancellation, permissions, paging and old-helper compatibility.
- Existing Trip Center/flight and balance-color browser tests passed.

Remaining performance work: the legacy server still reads inline receipt photos
from the database when building a trip. This release removes them from outgoing
HTML, not from that database read. A future metadata-only query/storage migration
can further reduce server work, with separate review and approval. Large existing
profile/comment media and slow networks can also affect opening time.

## 500 MB videos: not activated

The current project is on Supabase Free. Its global file cap is 50 MB, irrespective
of the application's or bucket's limit. Raising a client constant alone would
misrepresent what the system accepts. The 50 MB uploader therefore stays active.

Supabase Pro starts at $25/month, with additional-project/usage charges possible.
No purchase is authorized. The owner must review and complete any paid upgrade.

After the storage decision, implement and test a private direct-to-storage TUS
resumable path. Authorize linked membership before issuing short-lived upload
credentials for one random object; record expected owner/trip/type/size; verify
stored metadata and format before publishing the album entry; clean up expired
partial uploads; retain retry idempotency. Do not buffer 500 MB files in the main
Express process or expose a public bucket/service key. Raise global, album-bucket,
metadata-validation and UI limits together only after end-to-end tests and approval.

Official sources checked October 19, 2026:
- https://supabase.com/docs/guides/storage/uploads/file-limits
- https://supabase.com/docs/guides/storage/uploads/resumable-uploads
- https://supabase.com/pricing

## Release

Pending deployment confirmation. No native/App Store build required.
