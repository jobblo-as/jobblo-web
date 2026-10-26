// Developer console → Workers: totals across worker heartbeats, and the single-process fallback.
const { summarize, listWorkers, snapshot } = require('../services/monitoring/workers');

test('totals add up across workers and cache hit rate is per namespace', () => {
  const t = summarize([
    { slot: 1, rps: 10.5, cpuPercent: 40, rss: 100, restarts: 0, loopP99Ms: 12, scheduler: true, errorsLastMin: 1, activeRequests: 2,
      cache: { services: { hits: 90, misses: 10 } }, passwordQueue: { busy: 1, waiting: 3 } },
    { slot: 2, rps: 9.5, cpuPercent: 35, rss: 120, restarts: 2, loopP99Ms: 30, scheduler: false, errorsLastMin: 0, activeRequests: 1,
      cache: { services: { hits: 10, misses: 0 }, categories: { hits: 0, misses: 0 } }, passwordQueue: { busy: 0, waiting: 0 } },
  ]);
  expect(t).toMatchObject({ workers: 2, rps: 20, cpuPercent: 75, rss: 220, restarts: 2, worstLoopP99Ms: 30, schedulerWorkers: 1, passwordBusy: 1, passwordWaiting: 3, errorsLastMin: 1, activeRequests: 3 });
  expect(t.cache.services).toEqual({ hits: 100, misses: 10, hitRate: 90.9 });
  expect(t.cache.categories.hitRate).toBeNull(); // no traffic yet, not 0 %
});

test('without Redis the list is this process alone', async () => {
  const r = await listWorkers(); // NODE_ENV=test: Redis is off
  expect(r.redis).toBe(false);
  expect(r.workers).toHaveLength(1);
  expect(r.workers[0].pid).toBe(process.pid);
  expect(r.totals.workers).toBe(1);
});

test('a snapshot carries the fields the page reads', () => {
  const s = snapshot();
  for (const k of ['id', 'pid', 'cpuPercent', 'rss', 'heapUsed', 'rps', 'p95LastMinMs', 'cache', 'passwordQueue', 'restarts', 'scheduler']) expect(s).toHaveProperty(k);
  expect(s.passwordQueue).toMatchObject({ active: 0, waiting: 0, maxActive: 2 });
});

// Dependency Map: the Redis / API workers / cache / background-jobs nodes.
describe('dependency map scaling nodes', () => {
  const { scalingNodes } = require('../controllers/developer/dependencyController');
  const byId = (nodes) => Object.fromEntries(nodes.map((n) => [n.id, n]));
  const totals = (over = {}) => ({ workers: 4, rps: 100, worstLoopP99Ms: 20, restarts: 0, passwordBusy: 0, cache: { services: { hits: 95, misses: 5, hitRate: 95 } }, ...over });
  const healthyRedis = { enabled: true, ok: true, ms: 1, status: 'ready', memory: { used: '2M', max: '256M', policy: 'noeviction' } };

  test('all healthy with Redis up, every worker reporting and a warm cache', () => {
    const n = byId(scalingNodes({ workers: { configured: '4', totals: totals() }, redis: healthyRedis, queues: { email: { waiting: 0, active: 0, failed: 0 } }, queueMode: 'redis' }));
    expect([n.redis.status, n.workers.status, n.cache.status, n.queues.status]).toEqual(['healthy', 'healthy', 'healthy', 'healthy']);
  });

  test('missing workers, Redis down in cluster mode, eviction policy and dead letters are flagged', () => {
    expect(byId(scalingNodes({ workers: { configured: '4', totals: totals({ workers: 3 }) }, redis: healthyRedis, queueMode: 'redis', queues: {} })).workers.status).toBe('degraded');
    const down = byId(scalingNodes({ workers: { configured: '4', totals: totals({ workers: 1 }) }, redis: { enabled: true, ok: false, error: 'ECONNREFUSED' }, queueMode: 'redis', queues: null }));
    expect([down.redis.status, down.workers.status, down.queues.status]).toEqual(['down', 'degraded', 'down']);
    expect(byId(scalingNodes({ workers: { configured: '1', totals: totals({ workers: 1 }) }, redis: { ...healthyRedis, memory: { ...healthyRedis.memory, policy: 'allkeys-lru' } }, queueMode: 'redis', queues: {} })).redis.status).toBe('degraded');
    expect(byId(scalingNodes({ workers: { configured: '1', totals: totals() }, redis: healthyRedis, queueMode: 'redis', queues: { email: { failed: 3 } } })).queues.status).toBe('degraded');
  });

  test('no Redis configured: Redis off, cache in-process, jobs inline', () => {
    const n = byId(scalingNodes({ workers: { configured: '1', totals: totals({ workers: 1, cache: {} }) }, redis: { enabled: false }, queueMode: 'inline', queues: null }));
    expect(n.redis.status).toBe('off');
    expect(n.cache.metrics.Store).toBe('in-process only');
    expect(n.cache.status).toBe('unknown'); // no traffic yet
    expect(n.queues.status).toBe('unknown');
  });
});
