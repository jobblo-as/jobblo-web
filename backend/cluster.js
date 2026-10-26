/**
 * Optional multi-core mode (node:cluster). WEB_CONCURRENCY=N (or "auto" = one per CPU) forks
 * N API workers that share PORT; unset or 1 runs the single process exactly as before.
 *
 * - Needs REDIS_URL: rate limits, cache, socket.io rooms and queues must be shared, or every
 *   worker would enforce its own limits (N x the login brute-force budget). Without Redis we
 *   run ONE process and say so loudly instead of starting an unsafe cluster.
 * - Worker slot 1 owns the singleton background starters (scheduler, alerts, probes, boot
 *   records, capacity samples). Slots 2..N drop them. A restarted worker keeps its slot.
 * - socket.io: connections are spread across workers per TCP connection, so a long-polling
 *   session (several HTTP requests) would hit different workers. Workers therefore accept
 *   the websocket transport only; our web and mobile clients already connect websocket-first
 *   (and, without tryAllTransports, never fall back to polling).
 * - Crashed workers restart with exponential backoff; SIGTERM/SIGINT on the primary asks
 *   each worker to run its normal graceful shutdown (bootstrap/shutdown.js).
 */
const os = require('os');

// Names from bootstrap/background.js STARTERS. Every starter must be in exactly one list
// (__tests__/perfClusterPlan.test.js fails otherwise), so a new starter forces a decision.
const SINGLETON_STARTERS = [
  'scheduler', // timers without Redis would run money jobs N times
  'alerts', // one alert evaluator, one incident per breach
  'synthetic probes', // N x outbound probe traffic and rows
  'deployment record', // N workers racing findOne/create on boot
  'capacity', // one host snapshot per hour, not N
  'config drift', // one boot snapshot
];
const PER_WORKER_STARTERS = [
  'queue workers', // BullMQ hands each job to one consumer; inline mode needs no worker
  'request metrics', // each worker flushes its own minute rows; readers $sum them
  'external calls',
  'security events',
  'apm', // event loop / GC are per process
  'ip blocks', // each worker refreshes its block list from MongoDB
  'failure simulator', // each worker reads the active experiments
  'api contracts', // each worker flushes its own samples (or its buffer would only grow)
  'view counts', // the Redis drain is atomic (workers split it); each also drains its memory fallback
];

const SHUTDOWN_MSG = 'jobblo:shutdown';

/** Pure: how many workers to run for this env, and a warning when we refuse the request. */
function plan(env = process.env, cpus = os.availableParallelism()) {
  const raw = String(env.WEB_CONCURRENCY ?? '').trim().toLowerCase();
  if (!raw || raw === '1') return { workers: 1, warning: null };
  const asked = raw === 'auto' ? cpus : Number(raw);
  if (!Number.isInteger(asked) || asked < 1) return { workers: 1, warning: `[cluster] WEB_CONCURRENCY="${env.WEB_CONCURRENCY}" is not a positive integer or "auto" — running 1 process.` };
  if (asked > 1 && !env.REDIS_URL) {
    return {
      workers: 1,
      warning: `[cluster] WEB_CONCURRENCY=${asked} needs REDIS_URL (shared rate limits, cache, socket.io rooms, queues). Without it each worker would keep its own — running 1 process instead.`,
    };
  }
  return { workers: asked, warning: null };
}

/** Pure: env overrides for the worker in `slot` (1-based). Slot 1 keeps the operator's flags. */
function workerEnv(slot) {
  const env = { WORKER_SLOT: String(slot) };
  if (slot > 1) Object.assign(env, { ENABLE_SCHEDULER: 'false', ENABLE_SYNTHETIC: 'false' });
  return env;
}

/** Removes the singleton starters from bootstrap's STARTERS array in place (slots 2..N). */
function dropSingletons(starters) {
  for (let i = starters.length - 1; i >= 0; i--) if (SINGLETON_STARTERS.includes(starters[i][0])) starters.splice(i, 1);
  return starters;
}

/** Pure: restart delay after `fails` quick crashes in a row: 1s, 2s, 4s … capped at 30s. */
const backoffMs = (fails) => Math.min(30_000, 1000 * 2 ** Math.max(0, fails - 1));

const STABLE_MS = 60_000; // a worker that lived this long resets its crash count

function runPrimary(n) {
  const cluster = require('node:cluster');
  const deadline = (Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10_000) + 5_000;
  const slotOf = new Map(); // worker.id → slot
  const startedAt = {};
  const fails = {};
  const restarts = {}; // slot → restarts since the primary started (shown on the Workers page)
  const lastExit = {};
  let stopping = false;

  const fork = (slot) => {
    const w = cluster.fork({ ...workerEnv(slot), WORKER_RESTARTS: String(restarts[slot] || 0), WORKER_LAST_EXIT: lastExit[slot] || '' });
    slotOf.set(w.id, slot);
    startedAt[slot] = Date.now();
  };
  const alive = () => Object.values(cluster.workers || {}).filter((w) => w && !w.isDead());

  cluster.on('exit', (w, code, signal) => {
    const slot = slotOf.get(w.id);
    slotOf.delete(w.id);
    if (stopping) {
      if (code) process.exitCode = 1;
      if (!alive().length) process.exit();
      return;
    }
    fails[slot] = Date.now() - startedAt[slot] > STABLE_MS ? 1 : (fails[slot] || 0) + 1;
    restarts[slot] = (restarts[slot] || 0) + 1;
    lastExit[slot] = `${new Date().toISOString()} ${signal || `code ${code}`}`;
    const delay = backoffMs(fails[slot]);
    console.error(`[cluster] worker ${slot} (pid ${w.process.pid}) exited (${signal || `code ${code}`}) — restarting in ${delay / 1000}s`);
    setTimeout(() => !stopping && fork(slot), delay);
  });

  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`[cluster] ${signal}: draining ${alive().length} workers…`);
    // A message, not a signal: on Windows process.kill('SIGTERM') kills without running handlers.
    for (const w of alive()) {
      try {
        if (w.isConnected()) w.send(SHUTDOWN_MSG);
      } catch {
        /* already gone */
      }
    }
    setTimeout(() => {
      console.error('[cluster] shutdown deadline reached — killing workers');
      for (const w of alive()) w.process.kill('SIGKILL');
      process.exit(1);
    }, deadline).unref();
    if (!alive().length) process.exit();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  console.log(`[cluster] primary ${process.pid}: starting ${n} API workers (slot 1 runs the scheduler and other singletons)`);
  for (let slot = 1; slot <= n; slot++) fork(slot);
}

/**
 * Pure: this process's slot ("1" runs the singletons), or null outside a cluster. Our own primary
 * sets WORKER_SLOT. Under `pm2 -i N` (pm2 cluster mode) every instance is a cluster worker with
 * pm2's 0-based NODE_APP_INSTANCE instead: without this, all N ran the scheduler. pm2 fork mode
 * (isWorker false) also sets NODE_APP_INSTANCE and stays a single process.
 */
function slotFrom(env = process.env, isWorker = require('node:cluster').isWorker) {
  if (!isWorker) return null;
  if (env.WORKER_SLOT) return String(env.WORKER_SLOT);
  const n = Number(env.NODE_APP_INSTANCE);
  return env.NODE_APP_INSTANCE !== undefined && Number.isInteger(n) && n >= 0 ? String(n + 1) : null;
}

/**
 * Pure: why worker `slot` must not start, or null. plan() refuses a cluster without REDIS_URL,
 * but pm2 cluster mode (-i N) forks around it: each worker then had its own in-memory socket
 * adapter, so a logout on one worker left that user's sockets on the others connected.
 * Slot 1 still runs, so the API stays up as one process.
 */
function workerRefusal(slot, env = process.env) {
  if (!slot || slot === '1' || env.REDIS_URL) return null;
  return `[cluster] worker slot ${slot} needs REDIS_URL (shared socket.io rooms, rate limits, cache). Run one instance or set REDIS_URL.`;
}

/** Worker side: ask bootstrap's own SIGTERM handler to drain when the primary says so. */
function onShutdownMessage(msg) {
  if (msg !== SHUTDOWN_MSG) return;
  if (process.listenerCount('SIGTERM')) process.emit('SIGTERM', 'SIGTERM');
  else process.exit(0); // still booting: nothing to drain
}

module.exports = { SINGLETON_STARTERS, PER_WORKER_STARTERS, SHUTDOWN_MSG, plan, workerEnv, dropSingletons, backoffMs, slotFrom, workerRefusal, runPrimary, onShutdownMessage };
