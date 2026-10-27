/**
 * Caching (developer console → Caching): the three layers a public read can be answered from,
 * outermost first.
 *   1. nginx micro-cache (3 s, anonymous GETs only) — from the nginx access log
 *   2. in-process L1 (1 s) + Redis response cache (TTL per namespace) — hits/misses summed
 *      over every API worker's heartbeat, keys counted in Redis
 * Read-only; invalidation stays on the Redis → Cache Manager page.
 */
const redis = require('../../config/redis');
const cache = require('../../utils/cache');
const { listWorkers } = require('./workers');
const { accessLog } = require('./nginx');

/** Pure: namespace of a cache key "<prefix>:cache:<namespace>:<rest>". */
const namespaceOf = (key, prefix) => key.slice(`${prefix}:cache:`.length).split(':')[0];

/**
 * Keys per namespace from utils/cache's index sets (<prefix>:cacheidx:<ns>, one SCARD each) —
 * no SCAN over the keyspace. ponytail: an index member can outlive its key by up to the
 * namespace TTL, so the count is an upper bound; exact counts are on the Cache Manager page.
 */
async function redisKeyCounts(names) {
  const client = redis.getRedis();
  if (!client || !redis.isReady()) return { available: false, reason: redis.enabled() ? 'Redis not connected' : 'REDIS_URL not set (cache is in-process per worker)' };
  try {
    const counts = {};
    await Promise.all(names.map(async (ns) => (counts[ns] = await client.scard(`${redis.PREFIX}:cacheidx:${ns}`))));
    return { available: true, counts, truncated: false };
  } catch (e) {
    return { available: false, reason: e.message };
  }
}

async function cachingOverview() {
  const [workers, nginx] = await Promise.all([listWorkers(), accessLog()]);
  const ttl = Object.fromEntries([...cache.namespaces].map(([name, s]) => [name, s.ttlSec]));
  const keys = await redisKeyCounts([...new Set([...Object.keys(workers.totals.cache), ...Object.keys(ttl)])]);
  const names = [...new Set([...Object.keys(workers.totals.cache), ...Object.keys(keys.counts || {}), ...Object.keys(ttl)])].sort();
  return {
    nginx: nginx.available
      ? { available: true, hitRate: nginx.cacheHitRate, statuses: nginx.cache, topPaths: nginx.topPaths, window: { from: nginx.from, to: nginx.to, lines: nginx.lines } }
      : nginx,
    api: {
      store: redis.isReady() ? 'redis' : 'in-process',
      workers: workers.totals.workers,
      namespaces: names.map((name) => {
        const c = workers.totals.cache[name] || { hits: 0, misses: 0, hitRate: null };
        return { name, ttlSec: ttl[name] ?? null, hits: c.hits, misses: c.misses, hitRate: c.hitRate, redisKeys: keys.counts?.[name] ?? null };
      }),
    },
    redisKeys: keys.available ? { available: true, truncated: keys.truncated } : keys,
  };
}

module.exports = { cachingOverview, namespaceOf };
