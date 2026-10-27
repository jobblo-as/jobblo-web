const mongoose = require('mongoose');
const { sendSuccess, asyncHandler } = require('../../utils/apiResponse');
const { liveSnapshot } = require('../../middleware/requestMetrics');
const apm = require('../../services/monitoring/apm');
const scheduler = require('../../services/scheduler');

/**
 * Developer dashboard — system dependency map. Every component Jobblo depends on, how they
 * connect, and each one's health from real signals:
 *   passive: request metrics, APM (Mongo/Stripe latency), delivery logs, webhook health,
 *            scheduler runs, synthetic probes, mobile telemetry, backups;
 *   active:  a cheap live check per external (cached 60 s, 5 s timeout each).
 * Read-only. Live checks never send data — they read a balance, verify an SMTP login,
 * read container properties or fetch a public OIDC discovery document.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const TIMEOUT = 5000;

const env = (...keys) => keys.every((k) => Boolean(process.env[k]));
const withTimeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${TIMEOUT / 1000}s`)), TIMEOUT))]);

/** Run one live check: { ok, ms, error }. */
async function probe(fn) {
  const t = Date.now();
  try {
    const detail = await withTimeout(fn());
    return { ok: true, ms: Date.now() - t, detail: detail || null };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, error: String(e.message || e).slice(0, 200) };
  }
}

const discovery = (url) => async () => {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return null;
};

const LIVE = {
  mongo: () => mongoose.connection.db.admin().ping(),
  stripe: async () => {
    const stripe = await require('../../config/stripe').getStripe();
    await stripe.balance.retrieve();
  },
  smtp: () =>
    require('nodemailer')
      .createTransport({ host: process.env.SMTP_HOST || 'smtp.gmail.com', port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } })
      .verify(),
  blob: async () => {
    const { BlobServiceClient } = require('@azure/storage-blob');
    const container = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING).getContainerClient(process.env.AZURE_CONTAINER_NAME || 'images');
    await container.getProperties();
  },
  idura: async () => {
    const issuer = require('../../config/iduraClient').issuerUrl();
    return discovery(`${issuer.href.replace(/\/$/, '')}/.well-known/openid-configuration`)();
  },
  google: discovery('https://accounts.google.com/.well-known/openid-configuration'),
  vipps: () => discovery(`${(process.env.VIPPS_BASE_URL || 'https://apitest.vipps.no').replace(/\/$/, '')}/access-management-1.0/access/.well-known/openid-configuration`)(),
  openai: async () => {
    const res = await fetch('https://api.openai.com/v1/models?limit=1', { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  },
  github: async () => {
    const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPO}`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'User-Agent': 'jobblo-devdash' }, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  },
};

let liveCache = { at: 0, results: {} };
async function liveChecks(configured, force) {
  if (!force && Date.now() - liveCache.at < MINUTE) return liveCache;
  const keys = Object.keys(LIVE).filter((k) => configured[k]);
  const results = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await probe(LIVE[k])])));
  liveCache = { at: Date.now(), results };
  return liveCache;
}

/** Pure: combine signals into one status. Unit-tested. */
function verdict({ configured = true, live, errorRate, failures = 0, stale = false } = {}) {
  if (!configured) return 'off';
  if (live && !live.ok) return 'down';
  if ((errorRate ?? 0) >= 0.25 || stale) return 'degraded';
  if ((errorRate ?? 0) >= 0.05 || failures > 0) return 'degraded';
  if (live?.ok || errorRate !== undefined) return 'healthy';
  return 'unknown';
}

const rate = (failed, total) => (total ? failed / total : undefined);

/** Redis ping + memory, BullMQ job counts, worker heartbeats. Each part fails soft (shown, not thrown). */
async function scalingSignals() {
  const redis = require('../../config/redis');
  const queue = require('../../services/queue');
  const [workers, ping] = await Promise.all([
    require('../../services/monitoring/workers').listWorkers().catch(() => null),
    redis.enabled() ? redis.pingRedis().catch((e) => ({ enabled: true, ok: false, error: e.message })) : { enabled: false },
  ]);
  let memory = null;
  let queues = null;
  if (ping.ok) {
    memory = await withTimeout(redis.getRedis().info('memory'))
      .then((info) => ({ used: /used_memory_human:(\S+)/.exec(info)?.[1], max: /maxmemory_human:(\S+)/.exec(info)?.[1], policy: /maxmemory_policy:(\S+)/.exec(info)?.[1] }))
      .catch(() => null);
    if (queue.usingRedis()) {
      queues = await withTimeout(
        Promise.all(Object.keys(queue.QUEUES).map(async (name) => [name, await queue.getQueue(name).getJobCounts('waiting', 'active', 'delayed', 'failed')]))
      )
        .then(Object.fromEntries)
        .catch((e) => ({ error: e.message }));
    }
  }
  return { workers, redis: { ...ping, status: redis.state?.status, memory }, queues, queueMode: queue.usingRedis() ? 'redis' : 'inline' };
}

/** Pure: the Redis / API workers / response cache / background jobs nodes. Unit-tested. */
function scalingNodes({ workers, redis, queues, queueMode }) {
  const t = workers?.totals;
  const configured = workers?.configured || '1';
  const wantMany = configured !== '1';
  const expected = /^\d+$/.test(configured) ? Number(configured) : null;
  const cacheRows = Object.entries(t?.cache || {});
  const hits = cacheRows.reduce((a, [, c]) => a + c.hits, 0);
  const misses = cacheRows.reduce((a, [, c]) => a + c.misses, 0);
  const sumQ = (k) => (queues && !queues.error ? Object.values(queues).reduce((a, c) => a + (c[k] || 0), 0) : 0);
  const evictionRisk = redis.memory?.policy && redis.memory.policy !== 'noeviction';
  return [
    {
      id: 'redis',
      name: 'Redis',
      group: 'data',
      status: !redis.enabled ? 'off' : !redis.ok ? 'down' : evictionRisk ? 'degraded' : 'healthy',
      metrics: !redis.enabled
        ? { Note: 'REDIS_URL not set: cache, rate limits and jobs are per process.' }
        : {
            Ping: redis.ok ? `${redis.ms} ms` : redis.error || redis.status || 'unreachable',
            Connection: redis.status || '—',
            ...(redis.memory
              ? {
                  Memory: `${redis.memory.used || '?'} of ${redis.memory.max && redis.memory.max !== '0B' ? redis.memory.max : 'no limit'}`,
                  Eviction: evictionRisk ? `${redis.memory.policy} — set noeviction (BullMQ jobs can be evicted)` : redis.memory.policy,
                }
              : {}),
          },
      impact: 'Shared cache, cross-worker rate limits, background jobs (email, push, scheduled jobs) and realtime across workers stop; with WEB_CONCURRENCY>1 the API falls back to one process.',
    },
    {
      id: 'workers',
      name: 'API workers (cluster)',
      group: 'core',
      status: !t ? 'unknown' : (expected && t.workers < expected) || (wantMany && !redis.ok) || t.worstLoopP99Ms >= 200 ? 'degraded' : 'healthy',
      metrics: t
        ? {
            Workers: `${t.workers} running · WEB_CONCURRENCY=${configured}`,
            'Requests / s': t.rps,
            'Event loop p99 (worst)': `${t.worstLoopP99Ms} ms`,
            Restarts: t.restarts,
            'Logins refused (busy)': t.passwordBusy,
            ...(wantMany && !redis.ok ? { Note: 'Redis is down, so cluster mode runs ONE process.' } : {}),
          }
        : {},
      impact: 'Fewer workers means less throughput; a crash-looping worker restarts with backoff. Details on the API Workers page.',
    },
    {
      id: 'cache',
      name: 'Response cache',
      group: 'core',
      status: hits + misses < 50 ? 'unknown' : hits / (hits + misses) < 0.5 ? 'degraded' : 'healthy',
      metrics: {
        Store: redis.ok ? 'Redis (shared) + 1 s in-process' : 'in-process only',
        'Hit rate (all workers)': hits + misses ? `${Math.round((hits / (hits + misses)) * 1000) / 10}% of ${hits + misses}` : 'no traffic yet',
        ...Object.fromEntries(cacheRows.slice(0, 5).map(([name, c]) => [name, c.hitRate == null ? '—' : `${c.hitRate}%`])),
      },
      impact: 'Public job lists, categories and filters hit MongoDB on every request: slower pages and less headroom under load.',
    },
    {
      id: 'queues',
      name: 'Background jobs',
      group: 'core',
      status: queueMode !== 'redis' ? 'unknown' : !queues || queues.error ? 'down' : sumQ('failed') > 0 || sumQ('waiting') > 500 ? 'degraded' : 'healthy',
      metrics:
        queueMode !== 'redis'
          ? { Mode: 'in-process (no Redis): a job lost in a restart is not retried' }
          : queues?.error
            ? { Error: queues.error }
            : { Mode: 'BullMQ', Waiting: sumQ('waiting'), Active: sumQ('active'), Delayed: sumQ('delayed'), 'Failed (dead letters)': sumQ('failed') },
      impact: 'Emails (OTP, receipts), push notifications and scheduled jobs are delayed; failed jobs wait in the dead-letter list on the Queues page.',
    },
  ];
}

const getDependencies = asyncHandler(async (req, res) => {
  const force = req.query.refresh === 'true';
  const since = (ms) => new Date(Date.now() - ms);
  const configured = {
    mongo: mongoose.connection.readyState === 1,
    stripe: env('STRIPE_SECRET_KEY') || env('STRIPE_TEST_SECRET_KEY'),
    smtp: env('SMTP_USER', 'SMTP_PASS'),
    blob: env('AZURE_STORAGE_CONNECTION_STRING'),
    idura: require('../../config/iduraClient').isIduraConfigured(),
    google: env('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'),
    vipps: env('VIPPS_CLIENT_ID', 'VIPPS_CLIENT_SECRET'),
    openai: env('OPENAI_API_KEY'),
    github: env('GITHUB_TOKEN', 'GITHUB_REPO'),
    fcm: env('GOOGLE_APPLICATION_CREDENTIALS') || env('FIREBASE_CONFIG'),
    slack: env('SLACK_WEBHOOK_URL'),
    backups: env('BACKUP_DIR') || env('ATLAS_CLIENT_ID', 'ATLAS_GROUP_ID'),
  };

  const DeliveryLog = require('../../models/DeliveryLog');
  const deliveries = (channel) =>
    DeliveryLog.aggregate([{ $match: { channel, at: { $gte: since(24 * HOUR) } } }, { $group: { _id: '$status', n: { $sum: 1 }, last: { $max: '$at' } } }]);
  const [live, email, push, webhook, webhookFailing, schedulerFailed, synthetic, mobile, lastBackup] = await Promise.all([
    liveChecks(configured, force),
    deliveries('email'),
    deliveries('push'),
    require('../../models/StripeWebhookHealth').findOne().sort({ updatedAt: -1 }).lean(),
    require('../../models/StripeEvent').countDocuments({ status: 'processing', lastError: { $ne: null } }),
    require('../../models/SchedulerRun').find({ ok: false, startedAt: { $gte: since(HOUR) } }).select('job').lean(),
    require('../../models/SyntheticRun').aggregate([{ $match: { at: { $gte: since(30 * MINUTE) } } }, { $sort: { at: -1 } }, { $group: { _id: '$key', ok: { $first: '$ok' }, latencyMs: { $first: '$latencyMs' }, error: { $first: '$error' }, at: { $first: '$at' } } }]),
    require('../../models/MobileEvent').aggregate([
      { $match: { at: { $gte: since(HOUR) } } },
      { $group: { _id: null, sessions: { $sum: { $cond: [{ $eq: ['$type', 'session'] }, 1, 0] } }, crashes: { $sum: { $cond: ['$fatal', 1, 0] } }, apiFailures: { $sum: { $cond: [{ $eq: ['$type', 'api'] }, 1, 0] } } } },
    ]),
    require('../../models/BackupRun').findOne({ kind: 'backup', status: 'succeeded' }).sort({ startedAt: -1 }).select('startedAt').lean(),
  ]);
  const scaling = await scalingSignals();
  const schedulerWorkers = (scaling.workers?.workers || []).filter((w) => w.scheduler);
  const schedulerOn = scaling.workers?.workers?.length ? schedulerWorkers.length > 0 : scheduler.state.enabled;
  const schedulerWhere = schedulerWorkers.map((w) => (w.slot ? `worker ${w.slot}` : `pid ${w.pid}`)).join(', ');
  const L = live.results;
  const syn = Object.fromEntries(synthetic.map((s) => [s._id, s]));
  const deliveryStats = (rows) => {
    const by = Object.fromEntries(rows.map((r) => [r._id, r.n]));
    const total = rows.reduce((a, r) => a + r.n, 0);
    return { total, failed: (by.failed || 0) + (by.partial || 0), sent: by.sent || 0, last: rows.reduce((a, r) => (!a || r.last > a ? r.last : a), null) };
  };
  const em = deliveryStats(email);
  const pu = deliveryStats(push);
  const snap = apm.snapshot();
  const reqs = liveSnapshot();
  const mob = mobile[0] || { sessions: 0, crashes: 0, apiFailures: 0 };
  const stripeCalls = (snap.stripe || []).reduce((a, s) => a + (s.count || 0), 0);
  const backupAgeH = lastBackup ? (Date.now() - lastBackup.startedAt) / HOUR : null;
  const apiPublic = process.env.SYNTHETIC_API_URL && !/127\.0\.0\.1|localhost/.test(process.env.SYNTHETIC_API_URL);
  // Below 20 requests a single 5xx would read as a 5–50 % error rate; the API is answering this request, so call it healthy.
  const apiErrRate = reqs.requestsLastMin >= 20 ? rate(reqs.errorsLastMin, reqs.requestsLastMin) : 0;

  const node = (id, n) => ({ id, ...n });
  const nodes = [
    node('web', {
      name: 'Web app',
      group: 'client',
      status: syn.web ? (syn.web.ok ? 'healthy' : 'down') : 'unknown',
      metrics: syn.web ? { 'Synthetic probe': syn.web.ok ? `ok · ${syn.web.latencyMs} ms` : syn.web.error } : {},
      impact: 'Customers, providers and admins cannot use jobblo.no.',
    }),
    node('mobile', {
      name: 'Mobile app',
      group: 'client',
      status: !mob.sessions ? 'unknown' : mob.crashes >= 5 ? 'degraded' : 'healthy',
      metrics: { 'Sessions (1 h)': mob.sessions, 'Crashes (1 h)': mob.crashes, 'API failures (1 h)': mob.apiFailures },
      impact: 'App users see errors; crash reports show on the Mobile App page.',
    }),
    node('nginx', {
      name: 'Reverse proxy (nginx + TLS)',
      group: 'edge',
      status: apiPublic && syn.api ? (syn.api.ok ? 'healthy' : 'down') : 'unknown',
      metrics: apiPublic ? { 'Public API probe': syn.api ? (syn.api.ok ? `ok · ${syn.api.latencyMs} ms` : syn.api.error) : 'no recent run' } : { Note: 'Set SYNTHETIC_API_URL to the public https URL to measure it.' },
      impact: 'Nothing reaches the API: web, app and Stripe webhooks all fail.',
    }),
    node('api', {
      name: 'API (Node.js)',
      group: 'core',
      status: verdict({ errorRate: apiErrRate ?? 0 }),
      metrics: { 'Requests (last min)': reqs.requestsLastMin, 'Errors (last min)': reqs.errorsLastMin, 'Event loop p99': snap.eventLoop?.p99 != null ? `${snap.eventLoop.p99} ms` : '—' },
      impact: 'Whole platform down.',
    }),
    node('realtime', {
      name: 'Realtime (socket.io)',
      group: 'core',
      status: syn.realtime ? (syn.realtime.ok ? 'healthy' : 'down') : 'unknown',
      metrics: { 'Connected sockets': req.app.get('io')?.engine?.clientsCount ?? '—', ...(syn.realtime ? { Probe: syn.realtime.ok ? `ok · ${syn.realtime.latencyMs} ms` : syn.realtime.error } : {}) },
      impact: 'Chat messages and live notifications are delayed until the page reloads.',
    }),
    node('scheduler', {
      name: 'Scheduler',
      group: 'core',
      // In cluster mode only worker 1 runs it, so "this process" is not the answer: ask the heartbeats.
      status: !schedulerOn ? 'off' : schedulerFailed.length ? 'degraded' : 'healthy',
      metrics: { Enabled: schedulerOn ? `yes${schedulerWhere ? ` (${schedulerWhere})` : ''}` : 'no — ENABLE_SCHEDULER=false on every worker', 'Failed runs (1 h)': schedulerFailed.length, ...(schedulerFailed.length ? { Failing: [...new Set(schedulerFailed.map((r) => r.job))].join(', ') } : {}) },
      impact: 'Escrow auto-release, payout retries, refunds of abandoned orders and reconciliation stop.',
    }),
    node('mongo', {
      name: 'MongoDB',
      group: 'data',
      status: verdict({ configured: true, live: L.mongo || { ok: configured.mongo } }),
      metrics: { 'Ping': L.mongo?.ok ? `${L.mongo.ms} ms` : L.mongo?.error || 'disconnected', 'Slow queries (recent)': snap.slowQueries?.length ?? 0 },
      impact: 'Whole platform down — every request reads or writes the database.',
    }),
    node('backups', {
      name: 'Backups',
      group: 'data',
      status: !configured.backups ? 'off' : backupAgeH === null ? 'down' : backupAgeH > Number(process.env.BACKUP_MAX_AGE_HOURS || 26) ? 'degraded' : 'healthy',
      metrics: { 'Last backup': backupAgeH === null ? 'never' : `${backupAgeH.toFixed(1)} h ago` },
      impact: 'No recovery point if the database is lost.',
    }),
    node('blob', {
      name: 'Azure Blob Storage',
      group: 'data',
      status: verdict({ configured: configured.blob, live: L.blob }),
      metrics: L.blob ? { 'Container check': L.blob.ok ? `${L.blob.ms} ms` : L.blob.error } : {},
      impact: 'Image, avatar and attachment uploads fail; existing images may not load.',
    }),
    node('stripe', {
      name: 'Stripe API',
      group: 'external',
      status: verdict({ configured: configured.stripe, live: L.stripe, failures: snap.stripeErrors || 0 }),
      metrics: { 'Balance check': L.stripe ? (L.stripe.ok ? `${L.stripe.ms} ms` : L.stripe.error) : '—', 'Calls (APM window)': stripeCalls, '5xx (APM window)': snap.stripeErrors || 0 },
      impact: 'Checkout, SafePay escrow, refunds, provider payouts and subscriptions fail.',
    }),
    node('stripeWebhooks', {
      name: 'Stripe webhooks',
      group: 'external',
      status: !configured.stripe ? 'off' : !webhook ? 'unknown' : webhook.status !== 'healthy' || webhookFailing > 0 ? 'degraded' : 'healthy',
      metrics: { Health: webhook?.status || 'no data', 'Last delivery': webhook?.lastDeliveryAt ? new Date(webhook.lastDeliveryAt).toISOString() : '—', 'Failing events': webhookFailing },
      impact: 'Payments succeed at Stripe but orders stay unpaid until reconciliation catches up. Deliveries reach the API through the reverse proxy.',
    }),
    node('smtp', {
      name: 'Email (SMTP)',
      group: 'external',
      status: verdict({ configured: configured.smtp, live: L.smtp, errorRate: rate(em.failed, em.total) }),
      metrics: { 'SMTP login': L.smtp ? (L.smtp.ok ? `${L.smtp.ms} ms` : L.smtp.error) : '—', 'Sent (24 h)': em.sent, 'Failed (24 h)': em.failed },
      impact: 'OTP codes, password resets, receipts and alert emails are not delivered.',
    }),
    node('fcm', {
      name: 'Push (Firebase)',
      group: 'external',
      status: verdict({ configured: configured.fcm, errorRate: rate(pu.failed, pu.total) }),
      metrics: { 'Sent (24 h)': pu.sent, 'Failed (24 h)': pu.failed },
      impact: 'Mobile push notifications (new messages, job requests, payments) are not delivered.',
    }),
    node('idura', { name: 'BankID (Idura)', group: 'external', status: verdict({ configured: configured.idura, live: L.idura }), metrics: L.idura ? { Discovery: L.idura.ok ? `${L.idura.ms} ms` : L.idura.error } : {}, impact: 'BankID identity verification and BankID login fail.' }),
    node('vipps', { name: 'Vipps login', group: 'external', status: verdict({ configured: configured.vipps, live: L.vipps }), metrics: L.vipps ? { Discovery: L.vipps.ok ? `${L.vipps.ms} ms` : L.vipps.error } : {}, impact: '"Fortsett med Vipps" sign-in fails.' }),
    node('google', { name: 'Google login', group: 'external', status: verdict({ configured: configured.google, live: L.google }), metrics: L.google ? { Discovery: L.google.ok ? `${L.google.ms} ms` : L.google.error } : {}, impact: '"Fortsett med Google" sign-in fails.' }),
    node('openai', { name: 'OpenAI', group: 'external', status: verdict({ configured: configured.openai, live: L.openai }), metrics: L.openai ? { 'Models check': L.openai.ok ? `${L.openai.ms} ms` : L.openai.error } : {}, impact: 'AI job-description help and image analysis are unavailable.' }),
    node('github', { name: 'GitHub', group: 'external', status: verdict({ configured: configured.github, live: L.github }), metrics: L.github ? { 'Repo check': L.github.ok ? `${L.github.ms} ms` : L.github.error } : {}, impact: 'Deployments page cannot list CI runs. No user impact.' }),
    node('slack', { name: 'Slack alerts', group: 'external', status: configured.slack ? 'unknown' : 'off', metrics: {}, impact: 'Incident alerts only go by email.' }),
    ...scalingNodes(scaling),
  ];

  // from → to: "from needs to".
  const edges = [
    ['web', 'nginx'], ['mobile', 'nginx'], ['nginx', 'api'], ['api', 'stripeWebhooks'], ['stripeWebhooks', 'stripe'],
    ['api', 'mongo'], ['api', 'realtime'], ['api', 'blob'], ['api', 'stripe'], ['api', 'smtp'], ['api', 'fcm'],
    ['api', 'idura'], ['api', 'vipps'], ['api', 'google'], ['api', 'openai'], ['api', 'github'], ['api', 'slack'],
    ['scheduler', 'mongo'], ['scheduler', 'stripe'], ['scheduler', 'smtp'], ['backups', 'mongo'],
    ['nginx', 'workers'], ['workers', 'redis'], ['api', 'cache'], ['cache', 'redis'], ['api', 'queues'], ['queues', 'redis'],
    ['queues', 'smtp'], ['queues', 'fcm'], ['realtime', 'redis'], ['scheduler', 'queues'],
  ].map(([from, to]) => ({ from, to }));

  return sendSuccess(res, { checkedAt: new Date(live.at), nodes, edges });
});

module.exports = { verdict, scalingSignals, scalingNodes, getDependencies };
