/**
 * Read models for the Security Intelligence pages (controllers/developer/securityIntelController):
 * overview, installations, events, alerts, analytics, one IP. Every list is bounded and paged;
 * every query runs on an index of the collection it reads. Emails are always masked.
 */
const mongoose = require('mongoose');
const { bucketExpr, rx, isId, countBy } = require('../../utils/devQuery');
const { buildPagination } = require('../../utils/apiResponse');
const { maskEmail } = require('../monitoring/securityEvents');
const { labelFor } = require('./deviceId');
const { scoreAlerts, RECOMMENDATION, LIVE } = require('./risk/score');
const { getConfig } = require('./risk/config');

const MASKED = ['vpn_proxy', 'tor'];
const DAY = 24 * 60 * 60 * 1000;

const M = () => ({
  DeviceInstallation: require('../../models/DeviceInstallation'),
  DeviceObservation: require('../../models/DeviceObservation'),
  SecurityEvent: require('../../models/SecurityEvent'),
  SecurityAlert: require('../../models/SecurityAlert'),
  Session: require('../../models/Session'),
  User: require('../../models/User'),
  FraudCase: require('../../models/FraudCase'),
});

const oid = (v) => new mongoose.Types.ObjectId(String(v));

/** Accounts by id, as { _id, name, email (masked), role }. */
async function usersById(ids) {
  const unique = [...new Set((ids || []).map(String))].filter(isId);
  if (!unique.length) return {};
  const users = await M()
    .User.find({ _id: { $in: unique } })
    .select('name lastName email role avatarUrl isDeleted')
    .lean();
  return Object.fromEntries(
    users.map((u) => [
      String(u._id),
      {
        _id: String(u._id),
        name: [u.name, u.lastName].filter(Boolean).join(' ') || null,
        email: maskEmail(u.email),
        role: u.role,
        avatarUrl: u.avatarUrl || null,
        deleted: Boolean(u.isDeleted),
      },
    ])
  );
}

/** "DEV-7842", a full key, or a key prefix → a deviceKey filter value. */
function deviceFilter(q) {
  const s = String(q || '')
    .trim()
    .toLowerCase();
  if (/^dev-[0-9a-f]{4}$/.test(s)) return { $regex: `^${s.slice(4)}` };
  if (/^[0-9a-f]{4,32}$/.test(s)) return s.length === 32 ? s : { $regex: `^${s}` };
  return null;
}

const alertRow = (a) => ({
  _id: String(a._id),
  ruleId: a.ruleId,
  title: a.title,
  summary: a.summary,
  severity: a.severity,
  confidence: a.confidence,
  status: a.status,
  deviceKey: a.deviceKey,
  device: labelFor(a.deviceKey),
  userIds: (a.userIds || []).map(String),
  ips: a.ips || [],
  count: a.count,
  firstSeen: a.firstSeen,
  lastSeen: a.lastSeen,
});

async function overview({ from, to, bucketMs }) {
  const m = M();
  const live = { status: { $in: LIVE } };
  const [
    bySeverity,
    openAlerts,
    recent,
    activeDevices,
    riskyDevices,
    maskedObs,
    multiIp,
    multiAccount,
    newIp,
    trendRows,
    byRule,
  ] = await Promise.all([
    m.SecurityAlert.aggregate([
      { $match: live },
      { $group: { _id: '$severity', n: { $sum: 1 } } },
    ]).then(countBy),
    m.SecurityAlert.countDocuments(live),
    m.SecurityAlert.find(live).sort({ lastSeen: -1 }).limit(10).lean(),
    m.DeviceInstallation.countDocuments({ lastSeen: { $gte: from } }),
    m.DeviceInstallation.find({ riskBand: { $in: ['high', 'critical'] } })
      .sort({ riskScore: -1 })
      .limit(10)
      .lean(),
    m.DeviceObservation.countDocuments({
      'network.class': { $in: MASKED },
      lastSeen: { $gte: from },
    }),
    m.SecurityAlert.countDocuments({ ...live, ruleId: 'A_MULTI_IP' }),
    m.SecurityAlert.countDocuments({ ...live, ruleId: 'C_MULTI_ACCOUNT' }),
    m.SecurityEvent.countDocuments({ type: 'device_new_ip', at: { $gte: from, $lte: to } }),
    m.SecurityAlert.aggregate([
      { $match: { firstSeen: { $gte: from, $lte: to } } },
      {
        $group: { _id: { t: bucketExpr('$firstSeen', bucketMs), s: '$severity' }, n: { $sum: 1 } },
      },
    ]),
    m.SecurityAlert.aggregate([
      { $match: live },
      { $group: { _id: '$ruleId', n: { $sum: 1 } } },
    ]).then(countBy),
  ]);
  const buckets = new Map();
  for (const r of trendRows) {
    const t = new Date(r._id.t).toISOString();
    const row = buckets.get(t) || { t, low: 0, medium: 0, high: 0, critical: 0 };
    row[r._id.s] = r.n;
    buckets.set(t, row);
  }
  return {
    range: { from, to, bucketMs },
    totals: {
      openAlerts,
      bySeverity,
      activeDevices,
      riskyDevices: riskyDevices.length,
      maskedObservations: maskedObs,
      multiIpDevices: multiIp,
      multiAccountDevices: multiAccount,
      newIpEvents: newIp,
    },
    byRule,
    trend: [...buckets.values()].sort((a, b) => a.t.localeCompare(b.t)),
    recentAlerts: recent.map(alertRow),
    riskyDevices: riskyDevices.map((d) => ({
      deviceKey: d.deviceKey,
      device: labelFor(d.deviceKey),
      platform: d.platform,
      uaFamily: d.uaFamily,
      riskScore: d.riskScore,
      riskBand: d.riskBand,
      accounts: (d.userIds || []).length,
      lastSeen: d.lastSeen,
    })),
  };
}

async function listDevices(query, { page, limit, skip }) {
  const m = M();
  const filter = {};
  const q = String(query.q || '').trim();
  if (q) {
    const key = deviceFilter(q);
    if (key) filter.deviceKey = key;
    else if (isId(q)) filter.userIds = oid(q);
    else {
      const keys = await m.DeviceObservation.distinct('deviceKey', { ip: q });
      filter.deviceKey = { $in: keys.slice(0, 500) };
    }
  }
  if (['low', 'medium', 'high', 'critical'].includes(query.band)) filter.riskBand = query.band;
  if (['web', 'app'].includes(query.platform)) filter.platform = query.platform;
  if (query.multiAccount === 'true') filter['userIds.1'] = { $exists: true };
  const [rows, total] = await Promise.all([
    m.DeviceInstallation.find(filter).sort({ lastSeen: -1 }).skip(skip).limit(limit).lean(),
    m.DeviceInstallation.countDocuments(filter),
  ]);
  const keys = rows.map((r) => r.deviceKey);
  const stats = keys.length
    ? await m.DeviceObservation.aggregate([
        { $match: { deviceKey: { $in: keys } } },
        {
          $group: {
            _id: '$deviceKey',
            ips: { $sum: 1 },
            masked: { $sum: { $cond: [{ $in: ['$network.class', MASKED] }, 1, 0] } },
            countries: { $addToSet: '$network.countryCode' },
          },
        },
      ])
    : [];
  const byKey = Object.fromEntries(stats.map((s) => [s._id, s]));
  return {
    rows: rows.map((d) => ({
      deviceKey: d.deviceKey,
      device: labelFor(d.deviceKey),
      platform: d.platform,
      uaFamily: d.uaFamily,
      accounts: (d.userIds || []).length,
      ips: byKey[d.deviceKey]?.ips || 0,
      maskedIps: byKey[d.deviceKey]?.masked || 0,
      countries: (byKey[d.deviceKey]?.countries || []).filter(Boolean),
      riskScore: d.riskScore,
      riskBand: d.riskBand,
      firstSeen: d.firstSeen,
      lastSeen: d.lastSeen,
    })),
    pagination: buildPagination(total, page, limit),
  };
}

async function deviceDetail(deviceKey) {
  const m = M();
  const device = await m.DeviceInstallation.findOne({ deviceKey }).lean();
  if (!device) return null;
  const [observations, alerts, events, sessions, config] = await Promise.all([
    m.DeviceObservation.find({ deviceKey }).sort({ lastSeen: -1 }).limit(300).lean(),
    m.SecurityAlert.find({ deviceKey }).sort({ lastSeen: -1 }).limit(100).lean(),
    m.SecurityEvent.find({ deviceKey, at: { $gte: new Date(Date.now() - 30 * DAY) } })
      .sort({ at: -1 })
      .limit(200)
      .select('at type ip route status code userId')
      .lean(),
    m.Session.find({ deviceKey })
      .sort({ lastUsed: -1 })
      .limit(50)
      .select('userId ip location device browser os deviceName lastUsed createdAt expiresAt')
      .lean(),
    getConfig(),
  ]);
  const ids = [
    ...(device.userIds || []),
    ...observations.map((o) => o.userId),
    ...sessions.map((s) => s.userId),
  ];
  const users = await usersById(ids);
  const score = scoreAlerts(alerts, config.bands);
  return {
    device: {
      deviceKey,
      device: labelFor(deviceKey),
      platform: device.platform,
      uaFamily: device.uaFamily,
      firstSeen: device.firstSeen,
      lastSeen: device.lastSeen,
      riskScore: device.riskScore,
      riskBand: device.riskBand,
      // An installation, not a physical device: say how sure the grouping is.
      identity:
        device.platform === 'web'
          ? 'Browser installation (signed cookie). Cleared cookies or another browser = another installation.'
          : 'App installation (id made by the app). Reinstalling = another installation.',
    },
    score: { ...score, recommendation: RECOMMENDATION[score.band] },
    accounts: (device.userIds || []).map((id) => users[String(id)] || { _id: String(id) }),
    observations: observations.map((o) => ({
      ip: o.ip,
      ipPrefix: o.ipPrefix,
      userId: o.userId ? String(o.userId) : null,
      firstSeen: o.firstSeen,
      lastSeen: o.lastSeen,
      hits: o.hits,
      events: o.events || {},
      network: o.network || null,
    })),
    alerts: alerts.map(alertRow),
    events,
    sessions: sessions.map((s) => ({ ...s, _id: String(s._id), userId: String(s.userId) })),
    users,
  };
}

const EVENT_TYPES = [
  'login_failed',
  'rate_limited',
  'ip_blocked',
  'permission_denied',
  'unauthenticated',
  'token_expired',
  'token_invalid',
  'session_revoked',
  'otp_failed',
  'device_new_ip',
  'device_new_account',
];

async function listEvents(query, { from, to }, { page, limit, skip }) {
  const m = M();
  const filter = { at: { $gte: from, $lte: to } };
  if (EVENT_TYPES.includes(query.type)) filter.type = query.type;
  if (query.ip) filter.ip = String(query.ip).slice(0, 64);
  if (query.userId && isId(query.userId)) filter.userId = oid(query.userId);
  const key = query.device ? deviceFilter(query.device) : null;
  if (key) filter.deviceKey = key;
  if (query.route) filter.route = rx(String(query.route).slice(0, 100));
  const [rows, total, byType] = await Promise.all([
    m.SecurityEvent.find(filter)
      .sort({ at: -1 })
      .skip(skip)
      .limit(limit)
      .select('at type ip method route status code userId email deviceKey')
      .lean(),
    m.SecurityEvent.countDocuments(filter),
    m.SecurityEvent.aggregate([
      { $match: { at: { $gte: from, $lte: to } } },
      { $group: { _id: '$type', n: { $sum: 1 } } },
    ]).then(countBy),
  ]);
  return {
    types: EVENT_TYPES,
    byType,
    rows: rows.map((e) => ({ ...e, _id: String(e._id), device: labelFor(e.deviceKey) })),
    pagination: buildPagination(total, page, limit),
  };
}

const RULE_IDS = [
  'A_MULTI_IP',
  'B_VPN_TRANSITION',
  'C_MULTI_ACCOUNT',
  'D_LOGIN_ABUSE',
  'E_REQUEST_ABUSE',
  'F_SENSITIVE_OPS',
];
const STATUSES = ['open', 'investigating', 'resolved', 'false_positive', 'escalated'];

async function listAlerts(query, { page, limit, skip }) {
  const m = M();
  const filter = {};
  const status = String(query.status || 'live');
  if (status === 'live') filter.status = { $in: LIVE };
  else if (STATUSES.includes(status)) filter.status = status;
  if (['low', 'medium', 'high', 'critical'].includes(query.severity))
    filter.severity = query.severity;
  if (RULE_IDS.includes(query.rule)) filter.ruleId = query.rule;
  const key = query.device ? deviceFilter(query.device) : null;
  if (key) filter.deviceKey = key;
  if (query.userId && isId(query.userId)) filter.userIds = oid(query.userId);
  if (query.ip) filter.ips = String(query.ip).slice(0, 64);
  const [rows, total] = await Promise.all([
    m.SecurityAlert.find(filter).sort({ lastSeen: -1 }).skip(skip).limit(limit).lean(),
    m.SecurityAlert.countDocuments(filter),
  ]);
  return {
    rules: RULE_IDS,
    statuses: STATUSES,
    rows: rows.map(alertRow),
    pagination: buildPagination(total, page, limit),
  };
}

async function alertDetail(id) {
  if (!isId(id)) return null;
  const m = M();
  const alert = await m.SecurityAlert.findById(id).lean();
  if (!alert) return null;
  const [device, siblings, cases] = await Promise.all([
    alert.deviceKey ? m.DeviceInstallation.findOne({ deviceKey: alert.deviceKey }).lean() : null,
    alert.deviceKey
      ? m.SecurityAlert.find({ deviceKey: alert.deviceKey, _id: { $ne: alert._id } })
          .sort({ lastSeen: -1 })
          .limit(20)
          .lean()
      : [],
    m.FraudCase.find({ userId: { $in: alert.userIds || [] } })
      .select('userId status reviewedAt')
      .lean(),
  ]);
  const users = await usersById([
    ...(alert.userIds || []),
    ...(alert.notes || []).map((n) => n.by).filter(Boolean),
  ]);
  return {
    alert: {
      ...alertRow(alert),
      weight: alert.weight,
      evidence: alert.evidence || [],
      notes: (alert.notes || []).map((n) => ({ ...n, by: n.by ? String(n.by) : null })),
      closedAt: alert.closedAt,
    },
    device: device
      ? {
          deviceKey: device.deviceKey,
          device: labelFor(device.deviceKey),
          platform: device.platform,
          uaFamily: device.uaFamily,
          riskScore: device.riskScore,
          riskBand: device.riskBand,
        }
      : null,
    recommendation: RECOMMENDATION[device?.riskBand || 'low'],
    siblings: siblings.map(alertRow),
    fraudCases: cases.map((c) => ({
      userId: String(c.userId),
      status: c.status,
      reviewedAt: c.reviewedAt,
    })),
    users,
  };
}

const CLOSED = ['resolved', 'false_positive'];

/** A developer's decision on an alert. Returns the new status, or an error string. */
async function updateAlert(id, { status, note }, userId) {
  if (!isId(id)) return { error: 'Alert not found.', code: 404 };
  if (!['open', 'investigating', ...CLOSED].includes(status))
    return { error: 'Invalid status.', code: 400 };
  const text = note ? String(note).trim().slice(0, 1000) : '';
  if (CLOSED.includes(status) && text.length < 5)
    return { error: 'Explain the decision in a note (at least 5 characters).', code: 400 };
  const now = new Date();
  const res = await M()
    .SecurityAlert.findByIdAndUpdate(
      id,
      {
        $set: { status, closedAt: CLOSED.includes(status) ? now : null },
        $push: { notes: { at: now, by: userId, text: text || `Marked ${status}.`, status } },
      },
      { new: true }
    )
    .lean();
  if (!res) return { error: 'Alert not found.', code: 404 };
  return { alert: alertRow(res) };
}

/** Hand the alert's accounts to a fraud case (one per account) and mark it escalated. */
async function escalateAlert(id, note, userId) {
  if (!isId(id)) return { error: 'Alert not found.', code: 404 };
  const text = String(note || '')
    .trim()
    .slice(0, 1000);
  if (text.length < 5)
    return { error: 'Explain why in a note (at least 5 characters).', code: 400 };
  const m = M();
  const alert = await m.SecurityAlert.findById(id).lean();
  if (!alert) return { error: 'Alert not found.', code: 404 };
  if (!(alert.userIds || []).length)
    return { error: 'This alert has no accounts to escalate. Block the IP instead.', code: 400 };
  const now = new Date();
  const caseNote = `Security alert ${alert.ruleId} (${labelFor(alert.deviceKey)}): ${text}`.slice(
    0,
    1000
  );
  for (const u of alert.userIds) {
    await m.FraudCase.updateOne(
      { userId: u },
      {
        $set: { status: 'investigating', note: caseNote, reviewedBy: userId, reviewedAt: now },
        $push: {
          history: { at: now, by: userId, status: 'investigating', note: caseNote, score: null },
        },
      },
      { upsert: true }
    );
  }
  const res = await m.SecurityAlert.findByIdAndUpdate(
    id,
    {
      $set: { status: 'escalated' },
      $push: { notes: { at: now, by: userId, text: `Escalated: ${text}`, status: 'escalated' } },
    },
    { new: true }
  ).lean();
  return { alert: alertRow(res), cases: alert.userIds.map(String) };
}

async function analytics({ from, to, bucketMs }) {
  const m = M();
  const bucketed = (Model, field, match, groupField) =>
    Model.aggregate([
      { $match: { ...match, [field]: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { t: bucketExpr(`$${field}`, bucketMs), k: `$${groupField}` },
          n: { $sum: 1 },
        },
      },
    ]);
  const [alertRows, eventRows, maskedRows, byRule, closed] = await Promise.all([
    bucketed(m.SecurityAlert, 'firstSeen', {}, 'severity'),
    bucketed(
      m.SecurityEvent,
      'at',
      {
        type: {
          $in: [
            'login_failed',
            'rate_limited',
            'otp_failed',
            'device_new_ip',
            'device_new_account',
          ],
        },
      },
      'type'
    ),
    bucketed(
      m.DeviceObservation,
      'firstSeen',
      { 'network.class': { $in: MASKED } },
      'network.class'
    ),
    m.SecurityAlert.aggregate([
      { $match: { firstSeen: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: '$ruleId',
          n: { $sum: 1 },
          falsePositive: { $sum: { $cond: [{ $eq: ['$status', 'false_positive'] }, 1, 0] } },
        },
      },
    ]),
    m.SecurityAlert.find({ closedAt: { $gte: from, $lte: to } })
      .select('firstSeen closedAt status')
      .limit(5000)
      .lean(),
  ]);
  const series = (rows, keys) => {
    const map = new Map();
    for (const r of rows) {
      const t = new Date(r._id.t).toISOString();
      const row = map.get(t) || { t, ...Object.fromEntries(keys.map((k) => [k, 0])) };
      if (r._id.k in row) row[r._id.k] = r.n;
      map.set(t, row);
    }
    return [...map.values()].sort((a, b) => a.t.localeCompare(b.t));
  };
  const hours = closed
    .map((a) => (new Date(a.closedAt) - new Date(a.firstSeen)) / 3600000)
    .filter((h) => h >= 0)
    .sort((a, b) => a - b);
  const median = hours.length ? hours[Math.floor(hours.length / 2)] : null;
  return {
    range: { from, to, bucketMs },
    alerts: series(alertRows, ['low', 'medium', 'high', 'critical']),
    events: series(eventRows, [
      'login_failed',
      'rate_limited',
      'otp_failed',
      'device_new_ip',
      'device_new_account',
    ]),
    masked: series(maskedRows, ['vpn_proxy', 'tor']),
    byRule: byRule
      .map((r) => ({ ruleId: r._id, n: r.n, falsePositive: r.falsePositive }))
      .sort((a, b) => b.n - a.n),
    resolution: {
      closed: closed.length,
      falsePositive: closed.filter((a) => a.status === 'false_positive').length,
      medianHours: median == null ? null : Math.round(median * 10) / 10,
    },
  };
}

/** What the security layer knows about one IP: its classification and installations. */
async function ipIntel(ip) {
  const m = M();
  const value = String(ip || '').slice(0, 64);
  const [observations, alerts] = await Promise.all([
    m.DeviceObservation.find({ ip: value }).sort({ lastSeen: -1 }).limit(100).lean(),
    m.SecurityAlert.find({ ips: value }).sort({ lastSeen: -1 }).limit(20).lean(),
  ]);
  const network =
    observations.find((o) => o.network?.checkedAt)?.network ||
    (await require('./ipIntel').classify(value));
  const keys = [...new Set(observations.map((o) => o.deviceKey))];
  const devices = keys.length
    ? await m.DeviceInstallation.find({ deviceKey: { $in: keys } }).lean()
    : [];
  const byKey = Object.fromEntries(devices.map((d) => [d.deviceKey, d]));
  return {
    ip: value,
    network,
    devices: keys.map((k) => {
      const o = observations.find((x) => x.deviceKey === k);
      const d = byKey[k] || {};
      return {
        deviceKey: k,
        device: labelFor(k),
        platform: d.platform || null,
        uaFamily: d.uaFamily || null,
        accounts: (d.userIds || []).length,
        riskBand: d.riskBand || null,
        hits: o.hits,
        firstSeen: o.firstSeen,
        lastSeen: o.lastSeen,
      };
    }),
    alerts: alerts.map(alertRow),
  };
}

module.exports = {
  overview,
  listDevices,
  deviceDetail,
  listEvents,
  listAlerts,
  alertDetail,
  updateAlert,
  escalateAlert,
  analytics,
  ipIntel,
  deviceFilter,
  RULE_IDS,
  EVENT_TYPES,
};
