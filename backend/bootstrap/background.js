/**
 * Everything that runs in the background once the server listens: lifecycle automation
 * (scheduler), queue workers, metric flushes and monitors. Each starter is isolated so one
 * failing to start never stops the others or the API.
 *
 * ENABLE_SCHEDULER=false keeps an extra instance from running scheduled jobs; with REDIS_URL
 * the jobs are distributed through the queue anyway, so every instance can stay enabled.
 */
const STARTERS = [
  ['scheduler', () => require('../services/scheduler').startScheduler()],
  ['queue workers', () => require('../services/queue').startWorkers()],
  ['request metrics', () => require('../middleware/requestMetrics').startMetricsFlush()],
  ['external calls', () => require('../services/monitoring/externalCalls').startExternalFlush()],
  ['security events', () => require('../services/monitoring/securityEvents').startSecurityFlush()],
  ['apm', () => require('../services/monitoring/apm').startApm(require('mongoose'))],
  ['alerts', () => require('../services/monitoring/alerts').startAlerts()],
  ['ip blocks', () => require('../services/monitoring/ipBlocks').startIpBlocks()],
  ['synthetic probes', () => require('../services/monitoring/synthetic').startSynthetic()],
  ['deployment record', () => require('../services/monitoring/deployments').recordBoot()],
  ['capacity', () => require('../services/monitoring/capacity').startCapacity()],
  ['config drift', () => require('../services/monitoring/configDrift').recordBoot()],
  ['failure simulator', () => require('../services/monitoring/faults').startFaults()],
  ['api contracts', () => require('../services/monitoring/contracts').startContracts()],
  ['view counts', () => require('../utils/viewCounter').startViewFlush()],
];

function startBackground(starters = STARTERS) {
  const failed = [];
  const stops = []; // [name, fn] for registerShutdown's `extra`: starters that hand back { stop }
  for (const [name, start] of starters) {
    try {
      const r = start();
      if (r && typeof r.stop === 'function') stops.push([name, () => r.stop()]);
      if (r && typeof r.catch === 'function') r.catch((err) => console.error(`[bootstrap] ${name} failed:`, err.message));
    } catch (err) {
      failed.push(name);
      console.error(`[bootstrap] ${name} failed to start:`, err.message);
    }
  }
  return { started: starters.length - failed.length, failed, stops };
}

module.exports = { STARTERS, startBackground };
