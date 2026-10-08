// Native RAVEN alert delivery. It stays disabled until the matching provider
// credentials and the SQL migration are installed.
const http = require('node:https');
const http2 = require('node:http2');
const crypto = require('node:crypto');

const TEXT = {
 bill: 'You were added to a bill.',
 trip: 'You were added to a trip.',
 dm: 'You have a new message.',
 group: 'You have a new group message.',
 trip_receipt: 'A receipt was added to your trip.',
 trip_comment: 'Someone commented on your trip.',
 trip_assignment: 'You were added to a trip receipt.',
 trip_message: 'You have a new Trip Hub message.',
 friend_request: 'You have a new friend request.'
};

let cachedProvider, cachedAt = 0, cachedKey, appleClient, appleHost;
let cachedFcmToken, cachedFcmUntil = 0, cachedFcmKey;

function iosConfigured(env) {
 return env.RAVEN_PUSH_ENABLED === '1' && !!(env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_PRIVATE_KEY);
}

function firebaseServiceAccount(env) {
 const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON || (env.FIREBASE_SERVICE_ACCOUNT_JSON_B64
  ? Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_JSON_B64, 'base64').toString('utf8')
  : '');
 if (!raw) return null;
 try {
  const account = JSON.parse(raw);
  return account.client_email && account.private_key && account.project_id ? account : null;
 } catch (_) {
  return null;
 }
}

function androidConfigured(env) {
 return env.RAVEN_PUSH_ENABLED === '1' && !!firebaseServiceAccount(env);
}

function platforms(env) {
 return { ios: iosConfigured(env), android: androidConfigured(env) };
}

function configured(env) {
 const enabled = platforms(env);
 return enabled.ios || enabled.android;
}

function providerToken(env) {
 const key = env.APNS_KEY_ID + env.APNS_TEAM_ID + env.APNS_PRIVATE_KEY;
 if (cachedProvider && cachedKey === key && Date.now() - cachedAt < 3000000) return cachedProvider;
 const head = Buffer.from(JSON.stringify({ alg: 'ES256', kid: env.APNS_KEY_ID })).toString('base64url');
 const body = Buffer.from(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
 const input = head + '.' + body;
 const signature = crypto.sign('sha256', Buffer.from(input), {
  key: env.APNS_PRIVATE_KEY.replace(/\\n/g, '\n'),
  dsaEncoding: 'ieee-p1363'
 }).toString('base64url');
 cachedKey = key;
 cachedAt = Date.now();
 cachedProvider = input + '.' + signature;
 return cachedProvider;
}

function sendApple(env, token, event) {
 return new Promise((resolve, reject) => {
  const host = env.APNS_ENVIRONMENT === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  if (!appleClient || appleClient.closed || appleClient.destroyed || appleHost !== host) {
   appleClient?.destroy();
   appleHost = host;
   appleClient = http2.connect(host);
   appleClient.on('error', () => appleClient?.destroy());
   appleClient.on('goaway', () => appleClient?.close());
  }
  const client = appleClient;
  let finished = false;
  let stream;
  const finish = (err, value) => {
   if (finished) return;
   finished = true;
   clearTimeout(timer);
   client.off('error', onError);
   err ? reject(err) : resolve(value);
  };
  const onError = error => finish(error);
  const timer = setTimeout(() => { stream?.close(); finish(Error('APNs timeout')); }, 15000);
  client.once('error', onError);
  try {
   stream = client.request({
    ':method': 'POST',
    ':path': '/3/device/' + token,
    authorization: 'bearer ' + providerToken(env),
    'apns-topic': env.APNS_BUNDLE_ID || 'com.ravensplit.app',
    'apns-push-type': 'alert',
    'apns-priority': '10',
    'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600),
    'apns-collapse-id': String(event.id)
   });
   let status = 0, body = '';
   stream.on('response', headers => { status = headers[':status']; });
   stream.on('data', chunk => { body += chunk; });
   stream.on('error', error => finish(error));
   stream.on('end', () => {
    let reason;
    try { reason = JSON.parse(body).reason; } catch (_) {}
    finish(null, { status, reason });
   });
   stream.end(JSON.stringify({
    aps: { alert: { title: 'RAVEN', body: TEXT[event.kind] || 'You have a new RAVEN update.' }, sound: 'default' },
    kind: event.kind,
    source_id: event.source_id,
    recipient_id: event.user_id
   }));
  } catch (error) {
   finish(error);
  }
 });
}

function httpsRequest(options, body) {
 return new Promise((resolve, reject) => {
  const request = http.request(options, response => {
   let data = '';
   response.on('data', chunk => { data += chunk; });
   response.on('end', () => resolve({ status: response.statusCode || 0, body: data }));
  });
  request.setTimeout(15000, () => request.destroy(Error('FCM timeout')));
  request.on('error', reject);
  request.end(body);
 });
}

async function fcmAccessToken(env) {
 const account = firebaseServiceAccount(env);
 if (!account) throw Error('Firebase credentials are not configured.');
 const key = account.client_email + account.project_id + account.private_key;
 if (cachedFcmToken && cachedFcmKey === key && Date.now() < cachedFcmUntil) return { token: cachedFcmToken, account };
 const now = Math.floor(Date.now() / 1000);
 const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
 const claim = Buffer.from(JSON.stringify({
  iss: account.client_email,
  scope: 'https://www.googleapis.com/auth/firebase.messaging',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 3600
 })).toString('base64url');
 const assertion = header + '.' + claim + '.' + crypto.sign('RSA-SHA256', Buffer.from(header + '.' + claim), account.private_key).toString('base64url');
 const form = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString();
 const response = await httpsRequest({
  hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) }
 }, form);
 let body = {};
 try { body = JSON.parse(response.body || '{}'); } catch (_) {}
 if (response.status !== 200 || !body.access_token) throw Error('Could not authorize Firebase messaging.');
 cachedFcmKey = key;
 cachedFcmToken = body.access_token;
 cachedFcmUntil = Date.now() + Math.max(60000, ((Number(body.expires_in) || 3600) - 300) * 1000);
 return { token: cachedFcmToken, account };
}

async function sendFcm(env, token, event) {
 const access = await fcmAccessToken(env);
 const body = JSON.stringify({
  message: {
   token,
   notification: { title: 'RAVEN', body: TEXT[event.kind] || 'You have a new RAVEN update.' },
   data: {
    kind: String(event.kind || ''), source_id: String(event.source_id || ''), recipient_id: String(event.user_id || '')
   },
   android: { priority: 'high', notification: { sound: 'default' } }
  }
 });
 const response = await httpsRequest({
  hostname: 'fcm.googleapis.com', path: '/v1/projects/' + encodeURIComponent(access.account.project_id) + '/messages:send', method: 'POST',
  headers: { Authorization: 'Bearer ' + access.token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
 }, body);
 let parsed = {};
 try { parsed = JSON.parse(response.body || '{}'); } catch (_) {}
 return { status: response.status, reason: parsed?.error?.status || parsed?.error?.message };
}

async function sendPush(env, device, event) {
 const platform = device.platform || 'ios';
 if (platform === 'ios') return iosConfigured(env) ? sendApple(env, device.token, event) : { status: 200, skipped: true };
 if (platform === 'android') return androidConfigured(env) ? sendFcm(env, device.token, event) : { status: 200, skipped: true };
 return { status: 410, reason: 'UnknownPlatform' };
}

function validToken(platform, token) {
 return platform === 'ios'
  ? /^[0-9a-f]{64,200}$/i.test(token)
  : /^[A-Za-z0-9_:-]{32,4096}$/.test(token);
}

module.exports = function registerPush(app, db, authenticate, env = process.env, send = sendPush) {
 const publicSetupError = error => {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === '42P01' || code === '42703' || /raven_push_devices|session_id|updated_at/i.test(message)) {
   return 'Phone notifications need a one-time database update. Please run the notification setup query, then retry.';
  }
  if (code === '23502' || code === '23503') return 'Please sign out and back in, then retry phone notifications.';
  return 'Phone notifications are not ready. Please retry later.';
 };
 const run = fn => async (req, res) => {
  try {
   const user = await authenticate(req);
   if (!user) return res.status(401).json({ success: false, error: 'Sign in required.' });
   res.set('Cache-Control', 'private, no-store');
   await fn(req, res, user);
  } catch (error) {
   console.error('[push] Request failed:', error?.code || '', error?.message || error);
   res.status(503).json({ success: false, error: publicSetupError(error) });
  }
 };
 app.get('/push/status', run(async (_req, res) => {
  const available = platforms(env);
  res.json({ success: true, enabled: available.ios || available.android, platforms: available });
 }));
 app.post('/push/device', run(async (req, res, user) => {
  const platform = String(req.body.platform || 'ios').toLowerCase();
  const available = platforms(env);
  if (!available[platform]) return res.status(503).json({ success: false, error: 'Phone notifications are awaiting activation.' });
  const token = String(req.body.token || '').trim();
  if (!validToken(platform, token)) return res.status(400).json({ success: false, error: 'Invalid device.' });
  const jwt = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  let session = '';
  try { session = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url')).session_id || ''; } catch (_) {}
  if (!/^[0-9a-f-]{36}$/i.test(session || '')) return res.status(400).json({ success: false, error: 'Please sign in again.' });
  const device = { token, platform, user_id: user.id, session_id: session, updated_at: new Date().toISOString() };
  let { error } = await db.from('raven_push_devices').upsert(device);
  // Early notification installs did not have session_id. Keep them working
  // while newer installs retain the session binding used for safe cleanup.
  if (error?.code === '42703' && /session_id/i.test(String(error.message || ''))) {
   const { session_id, ...legacyDevice } = device;
   ({ error } = await db.from('raven_push_devices').upsert(legacyDevice));
  }
  if (error) throw error;
  res.json({ success: true });
 }));
 app.delete('/push/device', run(async (req, res, user) => {
  const token = String(req.body.token || '').trim();
  const { error } = await db.from('raven_push_devices').delete().eq('token', token).eq('user_id', user.id);
  if (error) throw error;
  res.json({ success: true });
 }));

 let busy = false;
 async function tick() {
  if (busy || !configured(env)) return;
  busy = true;
  try {
   const { data: events, error } = await db.rpc('raven_claim_phone_alerts');
   if (error) throw error;
   for (const event of events || []) {
    let retry = false;
    const { data: devices, error: lookupError } = await db.from('raven_push_devices').select('token,platform,updated_at').eq('user_id', event.user_id);
    if (lookupError) throw lookupError;
    await Promise.all((devices || []).map(async device => {
     // Opting in now must not deliver activity from before that registration.
     if (device.updated_at > event.created_at) return;
     try {
      const result = await send(env, device, event);
      if (result.status === 410 || result.reason === 'BadDeviceToken' || result.reason === 'Unregistered' || result.reason === 'UNREGISTERED') {
       await db.from('raven_push_devices').delete().eq('token', device.token).eq('user_id', event.user_id);
      } else if (result.status < 200 || result.status >= 300) {
       retry = true;
      }
     } catch (_) {
      retry = true;
     }
    }));
    const { error: saveError } = await db.from('raven_push_events').update({
     done: !retry,
     available_at: new Date(Date.now() + 60000 * Math.min(30, 2 ** event.attempts)).toISOString()
    }).eq('id', event.id).eq('lease', event.lease);
    if (saveError) throw saveError;
   }
  } catch (_) {
   console.warn('[push] Delivery pending; check notification migration and provider configuration.');
  } finally {
   busy = false;
  }
 }
 const timer = setInterval(tick, 15000);
 timer.unref();
 return { tick, stop: () => clearInterval(timer) };
};

module.exports.providerToken = providerToken;
module.exports.configured = configured;
module.exports.platforms = platforms;
module.exports.firebaseServiceAccount = firebaseServiceAccount;
module.exports.sendFcm = sendFcm;
