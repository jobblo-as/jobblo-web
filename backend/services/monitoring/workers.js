/**
 * API workers (developer console → Workers).
 *
 * With WEB_CONCURRENCY>1 every page on the console is answered by whichever worker took the
 * request, so per-process numbers (CPU, memory, event loop, cache hit rate) showed one worker at
 * a time. Each process now writes a heartbeat to Redis every HEARTBEAT_MS, expiring after
 * TTL_SEC; `listWorkers()` reads them all. A worker that stops writing disappears from the list.
 * Without Redis there is one process, and the list is that process alone.
 */
const os = require('os');
const { monitorEventLoopDelay } = require('perf_hooks');
const redis = require('../../config/redis');
const { liveSnapshot } = require('../../middleware/requestMetrics');
const cache = require('../../utils/cache');
const { passwordQueueStats } = require('../../utils/passwordUtils');

const HEARTBEAT_MS = 5000;
const TTL_SEC = 20;
const keyPrefix = () => `${redis.PREFIX}:workers:`;
// Sorted set of worker ids by last heartbeat, so listing is two round trips instead of a SCAN
// over the whole keyspace (rate-limit and cache keys made that take seconds).
const indexKey = () => `${redis.PREFIX}:workers-index`;
const startedAt = new Date();

let loop = null;
let lastCpu = process.cpuUsage();
let lastAt = Date.now();
let timer = null;

const round1 = (v) => Math.round(v * 10) / 10;
const ms = (ns) => (Number.isFinite(ns) ? round1(ns / 1e6) : null);

/** This process right now. */
function snapshot() {
  const now = Date.now();
  const cpu = process.cpuUsage(lastCpu);
  const cpuPercent = round1(((cpu.user + cpu.system) / 1000 / Math.max(1, now - lastAt)) * 100);
  lastCpu = process.cpuUsage();
  lastAt = now;
  const mem = process.memoryUsage();
  const live = liveSnapshot();
  const cacheStats = {};
  for (const [name, s] of cache.namespaces) cacheStats[name] = { hits: s.hits, misses: s.misses };
  const out = {
    id: `${os.hostname()}:${process.pid}`,
    host: os.hostname(),
    pid: process.pid,
    ppid: process.ppid, // the cluster primary when slot is set
    slot: Number(process.env.WORKER_SLOT) || null,
    restarts: Number(process.env.WORKER_RESTARTS) || 0,
    schedPolicy:
      process.env.NODE_CLUSTER_SCHED_POLICY || (process.platform === 'win32' ? 'none' : 'rr'),
    lastExit: process.env.WORKER_LAST_EXIT || null,
    node: process.version,
    startedAt,
    at: new Date(now),
    cpuPercent,
    rss: mem.rss,
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    loopP50Ms: loop ? ms(loop.percentile(50)) : null,
    loopP99Ms: loop ? ms(loop.percentile(99)) : null,
    loopMaxMs: loop ? ms(loop.max) : null,
    rps: live.rps,
    activeRequests: live.activeRequests,
    requestsLastMin: live.requestsLastMin,
    errorsLastMin: live.errorsLastMin,
    p95LastMinMs: live.p95LastMin,
    scheduler: String(process.env.ENABLE_SCHEDULER || 'true').toLowerCase() !== 'false',
    redis: redis.isReady(),
    cache: cacheStats,
    passwordQueue: passwordQueueStats(),
  };
  loop?.reset();
  return out;
}

async function beat() {
  const client = redis.getRedis();
  if (!client || !redis.isReady()) return;
  try {
    const s = snapshot();
    const now = Date.now();
    await client
      .multi()
      .set(keyPrefix() + s.id, JSON.stringify(s), 'EX', TTL_SEC)
      .zadd(indexKey(), now, s.id)
      .zremrangebyscore(indexKey(), '-inf', now - TTL_SEC * 1000)
      .expire(indexKey(), 3600)
      .exec();
  } catch {
    /* monitoring is best effort */
  }
}

function startWorkerHeartbeat() {
  if (timer || process.env.NODE_ENV === 'test') return;
  loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  timer = setInterval(beat, HEARTBEAT_MS);
  timer.unref?.();
  void beat();
}

/** Pure: totals across worker snapshots (cache hits/misses summed per namespace). */
function summarize(workers) {
  const sum = (k) => workers.reduce((a, w) => a + (Number(w[k]) || 0), 0);
  const cache = {};
  for (const w of workers) {
    for (const [name, s] of Object.entries(w.cache || {})) {
      const c = (cache[name] ||= { hits: 0, misses: 0 });
      c.hits += s.hits || 0;
      c.misses += s.misses || 0;
    }
  }
  for (const c of Object.values(cache))
    c.hitRate = c.hits + c.misses ? round1((c.hits / (c.hits + c.misses)) * 100) : null;
  return {
    workers: workers.length,
    rps: round1(sum('rps')),
    activeRequests: sum('activeRequests'),
    errorsLastMin: sum('errorsLastMin'),
    cpuPercent: round1(sum('cpuPercent')),
    rss: sum('rss'),
    restarts: sum('restarts'),
    worstLoopP99Ms: workers.reduce((m, w) => Math.max(m, w.loopP99Ms || 0), 0),
    passwordBusy: workers.reduce((a, w) => a + (w.passwordQueue?.busy || 0), 0),
    passwordWaiting: workers.reduce((a, w) => a + (w.passwordQueue?.waiting || 0), 0),
    schedulerWorkers: workers.filter((w) => w.scheduler).length,
    cache,
  };
}

/** Every live worker (all hosts sharing this Redis prefix), slot order. */
async function listWorkers() {
  const client = redis.getRedis();
  let workers = [];
  if (client && redis.isReady()) {
    try {
      const ids = await client.zrangebyscore(indexKey(), Date.now() - TTL_SEC * 1000, '+inf');
      if (ids.length)
        workers = (await client.mget(...ids.map((id) => keyPrefix() + id)))
          .filter(Boolean)
          .map((raw) => JSON.parse(raw));
    } catch {
      workers = [];
    }
  }
  if (!workers.length) workers = [snapshot()]; // no Redis (single process) or nothing written yet
  workers.sort((a, b) => (a.slot || 0) - (b.slot || 0) || a.pid - b.pid);
  return {
    configured: process.env.WEB_CONCURRENCY || '1',
    // One primary per host that runs cluster workers (pm2 runs the primary in fork mode).
    primaries: [
      ...new Map(
        workers
          .filter((w) => w.slot)
          .map((w) => [
            `${w.host}:${w.ppid}`,
            {
              host: w.host,
              pid: w.ppid,
              workers: workers.filter((x) => x.host === w.host && x.ppid === w.ppid).length,
              schedPolicy: w.schedPolicy,
            },
          ])
      ).values(),
    ],
    redis: redis.isReady(),
    heartbeatSec: HEARTBEAT_MS / 1000,
    workers,
    totals: summarize(workers),
  };
}

module.exports = { startWorkerHeartbeat, listWorkers, snapshot, summarize, HEARTBEAT_MS, TTL_SEC };
