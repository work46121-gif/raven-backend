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

function alertText(event) {
 // Names only, never message/comment bodies or amounts on the lock screen.
 const clean = (value, max) => String(value || '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, max);
 const first = clean(event.actor_name, 60) || 'Someone';
 if (['dm', 'group', 'trip_message'].includes(event.kind)) return first + ' sent you a message on RAVEN';
 if (event.kind === 'trip_comment') return first + ' added a comment on trip ' + (clean(event.trip_name, 100) || 'your trip');
 if (event.kind === 'trip_overdue') return 'You have an unpaid balance for ' + (clean(event.trip_name, 100) || 'your trip') + '. Open RAVEN to review your bill.';
 return TEXT[event.kind] || 'You have a new RAVEN update.';
}

async function registrationStatus(db, userIds, env = process.env) {
 const result = Object.fromEntries(userIds.map(id => [id, { state: 'unavailable', deviceCount: 0, platforms: [] }]));
 if (!userIds.length) return result;
 // Admin needs counts, not registration tokens or session identifiers.
 const { data, error } = await db.from('raven_push_devices').select('user_id,platform')
  .in('user_id', userIds).not('session_id', 'is', null);
 if (error) return result;
 const providers = platforms(env);
 for (const id of userIds) {
  const devices = (data || []).filter(d => d.user_id === id);
  const types = [...new Set(devices.map(d => d.platform))].filter(p => p === 'ios' || p === 'android');
  result[id] = { state: !devices.length ? 'not_registered' : types.some(p => providers[p]) ? 'enabled' : 'service_unavailable', deviceCount: devices.length, platforms: types };
 }
 return result;
}

let cachedProvider, cachedAt = 0, cachedKey, appleClient, appleHost;
let cachedFcmToken, cachedFcmUntil = 0, cachedFcmKey;

function iosConfigured(env) {
 if (env.RAVEN_PUSH_ENABLED !== '1' || !(env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_PRIVATE_KEY)) return false;
 try { providerToken(env); return true; } catch (_) { return false; }
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
 let privateKey;
 try {
  privateKey = crypto.createPrivateKey(String(env.APNS_PRIVATE_KEY || '').replace(/\\n/g, '\n'));
  if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw Error();
 } catch (_) {
  const error = Error('Apple push signing key is not a valid P-256 private key.');
  error.code = 'PUSH_APNS_KEY_INVALID';
  throw error;
 }
 const head = Buffer.from(JSON.stringify({ alg: 'ES256', kid: env.APNS_KEY_ID })).toString('base64url');
 const body = Buffer.from(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
 const input = head + '.' + body;
 const signature = crypto.sign('sha256', Buffer.from(input), {
  key: privateKey,
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
    aps: { alert: { title: 'RAVEN', body: alertText(event) }, sound: 'default' },
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
   notification: { title: 'RAVEN', body: alertText(event) },
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

// Provider/database errors can contain device tokens, SQL row contents or
// credentials. Log only known diagnostic labels, never their raw messages.
const SCHEMA_ERRORS = new Set(['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205']);
const SAFE_ERROR_CODES = new Set([...SCHEMA_ERRORS, '23502', '23503', '23505', '42501',
 'PUSH_APNS_KEY_INVALID', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND',
 'EAI_AGAIN', 'ERR_HTTP2_STREAM_CANCEL', 'ERR_HTTP2_GOAWAY_SESSION', 'ERR_HTTP2_INVALID_SESSION']);
const SAFE_PROVIDER_REASONS = new Set([
 'BadDeviceToken', 'DeviceTokenNotForTopic', 'InvalidProviderToken', 'ExpiredProviderToken',
 'TopicDisallowed', 'Forbidden', 'MissingTopic', 'BadTopic', 'BadCertificateEnvironment',
 'BadCertificate', 'BadEnvironmentKeyInToken', 'Unregistered', 'TooManyRequests', 'TooManyProviderTokenUpdates',
 'InternalServerError', 'ServiceUnavailable', 'Shutdown', 'IdleTimeout', 'BadMessageId',
 'BadExpirationDate', 'BadPriority', 'BadCollapseId', 'BadPayload', 'PayloadEmpty',
 'PayloadTooLarge', 'MissingDeviceToken', 'BadPath', 'MethodNotAllowed', 'MissingProviderToken',
 'UnknownPlatform', 'UNREGISTERED', 'UNAUTHENTICATED', 'PERMISSION_DENIED',
 'RESOURCE_EXHAUSTED', 'INVALID_ARGUMENT', 'INTERNAL', 'UNAVAILABLE', 'NOT_FOUND'
]);
const databaseErrorCode = code => typeof code === 'string' && (
 /^PGRST[0-9]{3}$/.test(code) || /^(?:[0-9][0-9A-Z]|P0|F0|HV|XX)[0-9A-Z]{3}$/.test(code)
);
const safeErrorCode = error => {
 for (const code of [error?.code, error?.cause?.code]) {
  if (SAFE_ERROR_CODES.has(code) || databaseErrorCode(code)) return code;
 }
 return 'UNKNOWN';
};
const SAFE_ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError', 'EvalError', 'AbortError', 'TimeoutError', 'FetchError']);
const safeErrorKind = error => {
 if (databaseErrorCode(error?.code)) return 'DatabaseError';
 if (SAFE_ERROR_NAMES.has(error?.name)) return error.name;
 // Supabase may return a plain object containing a fetch exception. Inspect
 // only its built-in error prefix and emit a fixed label, never the message.
 const prefix = typeof error?.message === 'string' ? /^(TypeError|RangeError|ReferenceError|SyntaxError|AbortError|TimeoutError|FetchError):/.exec(error.message) : null;
 return prefix ? prefix[1] : 'UnknownError';
};
const safePlatform = platform => platform === 'ios' || platform === 'android' ? platform : 'unknown';

module.exports = function registerPush(app, db, authenticate, env = process.env, send = sendPush, reminders = null) {
 const publicSetupError = error => {
  const code = String(error?.code || '');
  if (SCHEMA_ERRORS.has(code)) {
   return 'Phone notifications need a one-time database update. Please run the notification setup query, then retry.';
  }
  if (code === '23502' || code === '23503') return 'Please sign out and back in, then retry phone notifications.';
  return 'Phone notifications are not ready. Please retry later.';
 };
 const run = (operation, fn) => async (req, res) => {
  let stage = 'authenticate';
  const atStage = value => { stage = value; };
  try {
   const user = await authenticate(req);
   if (!user) return res.status(401).json({ success: false, error: 'Sign in required.' });
   res.set('Cache-Control', 'private, no-store');
   stage = 'prepare-response';
   await fn(req, res, user, atStage);
  } catch (error) {
   console.error('[push] Request failed:', operation, stage, safeErrorCode(error), safeErrorKind(error));
   res.status(503).json({ success: false, error: publicSetupError(error) });
  }
 };
 app.get('/push/status', run('status', async (_req, res, _user, atStage) => {
  atStage('provider-configuration');
  const available = platforms(env);
  res.json({ success: true, enabled: available.ios || available.android, platforms: available });
 }));
 app.post('/push/device', run('register-device', async (req, res, user, atStage) => {
  atStage('validate-device');
  const platform = String(req.body.platform || 'ios').toLowerCase();
  if (platform !== 'ios' && platform !== 'android') return res.status(400).json({ success: false, error: 'Invalid device.' });
  atStage('provider-configuration');
  const available = platforms(env);
  if (!available[platform]) {
   console.warn('[push] Registration unavailable:', platform, 'PROVIDER_NOT_CONFIGURED');
   return res.status(503).json({ success: false, error: 'Phone notifications are awaiting activation.' });
  }
  atStage('validate-token');
  const token = String(req.body.token || '').trim();
  if (!validToken(platform, token)) return res.status(400).json({ success: false, error: 'Invalid device.' });
  atStage('validate-session');
  const jwt = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  let session = '';
  try { session = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url')).session_id || ''; } catch (_) {}
  if (!/^[0-9a-f-]{36}$/i.test(session || '')) return res.status(400).json({ success: false, error: 'Please sign in again.' });
  atStage('lookup-device');
  const { data: existing, error: lookupError } = await db.from('raven_push_devices')
   .select('user_id,platform,session_id,updated_at').eq('token', token).maybeSingle();
  if (lookupError) throw lookupError;
  // Relaunching an already opted-in app must not erase pending activity. A
  // different account, session or platform starts a new opt-in window.
  const unchanged = existing?.user_id === user.id && existing?.platform === platform
   && existing?.session_id === session && Number.isFinite(Date.parse(existing?.updated_at));
  const device = { token, platform, user_id: user.id, session_id: session,
   updated_at: unchanged ? existing.updated_at : new Date().toISOString() };
  atStage('save-device');
  const { error } = await db.from('raven_push_devices').upsert(device);
  if (error) throw error;
  res.json({ success: true });
 }));
 app.delete('/push/device', run('unregister-device', async (req, res, user, atStage) => {
  atStage('validate-token');
  const token = String(req.body.token || '').trim();
  atStage('delete-device');
  const { error } = await db.from('raven_push_devices').delete().eq('token', token).eq('user_id', user.id);
  if (error) throw error;
  res.json({ success: true });
 }));

 let busy = false;
 async function tick() {
  if (busy || !configured(env)) return;
  busy = true;
  let stage = 'claim-events';
  try {
   const { data: events, error } = await db.rpc('raven_claim_phone_alerts');
   if (error) throw error;
   for (const event of events || []) {
    let retry = false;
    // Recheck the live balance and trip membership on every delivery attempt;
    // a payment after enqueueing cancels the reminder, including retries.
    if (event.kind === 'trip_overdue') {
     stage = 'verify-overdue-balance';
     if (!reminders || !await reminders.eligible(event)) {
      const { error } = await db.from('raven_push_events').update({ done: true }).eq('id', event.id).eq('lease', event.lease);
      if (error) throw error;
      continue;
     }
    }
    stage = 'lookup-devices';
    const { data: devices, error: lookupError } = await db.from('raven_push_devices').select('token,platform,session_id,updated_at').eq('user_id', event.user_id);
    if (lookupError) throw lookupError;
    await Promise.all((devices || []).map(async device => {
     // Legacy rows without a session cannot be invalidated safely on sign-out.
     // Keep the row for a future app registration, but do not deliver to it.
     if (!/^[0-9a-f-]{36}$/i.test(device.session_id || '')) return;
     // Opting in now must not deliver activity from before that registration.
     if (Date.parse(device.updated_at) > Date.parse(event.created_at)) return;
     try {
      const result = await send(env, device, event);
      if (result.status < 200 || result.status >= 300) {
       const status = Number.isInteger(result.status) && result.status >= 100 && result.status <= 599 ? result.status : 0;
       const reason = SAFE_PROVIDER_REASONS.has(result.reason) ? result.reason : 'UNKNOWN';
       console.warn('[push] Provider rejected delivery:', safePlatform(device.platform || 'ios'), status, reason);
      }
      if (result.status === 410 || result.reason === 'BadDeviceToken' || result.reason === 'Unregistered' || result.reason === 'UNREGISTERED') {
       const { error: deleteError } = await db.from('raven_push_devices').delete().eq('token', device.token).eq('user_id', event.user_id);
       if (deleteError) throw deleteError;
      } else if (result.status < 200 || result.status >= 300) {
       retry = true;
      }
     } catch (error) {
      console.warn('[push] Delivery retry:', safePlatform(device.platform || 'ios'), safeErrorCode(error), safeErrorKind(error));
      retry = true;
     }
    }));
    stage = 'save-delivery';
    const { error: saveError } = await db.from('raven_push_events').update({
     done: !retry,
     available_at: new Date(Date.now() + 60000 * Math.min(30, 2 ** event.attempts)).toISOString()
    }).eq('id', event.id).eq('lease', event.lease);
    if (saveError) throw saveError;
   }
  } catch (error) {
   console.warn('[push] Worker pending:', stage, safeErrorCode(error), safeErrorKind(error));
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
module.exports.alertText = alertText;
module.exports.registrationStatus = registrationStatus;
