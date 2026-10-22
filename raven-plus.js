(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RavenPlusPolicy = factory();
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
'use strict';

// Proposed pilot policy, not live limits. No badge, handle, email, browser flag,
// or sandbox purchase may be used as a production membership entitlement.
const MiB = 1024 * 1024;
const POLICY = Object.freeze({
  version: 'plus-pilot-v1', stage: 'private_preview', enforced: false,
  checkout_enabled: false, limits_confirmed: false,
  currency: 'USD', monthly_cents: 599, annual_cents: 3999,
  free_active_hosted_trips: 1, plus_active_sponsored_trips: 10,
  free_photos_per_trip: 10, free_videos_per_trip: 5,
  free_photo_bytes: 6 * MiB, free_video_bytes: 50 * MiB,
  plus_photo_bytes: 50 * MiB, plus_video_bytes: 500 * MiB,
  plus_album_bytes: 5 * 1024 * MiB,
  free_ai_scans: null, plus_ai_scans: null,
  unlimited_joining: true, trip_pass_enabled: false
});

function date(value) {
  return typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
}
function eligible(grant, userId, now = Date.now()) {
  return !!grant && grant.user_id === userId &&
    ['apple', 'complimentary'].includes(grant.provider) && grant.environment === 'production' &&
    !grant.revoked_at && date(grant.starts_at) <= now && date(grant.ends_at) > now;
}
function membership(grants, userId, now = Date.now()) {
  const active = (grants || []).filter(g => eligible(g, userId, now));
  if (!active.length) return { tier: 'free', expires_at: null, source: null };
  const last = active.reduce((a, b) => date(a.ends_at) >= date(b.ends_at) ? a : b);
  return { tier: 'plus', expires_at: last.ends_at, source: last.provider === 'complimentary' ? 'complimentary' : 'purchase' };
}
function activeTrip(trip, now = Date.now()) {
  if (['completed', 'archived', 'deleted', 'cancelled'].includes(String(trip.status || '').toLowerCase())) return false;
  // Same Eastern calendar boundary as Trip Hub. An invalid/missing date cannot
  // make a trip disappear from the quota. No receipt/payment amounts are changed.
  const valid = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T12:00:00Z')) && new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
  if (valid(trip.end_date)) return today < trip.end_date;
  const settled = trip.total != null && Number.isFinite(Number(trip.total)) && Number(trip.total) <= 0;
  if (valid(trip.trip_date)) return !(trip.trip_date < today && settled);
  return !(settled && Number(trip.receipt_count) > 0);
}
function projection(snapshot, userId, now = Date.now(), policy = POLICY) {
  const plan = membership(snapshot.grants, userId, now);
  const hosted = (snapshot.hosted_trips || []).filter(t => activeTrip(t, now)).length;
  const sponsored = (snapshot.sponsored_trips || []).filter(t => activeTrip(t, now)).length;
  const maximum = plan.tier === 'plus' ? policy.plus_active_sponsored_trips : policy.free_active_hosted_trips;
  const used = plan.tier === 'plus' ? sponsored : hosted;
  return {
    ...plan, stage: policy.stage, enforced: false, checkout_enabled: false,
    // Projections are explicitly separate from permissions. This release never
    // blocks create/join/read/settle/download and is not called on trip startup.
    proposed: { active_trip_limit: maximum, used, remaining: maximum == null ? null : Math.max(0, maximum - used), can_host_or_sponsor: maximum == null || used < maximum, joining_unlimited: true },
    existing_access_unchanged: true
  };
}
function tripProjection(snapshot, now = Date.now()) {
  const eligibleSponsors = (snapshot.sponsors || []).filter(s => s.linked === true && (s.grants || []).some(g => eligible(g, s.user_id, now)));
  return {
    tier: eligibleSponsors.length ? 'plus' : 'free',
    // Never expose the sponsor's payment IDs or billing details to the group.
    sponsor_count: eligibleSponsors.length,
    completed: !activeTrip(snapshot.trip || {}, now),
    enforced: false, existing_access_unchanged: true
  };
}
return { POLICY, eligible, membership, activeTrip, projection, tripProjection };
});
