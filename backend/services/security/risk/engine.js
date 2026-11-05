/**
 * Runs the risk rules for one installation and keeps the result:
 *   loadContext (3 indexed queries) → rules (pure) → SecurityAlert upserts (deduped) → score
 *   on the DeviceInstallation.
 *
 * Triggered from the security queue (after observations are written and after an IP is
 * classified) and by the 15-minute sweep. Idempotent: running it twice on the same data changes
 * nothing but timestamps.
 *
 * Dedupe: one alert per rule and installation. Firing again moves lastSeen, raises the count
 * when there is newer evidence, keeps the highest severity. Resolved → reopened ("seen again").
 * False positive → stays closed; only lastSeen moves, so a developer's decision is not undone.
 */
const RULES = require('./rules');
const { getConfig } = require('./config');
const { scoreAlerts, maxSeverity } = require('./score');

const DAY = 24 * 60 * 60 * 1000;
const MAX_OBSERVATIONS = 300;
const MAX_EVENTS = 1000;

const models = (deps = {}) => ({
  DeviceInstallation: deps.DeviceInstallation || require('../../../models/DeviceInstallation'),
  DeviceObservation: deps.DeviceObservation || require('../../../models/DeviceObservation'),
  SecurityEvent: deps.SecurityEvent || require('../../../models/SecurityEvent'),
  SecurityAlert: deps.SecurityAlert || require('../../../models/SecurityAlert'),
});

async function loadContext(deviceKey, m, now = Date.now()) {
  const [device, observations, securityEvents] = await Promise.all([
    m.DeviceInstallation.findOne({ deviceKey }).lean(),
    m.DeviceObservation.find({ deviceKey, lastSeen: { $gte: new Date(now - 30 * DAY) } })
      .sort({ lastSeen: -1 })
      .limit(MAX_OBSERVATIONS)
      .lean(),
    m.SecurityEvent.find({
      deviceKey,
      at: { $gte: new Date(now - DAY) },
      type: { $in: ['login_failed', 'rate_limited'] },
    })
      .sort({ at: -1 })
      .limit(MAX_EVENTS)
      .lean(),
  ]);
  return { deviceKey, device, observations, securityEvents, now };
}

/** Pure: rules over a context. */
function runRules(ctx, config) {
  const hits = [];
  for (const rule of RULES) {
    try {
      for (const hit of rule.evaluate(ctx, config[rule.config])) hits.push(hit);
    } catch (err) {
      console.error(`[risk] rule ${rule.id} failed:`, err.message);
    }
  }
  return hits;
}

/**
 * Two workers evaluating one installation at once can both find no alert and both insert; the
 * unique dedupeKey lets one win and the other gets E11000. That one runs again and, finding the
 * alert now, updates it.
 */
async function upsertAlert(hit, deviceKey, m, now) {
  try {
    return await upsertAlertOnce(hit, deviceKey, m, now);
  } catch (err) {
    if (err?.code !== 11000) throw err;
    return upsertAlertOnce(hit, deviceKey, m, now);
  }
}

async function upsertAlertOnce(hit, deviceKey, m, now) {
  const dedupeKey = `${hit.ruleId}|${deviceKey}`;
  const existing = await m.SecurityAlert.findOne({ dedupeKey }).lean();
  const fields = {
    title: hit.title,
    summary: hit.summary,
    confidence: hit.confidence,
    weight: hit.weight,
    ips: hit.ips,
    userIds: hit.userIds,
    evidence: hit.evidence,
  };
  if (!existing) {
    await m.SecurityAlert.updateOne(
      { dedupeKey },
      {
        $setOnInsert: {
          dedupeKey,
          ruleId: hit.ruleId,
          deviceKey,
          firstSeen: hit.firstSeen,
          status: 'open',
          count: 1,
        },
        $set: { ...fields, severity: hit.severity, lastSeen: hit.lastSeen },
      },
      { upsert: true }
    );
    return 'opened';
  }
  const newer = new Date(hit.lastSeen).getTime() > new Date(existing.lastSeen).getTime();
  const update = {
    $set: {
      ...fields,
      severity: maxSeverity(existing.severity, hit.severity),
      lastSeen: newer ? hit.lastSeen : existing.lastSeen,
    },
  };
  if (newer) update.$inc = { count: 1 };
  if (existing.status === 'false_positive') {
    // A developer's decision stands: keep it closed, only note that it keeps happening.
    await m.SecurityAlert.updateOne({ dedupeKey }, { $set: { lastSeen: update.$set.lastSeen } });
    return 'suppressed';
  }
  if (existing.status === 'resolved' && newer) {
    update.$set.status = 'open';
    update.$set.closedAt = null;
    update.$push = {
      notes: {
        at: new Date(now),
        by: null,
        text: 'Seen again after it was resolved.',
        status: 'open',
      },
    };
    await m.SecurityAlert.updateOne({ dedupeKey }, update);
    return 'reopened';
  }
  await m.SecurityAlert.updateOne({ dedupeKey }, update);
  return newer ? 'updated' : 'unchanged';
}

/** Evaluate one installation. Returns what happened, for the queue log and tests. */
async function evaluateDevice(deviceKey, deps = {}) {
  if (!deviceKey) return { skipped: 'no device' };
  const m = models(deps);
  const now = deps.now || Date.now();
  const config = deps.config || (await getConfig());
  const ctx = await loadContext(deviceKey, m, now);
  if (!ctx.device) return { skipped: 'unknown device' };
  const hits = runRules(ctx, config);
  const outcomes = {};
  for (const hit of hits) {
    const r = await upsertAlert(hit, deviceKey, m, now);
    outcomes[hit.ruleId] = r;
  }
  const alerts = await m.SecurityAlert.find({ deviceKey })
    .select('ruleId weight confidence severity status')
    .lean();
  const { score, band } = scoreAlerts(alerts, config.bands);
  await m.DeviceInstallation.updateOne(
    { deviceKey },
    { $set: { riskScore: score, riskBand: band } }
  );
  return { deviceKey, hits: hits.length, outcomes, score, band };
}

/** Installations active in the last `minutes`: the sweep's work list (bounded). */
async function recentDevices(minutes, deps = {}) {
  const m = models(deps);
  const since = new Date(Date.now() - minutes * 60 * 1000);
  const [fromObs, fromEvents] = await Promise.all([
    m.DeviceObservation.distinct('deviceKey', { lastSeen: { $gte: since } }),
    m.SecurityEvent.distinct('deviceKey', { at: { $gte: since }, deviceKey: { $type: 'string' } }),
  ]);
  return [...new Set([...fromObs, ...fromEvents])].filter(Boolean).slice(0, 2000);
}

/**
 * Re-evaluate every installation active in the last 20 minutes (scheduler, every 15).
 * ponytail: sequential and capped at 2000 installations per run; beyond that, shard by key
 * prefix across runs or move to per-device queue jobs only.
 */
async function sweep(deps = {}) {
  const keys = await recentDevices(20, deps);
  let alerts = 0;
  for (const key of keys) {
    try {
      const r = await evaluateDevice(key, deps);
      alerts += r.hits || 0;
    } catch (err) {
      console.error('[risk] sweep failed for one installation:', err.message);
    }
  }
  return { devices: keys.length, hits: alerts };
}

module.exports = { loadContext, runRules, upsertAlert, evaluateDevice, recentDevices, sweep };
