/**
 * Cache an expensive computation (utils/cache: Redis or in-process) and run it at most once
 * per process at a time: concurrent misses for the same key share one promise instead of each
 * hitting Mongo (thundering herd after a TTL expiry or an invalidate()).
 *
 *   res.json(await memo('services:location-stats', 30, computeStats));
 *
 * ponytail: single-flight is per process; N cluster workers can still run it N times per miss.
 */
const cache = require('./cache');

const inflight = new Map(); // key → Promise

async function memo(key, ttlSec, compute) {
  const hit = await cache.get(key);
  if (hit !== undefined) return hit;
  if (!inflight.has(key)) {
    const p = Promise.resolve()
      .then(compute)
      .then((value) => {
        void cache.set(key, value, ttlSec);
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return inflight.get(key);
}

module.exports = { memo, _inflight: inflight };
