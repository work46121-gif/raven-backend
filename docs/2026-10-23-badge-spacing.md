# Trip name/checkmark spacing

## Scope

Display-only correction approved for deployment on October 23, 2026.

- Group the display name and existing tappable Plus checkmark as one compact unit.
- Apply to balance rows, receipt share chips, receipt payer labels and expanded receipt details.
- Keep the icon 4 CSS pixels from the visible name, without shrinking the existing 24-pixel badge target.
- Wrap `Paid by` separately from the name/checkmark pair. Constrained long names use ellipsis.
- Keep `(you)`, avatars, amounts and profile chevrons outside the tight name/checkmark group.
- Preserve badge account matching, popover interaction, calculations and all stored data.

## Verification

Passed with synthetic fixtures only:

- `node --check server.js`
- `node output/test-plus-badge.cjs` (also with `RAVEN_TEST_BRAND_FONTS=1`): actual trip/bill rendering; 320/390/430/768px layouts; measured icon gaps; wrapped payer and long names; tap targets; profile/receipt event isolation; keyboard behavior; no data writes.
- `node output/test-trip-custom-page.cjs`
- `node output/test-raven-sweep.cjs`
- `node output/test-sweep-payment-summary.cjs`
- `node output/test-sweep-balance-colors.cjs`
- Site repository `node output/test-bill-preview-ui.cjs`.
- Inspected rendered mobile balance and receipt screenshots using the brand fonts.

## Release

Backend-only release. No database migration, billing/access changes, new dependencies or iOS rebuild needed. Existing trip pages need to be reopened/refreshed to retrieve the updated server-rendered layout.
