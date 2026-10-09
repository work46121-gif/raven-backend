# Trip Hub percentage and dollar splits

Whole bills (new and existing) offer **Adjust split · % or $**. Itemized bills
offer the same financial split editor for each item and retain quantity-based
splits as a separate option. Shares, including the payer's own cost, always sum
to the bill total. The payer is still excluded from money owed to themselves.

Example: a $600 rental car can allocate $300 / $150 / $150, or $400 / $100 / $100.
The remainder helper divides unedited shares equally. Nothing is persisted
until Save Receipt or Save Changes. Cancel leaves the original draft untouched.
An item-level change applies item allocations and proportional tax, tip, fees
and discount; a whole-bill override explicitly takes precedence over item detail.

Storage: additive `trip_receipts.split_settings` JSONB and optional
`items[].custom_split`. Shared pure calculator performs integer-cent allocation
and both client/server validation. The private, service-role-only
`raven_edit_trip_split` RPC atomically checks the receipt snapshot and updates it.
Stale editors are rejected instead of overwriting another change. Real payment
credits are retained; legacy paid-in-full sentinels are converted to their
pre-edit dollar credit, exposing only additional debt. Changing the payer of a
trip with recorded payments requires reconciling those payments first.

Apply `output/raven-trip-custom-splits.sql` before deploying the backend. The
migration itself does not change bills or payments and is safe to rerun. Existing
clients can still create receipts, but old edit pages must refresh to save safely.

Verification (synthetic data only):

- `node output/test-trip-custom-splits.cjs` — calculator, PostgreSQL, API.
- `node output/test-trip-custom-splits-ui.cjs` — mobile financial editors.
- `node output/test-trip-custom-page.cjs` — full emitted Trip Hub JS parses.
- Existing bill quantity editor and comment pagination regression tests pass.

This is a server-rendered Trip Hub change. No native shell/assets were changed.
No real user's bill allocation was modified during testing.
