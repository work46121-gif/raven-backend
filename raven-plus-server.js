'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { POLICY, projection, tripProjection } = require('./raven-plus');

function previewHtml() {
  const source = fs.readFileSync(path.join(__dirname, 'raven-plus-preview.html'), 'utf8');
  const catalog = JSON.stringify(POLICY).replace(/</g, '\\u003c');
  return source.replace('/* RAVEN_PLUS_POLICY */ null', catalog)
    .replace('/* RAVEN_PLUS_ENGINE */', fs.readFileSync(path.join(__dirname, 'raven-plus.js'), 'utf8'));
}
async function bounded(query, ms = 5000) {
  const controller = new AbortController();
  let timer;
  try {
    const request = typeof query.abortSignal === 'function' ? query.abortSignal(controller.signal) : query;
    const result = await Promise.race([request, new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(Error('timeout')); }, ms);
    })]);
    if (result.error) throw result.error;
    return result.data;
  } finally { clearTimeout(timer); }
}
function register(app, db, authenticate, requireAdmin) {
  // Read-only owner preview. There is deliberately NO checkout, purchase,
  // grant, restore, webhook or entitlement-mutation HTTP route in this release.
  app.get('/admin/plus/preview', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.json({ success: true, html: previewHtml(), policy: POLICY });
  });
  app.get('/me/membership', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      const user = await authenticate(req);
      if (!user?.id) return res.status(401).json({ success: false, error: 'Sign in to view your membership.' });
      const snapshot = await bounded(db.rpc('raven_plus_account_snapshot', { p_user_id: user.id }));
      if (!snapshot || !Array.isArray(snapshot.grants)) throw Error('invalid snapshot');
      res.json({ success: true, membership: projection(snapshot, user.id) });
    } catch (_) {
      // Missing migration/outage != Free. Do not incorrectly downgrade or cache
      // a member when their server-owned subscription state cannot be read.
      res.status(503).json({ success: false, error: 'Membership is unavailable. Your existing access has not changed.' });
    }
  });
  app.get('/trips/:id/membership', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      const user = await authenticate(req);
      if (!user?.id) return res.status(401).json({ success: false, error: 'Sign in to view trip membership.' });
      if (!/^[a-z0-9_-]{1,64}$/i.test(req.params.id || '')) return res.status(400).json({ success: false, error: 'Invalid trip.' });
      const snapshot = await bounded(db.rpc('raven_plus_trip_snapshot', { p_trip_id: req.params.id, p_user_id: user.id }));
      if (!snapshot) return res.status(404).json({ success: false, error: 'Linked trip membership required.' });
      res.json({ success: true, membership: tripProjection(snapshot) });
    } catch (_) {
      res.status(503).json({ success: false, error: 'Trip membership is unavailable. Your existing access has not changed.' });
    }
  });
}
module.exports = { register, previewHtml, bounded };
