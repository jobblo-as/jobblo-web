/**
 * Small JSON cache for hot public reads. Redis when REDIS_URL is set (shared by every
 * instance), otherwise a bounded in-process map. A Redis error is a cache miss, never a
 * failed request.
 *
 *   router.get('/', cacheJson('categories', 300), controller.list)   // response cache
 *   await invalidate('categories')                                    // after a write
 *
 * Entries are stored serialized (a Buffer of the JSON), so a hit is sent as-is: no parse, no
 * re-stringify. With Redis, the same map is a short-lived L1 in front of it, so a burst on one
 * URL costs one Redis GET per L1_MS per process instead of one per request.
 */
const redis = require('../config/redis');

const MAX_LOCAL = 500;
// ponytail: L1 staleness ceiling. invalidate() clears this process's L1 at once, but another
// instance/cluster worker keeps serving its copy for up to L1_MS after a write. Raise it for
// more Redis savings, or add pub/sub invalidation if 1 s ever matters.
const L1_MS = 1000;
const local = new Map(); // key → { buf, expires, etag? }
const inflight = new Map(); // key → Promise<Buffer|undefined>, one Redis GET per key at a time
let generation = 0; // bumped by invalidate(): a read that started before it must not refill L1

const fullKey = (key) => `${redis.PREFIX}:cache:${key}`;
// Every cached key of a namespace is listed in this set, so invalidate() deletes exactly them
// instead of SCANning the whole keyspace (rate-limit keys alone are one per client IP).
const indexKey = (key) => `${redis.PREFIX}:cacheidx:${key.split(':')[0]}`;
// Every cacheJson namespace with its TTL and hit/miss counts (Cache Manager page).
// ponytail: counts are per process since start; with several instances each shows its own share.
const namespaces = new Map(); // name → { ttlSec, hits, misses }

/** Redis only when it can answer now: while it is down a read is an instant miss, not a wait. */
const liveRedis = () => {
  const client = redis.getRedis();
  return client && client.status === 'ready' ? client : null;
};

function remember(key, buf, ms) {
  if (local.size >= MAX_LOCAL && !local.has(key)) local.delete(local.keys().next().value); // oldest first
  local.set(key, { buf, expires: Date.now() + ms });
}

/** The cached entry ({ buf }) or undefined. */
async function getEntry(key) {
  const hit = local.get(key);
  if (hit && hit.expires >= Date.now()) return hit;
  if (hit) local.delete(key);
  const client = liveRedis();
  if (!client) return undefined;
  let pending = inflight.get(key);
  if (!pending) {
    const gen = generation;
    pending = client
      .getBuffer(fullKey(key))
      .catch(() => null)
      .then((buf) => {
        if (inflight.get(key) === pending) inflight.delete(key);
        if (buf && gen === generation) remember(key, buf, L1_MS);
        return buf || undefined;
      });
    inflight.set(key, pending);
  }
  const buf = await pending;
  return buf ? local.get(key) || { buf } : undefined;
}

/** A fresh parsed copy (callers may mutate it), or undefined. */
async function get(key) {
  const entry = await getEntry(key);
  if (!entry) return undefined;
  try {
    return JSON.parse(entry.buf.toString());
  } catch {
    return undefined;
  }
}

async function store(key, buf, ttlSec) {
  if (!redis.getRedis()) return remember(key, buf, ttlSec * 1000);
  remember(key, buf, Math.min(L1_MS, ttlSec * 1000));
  const client = liveRedis();
  if (!client) return; // ponytail: not written through while Redis reconnects; the next miss after it is back writes it
  try {
    // GT: the index lives as long as its longest-lived member.
    await client.multi().set(fullKey(key), buf, 'EX', ttlSec).sadd(indexKey(key), fullKey(key)).expire(indexKey(key), ttlSec, 'GT').expire(indexKey(key), ttlSec, 'NX').exec();
  } catch {
    /* cache is best effort */
  }
}

const set = (key, value, ttlSec) => store(key, Buffer.from(JSON.stringify(value)), ttlSec);

// Atomic: a key cached while this runs is either deleted with the rest or listed afresh.
const DROP_INDEX = `local k = redis.call('SMEMBERS', KEYS[1])
for i = 1, #k, 500 do redis.call('DEL', unpack(k, i, math.min(i + 499, #k))) end
redis.call('DEL', KEYS[1])
return #k`;

/**
 * Drop every key under a namespace ("categories" clears "categories:*"). Redis keys are tracked
 * per top-level namespace, so invalidate('a:b') clears all of "a:*" there (broader, never stale).
 */
async function invalidate(namespace) {
  generation += 1;
  inflight.clear();
  for (const k of local.keys()) if (k === namespace || k.startsWith(`${namespace}:`)) local.delete(k);
  const client = redis.getRedis();
  if (!client) return;
  try {
    await client.eval(DROP_INDEX, 1, indexKey(namespace));
  } catch {
    /* entries expire on their own */
  }
}

/**
 * Express middleware: cache a successful JSON response for `ttlSec`, keyed by the full URL.
 * Only for responses that are the same for every caller (public, no per-user data).
 * `ignoreQuery`: for handlers that never read req.query, key on the path alone, so a random
 * `?r=…` per request cannot fill Redis with copies of the same response.
 */
function cacheJson(namespace, ttlSec, { ignoreQuery = false } = {}) {
  // Several routes can share a namespace: they share its counters.
  const stats = namespaces.get(namespace) || { ttlSec, hits: 0, misses: 0 };
  namespaces.set(namespace, stats);
  return async (req, res, next) => {
    if (req.method !== 'GET') return next();
    const key = `${namespace}:${ignoreQuery ? req.originalUrl.split('?')[0] : req.originalUrl}`;
    const gen = generation;
    const hit = await getEntry(key);
    if (hit) {
      stats.hits += 1;
      // Same bytes and headers res.json would send; the ETag is hashed once per entry.
      const etagFn = req.app.get('etag fn');
      if (etagFn && hit.etag === undefined) hit.etag = etagFn(hit.buf) || null;
      if (hit.etag) res.set('ETag', hit.etag);
      res.set('X-Cache', 'HIT');
      res.set('Content-Type', 'application/json; charset=utf-8');
      return res.send(hit.buf);
    }
    stats.misses += 1;
    const json = res.json.bind(res);
    res.json = (body) => {
      res.set('X-Cache', 'MISS');
      if (res.statusCode !== 200) return json(body);
      // Keep the string express.json produces (one stringify), unless a write invalidated
      // the namespace while this response was being built.
      const send = res.send;
      res.send = (chunk) => {
        res.send = send;
        if (typeof chunk === 'string' && gen === generation) void store(key, Buffer.from(chunk), ttlSec);
        return send.call(res, chunk);
      };
      return json(body);
    };
    return next();
  };
}

/** Drop one cached response (key without the prefix, e.g. "categories:/api/categories"). */
async function deleteKey(key) {
  local.delete(key);
  const client = redis.getRedis();
  if (client) await client.del(fullKey(key));
}

module.exports = { get, set, invalidate, deleteKey, cacheJson, namespaces, fullKey, _local: local };
