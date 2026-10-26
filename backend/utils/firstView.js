const crypto = require('node:crypto');
const redis = require('../config/redis');

/**
 * Is this the viewer's first view of this listing in 24 h? `views` drives "Trending", so one
 * viewer (user id, or a hash of the IP when signed out) counts once per listing per day.
 * Redis SET NX EX when Redis is on, so the window holds across instances; otherwise (or if
 * Redis errors) an in-process map.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 50_000; // ponytail: per-process and evicts oldest first; Redis is the real store in production
const seen = new Map();

async function firstView(req, listingId) {
  const who = req.userId
    ? `u:${req.userId}`
    : `ip:${crypto.createHash('sha256').update(String(req.ip || '')).digest('hex').slice(0, 24)}`;
  const key = `${listingId}:${who}`;
  const client = redis.getRedis();
  if (client) {
    try {
      return (await client.set(`${redis.PREFIX}:view:${key}`, '1', 'PX', DAY_MS, 'NX')) === 'OK';
    } catch { /* fall through to memory */ }
  }
  const now = Date.now();
  const at = seen.get(key);
  if (at && now - at < DAY_MS) return false;
  seen.delete(key);
  if (seen.size >= MAX_ENTRIES) seen.delete(seen.keys().next().value);
  seen.set(key, now);
  return true;
}

module.exports = { firstView, _seen: seen };
