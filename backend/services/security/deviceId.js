/**
 * Pseudonymous installation identifiers.
 *
 * Web: a random UUID in the first-party cookie jb_did (httpOnly, 1 year), signed so a client
 * cannot mint arbitrary valid IDs. It can still be deleted or copied, and each browser has its
 * own. App: a random UUID made at install, kept in secure storage, sent as X-Install-Id —
 * client-made, so it is only "claimed". No fingerprinting of any kind.
 *
 * Only a keyed hash (deviceKey) is ever stored; the raw identifier never leaves the request.
 * DEVICE_ID_SECRET is its own key (not JWT_SECRET): rotating it turns every installation into a
 * new one, which is the intended way to forget them all.
 */
const crypto = require('crypto');

const COOKIE = 'jb_did';
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEV_SECRET = 'jobblo-development-device-id-secret-not-for-production';

let warned = false;
/** The signing key, or null (identification off) when production has none configured. */
function secret() {
  const s = process.env.DEVICE_ID_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === 'production') {
    if (!warned) {
      warned = true;
      console.error(
        '[device-id] DEVICE_ID_SECRET is not set (32+ chars): device identification is off'
      );
    }
    return null;
  }
  return DEV_SECRET;
}

const mac = (key, value) => crypto.createHmac('sha256', key).update(value).digest('hex');

/** Cookie value for a web installation id. */
const signWeb = (id, key = secret()) => `${id}.${mac(key, `sig:${id}`).slice(0, 24)}`;

/** The installation id inside a jb_did cookie, or null when it is missing, malformed or forged. */
function parseWeb(value, key = secret()) {
  if (!key || typeof value !== 'string' || value.length > 100) return null;
  const [id, sig] = value.split('.');
  if (!id || !sig || !UUID.test(id)) return null;
  const want = mac(key, `sig:${id}`).slice(0, 24);
  if (sig.length !== want.length) return null;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want)) ? id.toLowerCase() : null;
}

/** The stored, pseudonymous key for an installation id. */
const keyFor = (id, key = secret()) =>
  key && id ? mac(key, `key:${String(id).toLowerCase()}`).slice(0, 32) : null;

/** Short label for the dashboard: "DEV-7842". */
const labelFor = (deviceKey) => (deviceKey ? `DEV-${deviceKey.slice(0, 4).toUpperCase()}` : null);

/**
 * The installation behind a request: { deviceKey, platform, confidence } or null.
 * confidence: 'confirmed' (a signed cookie came back), 'new' (issued on this very request — not
 * yet proven to be a browser that keeps cookies), 'claimed' (the app's own id).
 */
/**
 * Raw cookie value / install id → deviceKey, so a browser's repeat requests cost a Map lookup
 * instead of two HMACs (~50 µs each measured here). Only verified values are stored.
 * ponytail: cleared when it reaches CACHE_CAP (memory bounded, the next requests recompute);
 * an LRU is the upgrade if the hit rate ever matters.
 */
const CACHE_CAP = 20_000;
const cache = new Map();
function cached(raw, compute) {
  const hit = cache.get(raw);
  if (hit !== undefined) return hit;
  const value = compute();
  if (cache.size >= CACHE_CAP) cache.clear();
  cache.set(raw, value);
  return value;
}

function resolve(req, key) {
  const appId = req.headers?.['x-install-id'];
  if (typeof appId === 'string' && UUID.test(appId))
    return {
      deviceKey: cached(`a:${appId}`, () => keyFor(appId, key)),
      platform: 'app',
      confidence: 'claimed',
    };
  if (req.deviceId) {
    const id = req.deviceId;
    return {
      deviceKey: cached(`i:${id}`, () => keyFor(id, key)),
      platform: 'web',
      confidence: req.deviceIdIssued ? 'new' : 'confirmed',
    };
  }
  const raw = req.cookies?.[COOKIE];
  if (typeof raw !== 'string') return null;
  const deviceKey = cached(`c:${raw}`, () => {
    const id = parseWeb(raw, key);
    return id ? keyFor(id, key) : null;
  });
  return deviceKey ? { deviceKey, platform: 'web', confidence: 'confirmed' } : null;
}

function fromRequest(req) {
  // Asked twice per request (security events and observations): computed once.
  if (req._jbDevice !== undefined) return req._jbDevice;
  const key = secret();
  const device = key ? resolve(req, key) : null;
  try {
    Object.defineProperty(req, '_jbDevice', { value: device, enumerable: false });
  } catch {
    /* frozen request object (tests): skip the memo */
  }
  return device;
}

/**
 * Where a browser is given a jb_did cookie: signing in, registering, the session check and
 * refresh, one-time codes. Not on every response — public, cacheable responses carry no
 * Set-Cookie, and a visitor who never signs in is never given an id. The cookie is read on
 * every request (fromRequest) once it exists.
 */
const ISSUE_ON =
  /^\/api\/auth\/(login|register|refresh-token|profile|verify-otp|verify-email|email\/(send-code|verify)|forgot-password|reset-password|mfa(\/.*)?|(google|idura|vipps)(\/callback)?)$/;

/** Express middleware (after cookie-parser): make sure a signing-in browser carries jb_did. */
function deviceCookie(req, res, next) {
  if (req.headers['x-install-id']) return next(); // the app identifies itself
  if (!ISSUE_ON.test(String(req.originalUrl || req.url || '').split('?')[0])) return next();
  const key = secret();
  if (!key) return next();
  let id = parseWeb(req.cookies?.[COOKIE], key);
  if (!id) {
    id = crypto.randomUUID();
    req.deviceIdIssued = true;
    res.cookie(COOKIE, signWeb(id, key), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: ONE_YEAR_MS,
      path: '/',
    });
  }
  req.deviceId = id;
  next();
}

module.exports = {
  COOKIE,
  ISSUE_ON,
  secret,
  signWeb,
  parseWeb,
  keyFor,
  labelFor,
  fromRequest,
  deviceCookie,
  _clearCache: () => cache.clear(),
};
