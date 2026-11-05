/**
 * Installation ↔ IP ↔ account observations, collected from finished responses (called by
 * middleware/requestMetrics next to securityEvents.record). Nothing here runs a query on the
 * request path: rows go to an in-memory buffer, flushed every 10 s as upserts.
 *
 * What is recorded:
 *  - every security-relevant outcome (login, failed login, registration, password reset,
 *    session refresh, sensitive account change), always;
 *  - otherwise one sighting per installation + IP + account per 10 minutes (DEDUPE_MS).
 * A browser that has not yet returned its cookie ("new") only counts on a security-relevant
 * outcome, so scripts that never keep cookies do not mint an installation per request.
 *
 * Derived events (SecurityEvent): device_new_ip — a known installation on an IP not seen with
 * it before; device_new_account — a known installation signed in as another account.
 * A new pair queues an IP intelligence lookup (security/enrich).
 *
 * ponytail: the 10-minute dedupe is per process (a Map, capped); with several API workers a
 * pair can be written once per worker per window — harmless (upserts), a Redis SET NX is the
 * upgrade if the write volume matters.
 */
const mongoose = require('mongoose');
const deviceId = require('./deviceId');

const BUFFER_CAP = 5000;
const FLUSH_MS = 10 * 1000;
const DEDUPE_MS = 10 * 60 * 1000;
const DEDUPE_CAP = 50_000;

let buffer = [];
let dropped = 0;
const recent = new Map();

const clientIp = (req) => (req.ip ? String(req.ip).replace(/^::ffff:/, '') : null);

/** Pure: request → security-relevant event name, or null. Unit-tested. */
function classifyEvent({ method, path, status }) {
  const ok = status >= 200 && status < 300;
  if (path === '/api/auth/login' && method === 'POST')
    return ok ? 'login' : status === 401 || status === 403 ? 'login_failed' : null;
  if (!ok) return null;
  if (method === 'POST' && path === '/api/auth/register') return 'register';
  if (path === '/api/auth/reset-password') return 'password_reset';
  if (path === '/api/auth/refresh-token') return 'session';
  if (
    /^\/api\/auth\/(mfa\/setup|sessions\/.+)$/.test(path) ||
    (method === 'PUT' && /^\/api\/users\/[^/]+$/.test(path)) ||
    /^\/api\/(connect|stripe\/connect)\b/.test(path)
  )
    return 'sensitive';
  return null;
}

/** "/24" of an IPv4, "/48" of an IPv6 — addresses that move inside one network count once. */
function prefixOf(ip) {
  if (!ip) return null;
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}::/48`;
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts.slice(0, 3).join('.')}.0/24` : null;
}

/** Browser and OS family, never the full user agent. */
function uaFamilyOf(req) {
  const ua = String(req.get?.('user-agent') || '');
  if (!ua) return null;
  try {
    const a = new (require('express-useragent').UserAgent)().parse(ua);
    const browser =
      a.browser && a.browser !== 'unknown'
        ? `${a.browser} ${String(a.version || '').split('.')[0]}`.trim()
        : null;
    const os = a.os && a.os !== 'unknown' ? a.os : null;
    return [browser, os].filter(Boolean).join(' · ').slice(0, 120) || null;
  } catch {
    return null;
  }
}

function seenRecently(key, now) {
  const at = recent.get(key);
  if (at && now - at < DEDUPE_MS) return true;
  if (recent.size >= DEDUPE_CAP) recent.clear();
  recent.set(key, now);
  return false;
}

function record(req, res) {
  const device = deviceId.fromRequest(req);
  if (!device?.deviceKey) return;
  const ip = clientIp(req);
  if (!ip) return;
  const path = String(req.originalUrl || '').split('?')[0];
  const event = classifyEvent({ method: req.method, path, status: res.statusCode });
  if (device.confidence === 'new' && !event) return;
  const userId = req.user?._id || req.securityUserId || null;
  const now = Date.now();
  if (!event && seenRecently(`${device.deviceKey}|${ip}|${userId || ''}`, now)) return;
  if (buffer.length >= BUFFER_CAP) {
    dropped += 1;
    return;
  }
  buffer.push({
    at: new Date(now),
    deviceKey: device.deviceKey,
    platform: device.platform,
    ip,
    userId: userId ? String(userId) : null,
    sessionId: req.sessionId || req.securitySessionId || null,
    event,
    uaFamily: uaFamilyOf(req),
  });
}

const oid = (v) =>
  v && mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : null;

/**
 * Write one batch. Exported for tests; models and enqueue injectable.
 * ponytail: three round trips per row, in sequence (it runs off the request path, every 10 s,
 * coalesced); bulkWrite of the upserts is the upgrade if a flush ever falls behind.
 */
async function writeBatch(batch, deps = {}) {
  const DeviceInstallation = deps.DeviceInstallation || require('../../models/DeviceInstallation');
  const DeviceObservation = deps.DeviceObservation || require('../../models/DeviceObservation');
  const SecurityEvent = deps.SecurityEvent || require('../../models/SecurityEvent');
  const enqueue = deps.enqueue || require('../queue').enqueue;
  const derived = [];
  const toEnrich = new Set();
  const max = DeviceInstallation.MAX_USERS || 20;

  for (const o of batch) {
    const userId = oid(o.userId);
    const before = await DeviceInstallation.findOne({ deviceKey: o.deviceKey })
      .select('userIds')
      .lean();
    const update = {
      $setOnInsert: { firstSeen: o.at, platform: o.platform },
      $set: { lastSeen: o.at, ...(o.uaFamily ? { uaFamily: o.uaFamily } : {}) },
    };
    const known = (before?.userIds || []).map(String);
    if (userId && !known.includes(String(userId)) && known.length < max)
      update.$addToSet = { userIds: userId };
    await DeviceInstallation.updateOne({ deviceKey: o.deviceKey }, update, { upsert: true });

    const obs = await DeviceObservation.updateOne(
      { deviceKey: o.deviceKey, ip: o.ip },
      {
        $setOnInsert: { firstSeen: o.at, ipPrefix: prefixOf(o.ip) },
        $set: {
          lastSeen: o.at,
          ...(userId ? { userId } : {}),
          ...(oid(o.sessionId) ? { sessionId: oid(o.sessionId) } : {}),
        },
        $inc: { hits: 1, ...(o.event ? { [`events.${o.event}`]: 1 } : {}) },
      },
      { upsert: true }
    );
    const newPair = Boolean(obs?.upsertedCount);
    if (newPair) toEnrich.add(o.ip);
    const base = { at: o.at, ip: o.ip, deviceKey: o.deviceKey, userId, route: null };
    if (newPair && before) derived.push({ ...base, type: 'device_new_ip' });
    if (before && userId && known.length && !known.includes(String(userId)))
      derived.push({ ...base, type: 'device_new_account' });
  }

  if (derived.length) await SecurityEvent.insertMany(derived, { ordered: false });
  for (const ip of toEnrich)
    await Promise.resolve(enqueue('security', 'enrich', { ip })).catch(() => {});
  // Risk rules for every installation touched; one job per installation per minute.
  const minute = Math.floor(Date.now() / 60_000);
  const devices = new Set(batch.map((o) => o.deviceKey));
  for (const deviceKey of devices)
    await Promise.resolve(
      enqueue('security', 'evaluate', { deviceKey }, { jobId: `evaluate-${deviceKey}-${minute}` })
    ).catch(() => {});
  return {
    written: batch.length,
    derived: derived.length,
    enriched: toEnrich.size,
    evaluated: devices.size,
  };
}

/**
 * Plain sightings of the same (installation, IP, account) in one batch → one row, the last.
 * Event rows are all kept: five failed logins must count five.
 */
function coalesce(batch) {
  const byKey = new Map();
  const events = [];
  for (const o of batch) {
    if (o.event) events.push(o);
    else byKey.set(`${o.deviceKey}|${o.ip}|${o.userId || ''}`, o);
  }
  return [...byKey.values(), ...events];
}

async function flush() {
  if (!buffer.length) return;
  const batch = coalesce(buffer);
  buffer = [];
  try {
    await writeBatch(batch);
  } catch (err) {
    console.error('[device-observations] flush failed:', err.message);
  }
}

let timer = null;
function startObservationFlush() {
  if (timer || process.env.NODE_ENV === 'test') return;
  timer = setInterval(flush, FLUSH_MS);
  if (timer.unref) timer.unref();
}

module.exports = {
  classifyEvent,
  prefixOf,
  coalesce,
  record,
  writeBatch,
  flush,
  startObservationFlush,
  droppedCount: () => dropped,
  _buffer: () => buffer,
  _reset: () => {
    buffer = [];
    dropped = 0;
    recent.clear();
  },
};
