// Jobblo API entry point. Everything that starts the server lives in bootstrap/:
// env, MongoDB, the Express app (app.js), socket.io, background jobs and graceful shutdown.
// WEB_CONCURRENCY>1 (with REDIS_URL) runs one API worker per core instead — see cluster.js.
const cluster = require('node:cluster');
require('./config/env');
const multi = require('./cluster');

if (cluster.isPrimary) {
  const { workers, warning } = multi.plan();
  if (warning) console.error(`❌  ${warning}`);
  if (workers > 1) return multi.runPrimary(workers);
}

// Our own workers (WORKER_SLOT) or pm2 cluster-mode instances (NODE_APP_INSTANCE): slot 1 keeps
// the singletons (scheduler, alerts, probes…), the others drop them. See cluster.slotFrom.
const slot = multi.slotFrom(process.env, cluster.isWorker);
const refusal = multi.workerRefusal(slot);
if (refusal) {
  console.error(`❌  ${refusal}`);
  process.exit(1);
}
if (slot) {
  if (process.env.WORKER_SLOT) process.on('message', multi.onShutdownMessage); // our primary's drain message
  if (slot !== '1') {
    Object.assign(process.env, multi.workerEnv(Number(slot))); // ENABLE_SCHEDULER=false etc., as our primary sets them
    multi.dropSingletons(require('./bootstrap/background').STARTERS);
  }
}

require('./bootstrap')
  .start()
  .then(({ io }) => {
    // Heartbeat for the developer console's Workers page (every process, cluster or not).
    require('./services/monitoring/workers').startWorkerHeartbeat();
    // See cluster.js: a polling session would be split across workers.
    if (slot) io.engine.opts.transports = ['websocket'];
  })
  .catch((err) => {
    console.error('❌  Failed to start:', err);
    process.exit(1);
  });
