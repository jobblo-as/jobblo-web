const crypto = require('crypto');
const mongoose = require('mongoose');

/**
 * Intake for the mobile app's lightweight reporter. The endpoint is public (crashes happen
 * before and after login), so everything is whitelisted, length-capped and batch-limited
 * here; the route adds a per-IP rate limit.
 */

const MAX_BATCH = 50;
const TYPES = ['session', 'error', 'api'];
const KINDS = ['js', 'render', 'promise'];
const PLATFORMS = ['ios', 'android', 'web'];
const DAY = 24 * 60 * 60 * 1000;

const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const id = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : null);

/** Drop line/column numbers and ids so the same bug in every build groups together. */
function fingerprint(name, message, stack) {
  const msg = String(message || '')
    .replace(/[0-9a-f]{24}/gi, ':id')
    .replace(/\d+/g, '#')
    .slice(0, 200);
  const frame = String(stack || '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^at |@/.test(l));
  const fn = frame ? frame.replace(/^at /, '').split(/[ (@]/)[0] : '';
  return crypto
    .createHash('sha1')
    .update(`${name || ''}|${msg}|${fn}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * The iOS build number from the request's User-Agent ("Jobblo/15 CFNetwork/… Darwin/…"; iOS puts
 * CFBundleVersion there). Builds made before the app sent its real build number send none.
 */
function iosBuildFromUserAgent(userAgent) {
  const m = /^[^\s/]+\/(\d{1,9})\s+CFNetwork\//.exec(String(userAgent || ''));
  return m ? m[1] : null;
}

/** Pure: validate one batch into documents. Unit-tested. */
function normalize(body, userId = null, now = Date.now(), userAgent = '') {
  const ctx = body && typeof body === 'object' ? body : {};
  const installId = id(ctx.installId);
  const sessionId = id(ctx.sessionId);
  if (!installId || !sessionId) return { error: 'installId and sessionId are required.' };
  const events = Array.isArray(ctx.events) ? ctx.events.slice(0, MAX_BATCH) : [];
  const platform = PLATFORMS.includes(ctx.platform) ? ctx.platform : null;
  const base = {
    installId,
    sessionId,
    userId: userId && mongoose.isValidObjectId(userId) ? userId : null,
    platform,
    osVersion: str(ctx.osVersion, 40),
    appVersion: str(ctx.appVersion, 40),
    build: str(ctx.build, 40) || (platform === 'ios' ? iosBuildFromUserAgent(userAgent) : null),
    device: str(ctx.device, 80),
  };
  const docs = [];
  for (const e of events) {
    if (!e || !TYPES.includes(e.type)) continue;
    const t = Number(new Date(e.at));
    // Clock skew and replays: accept events from the last 7 days, never from the future.
    const at = new Date(
      Number.isFinite(t) && t <= now + 5 * 60 * 1000 && t >= now - 7 * DAY ? t : now
    );
    const doc = { ...base, type: e.type, at, screen: str(e.screen, 120) };
    if (e.type === 'error') {
      doc.name = str(e.name, 80) || 'Error';
      doc.message = str(e.message, 500) || '(no message)';
      doc.stack = str(e.stack, 4000);
      doc.fatal = e.fatal === true;
      doc.kind = KINDS.includes(e.kind) ? e.kind : 'js';
      doc.fingerprint = fingerprint(doc.name, doc.message, doc.stack);
    } else if (e.type === 'api') {
      doc.method = str(e.method, 10)?.toUpperCase() || null;
      doc.path = str(e.path, 200);
      doc.status = Number.isInteger(e.status) && e.status >= 0 && e.status < 600 ? e.status : null;
      doc.ms = Number.isFinite(e.ms) && e.ms >= 0 ? Math.min(Math.round(e.ms), 600_000) : null;
      if (!doc.path) continue;
    }
    docs.push(doc);
  }
  return {
    docs,
    dropped: events.length - docs.length + Math.max(0, (ctx.events?.length || 0) - MAX_BATCH),
  };
}

async function ingest(req, res) {
  const { docs, error } = normalize(
    req.body,
    req.userId || req.user?._id || null,
    Date.now(),
    req.get('user-agent')
  );
  if (error) return res.status(400).json({ success: false, message: error });
  if (docs.length) await require('../../models/MobileEvent').insertMany(docs, { ordered: false });
  return res.status(202).json({ success: true, accepted: docs.length });
}

/**
 * The app version on each phone (install) these users used, newest phone first: one row per
 * user + install with its latest event. Telemetry is kept 30 days.
 * ponytail: the newest `scan` events are grouped; a user active only before those is missed
 * (a per-user latest-install collection is the upgrade).
 */
function appInstallsOf(userIds, { limit = 10, scan = 5000 } = {}) {
  const ids = userIds.filter(Boolean);
  if (!ids.length) return Promise.resolve([]);
  return require('../../models/MobileEvent').aggregate([
    { $match: { userId: { $in: ids } } },
    { $sort: { at: -1 } },
    { $limit: scan },
    {
      $group: {
        _id: { userId: '$userId', installId: '$installId' },
        lastSeen: { $first: '$at' },
        platform: { $first: '$platform' },
        appVersion: { $first: '$appVersion' },
        build: { $first: '$build' },
        device: { $first: '$device' },
        osVersion: { $first: '$osVersion' },
      },
    },
    { $sort: { lastSeen: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: '$_id.installId',
        userId: '$_id.userId',
        lastSeen: 1,
        platform: 1,
        appVersion: 1,
        build: 1,
        device: 1,
        osVersion: 1,
      },
    },
  ]);
}

module.exports = {
  normalize,
  fingerprint,
  ingest,
  iosBuildFromUserAgent,
  appInstallsOf,
  MAX_BATCH,
};
