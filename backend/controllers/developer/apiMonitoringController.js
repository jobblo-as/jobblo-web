const { sendSuccess, sendError, asyncHandler } = require('../../utils/apiResponse');
const { liveSnapshot } = require('../../middleware/requestMetrics');
const ErrorLog = require('../../models/ErrorLog');
const ApiMetricMinute = require('../../models/ApiMetricMinute');
const { parseRange, bucketExpr, escapeRegex } = require('../../utils/devQuery');
const { apiTotals } = require('../../services/monitoring/summaries');

/** Developer console — API monitoring (per-route traffic, latency, clients, traces). Read-only unless noted; no exec, no arbitrary queries, no secrets. */

// ── 2. API monitoring ───────────────────────────────────────────────────────
const getApiMetrics = asyncHandler(async (req, res) => {
  const { from, to, bucketMs } = parseRange(req.query);
  const match = { minute: { $gte: from, $lte: to } };
  if (req.query.method) match.method = String(req.query.method).toUpperCase();
  if (req.query.q) match.route = { $regex: escapeRegex(req.query.q), $options: 'i' };
  const seconds = (to - from) / 1000;

  const [endpoints, series, totals] = await Promise.all([
    ApiMetricMinute.aggregate([
      { $match: match },
      {
        $group: {
          _id: { method: '$method', route: '$route' },
          count: { $sum: '$count' },
          failed: { $sum: '$failed' },
          durSum: { $sum: '$durSum' },
          durMax: { $max: '$durMax' },
          p50w: { $sum: { $multiply: ['$p50', '$count'] } },
          p95w: { $sum: { $multiply: ['$p95', '$count'] } },
          p99w: { $sum: { $multiply: ['$p99', '$count'] } },
          c400: { $sum: '$c400' },
          c401: { $sum: '$c401' },
          c403: { $sum: '$c403' },
          c404: { $sum: '$c404' },
          c429: { $sum: '$c429' },
          c500: { $sum: '$c500' },
          c5xx: { $sum: '$c5xx' },
          lastSeen: { $max: '$minute' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 500 },
    ]),
    ApiMetricMinute.aggregate([
      { $match: match },
      {
        $group: {
          _id: bucketExpr('$minute', bucketMs),
          requests: { $sum: '$count' },
          errors: { $sum: '$failed' },
          durSum: { $sum: '$durSum' },
          p95w: { $sum: { $multiply: ['$p95', '$count'] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    apiTotals(from, to),
  ]);

  const topClients = await ApiMetricMinute.aggregate([
    { $match: match },
    { $unwind: '$ips' },
    {
      $group: {
        _id: '$ips.ip',
        requests: { $sum: '$ips.n' },
        failed: { $sum: '$ips.failed' },
        routes: { $addToSet: { $concat: ['$method', ' ', '$route'] } },
        lastSeen: { $max: '$minute' },
      },
    },
    { $sort: { requests: -1 } },
    { $limit: 25 },
  ]);

  return sendSuccess(res, {
    range: { from, to, bucketMs },
    totals: { ...totals, live: liveSnapshot() },
    clients: topClients.map((c) => ({
      ip: c._id,
      requests: c.requests,
      failed: c.failed,
      endpoints: c.routes.length,
      lastSeen: c.lastSeen,
    })),
    endpoints: endpoints.map((e) => ({
      method: e._id.method,
      route: e._id.route,
      count: e.count,
      failed: e.failed,
      successRate: Math.round((1 - e.c5xx / e.count) * 10000) / 100,
      avgMs: Math.round(e.durSum / e.count),
      p50: Math.round(e.p50w / e.count),
      p95: Math.round(e.p95w / e.count),
      p99: Math.round(e.p99w / e.count),
      maxMs: Math.round(e.durMax),
      rps: Math.round((e.count / seconds) * 10000) / 10000,
      codes: { 400: e.c400, 401: e.c401, 403: e.c403, 404: e.c404, 429: e.c429, 500: e.c500 },
      lastSeen: e.lastSeen,
    })),
    series: series.map((p) => ({
      t: p._id,
      requests: p.requests,
      errors: p.errors,
      avgMs: p.requests ? Math.round(p.durSum / p.requests) : 0,
      p95: p.requests ? Math.round(p.p95w / p.requests) : 0,
    })),
  });
});

/** Who calls one endpoint (top IPs), or what one IP calls (top endpoints + series). */
const maskEmail = (e) => require('../../services/monitoring/securityEvents').maskEmail(e);

/** A signed-in user as the IP sheet shows them: name, role, masked e-mail, id for the link. */
const accountOf = (u) => ({
  _id: u._id,
  name: [u.name, u.lastName].filter(Boolean).join(' ') || null,
  role: u.role || null,
  email: maskEmail(u.email),
});

const kindOf = (device) =>
  /Mobile/.test(device) ? 'mobile' : /Tablet/.test(device) ? 'tablet' : 'desktop';

const known = (v) => (v && !/^unknown$/i.test(v) ? v : null);
// The Jobblo app's requests: Expo Go, okhttp (Android), CFNetwork (iOS), Dalvik.
const APP_AGENT = /expo|okhttp|Dalvik|CFNetwork/i;

/** A session's device, as stored at sign-in (tokenUtils.createSession). */
const deviceOfSession = (s) => {
  const app = APP_AGENT.test(`${s.browser || ''} ${s.userAgent || ''}`);
  const model = s.deviceName || null; // the app's X-Device-Name, e.g. "iPhone 15 Pro"
  return {
    browser: app
      ? /expo\s?go/i.test(`${s.browser} ${s.userAgent}`)
        ? 'Expo Go'
        : 'Jobblo app'
      : known(s.browser),
    os: known(s.os),
    // express-useragent calls the app "Desktop"; a reported model or an app agent is a phone.
    kind:
      model || app
        ? kindOf(s.device || '') === 'tablet'
          ? 'tablet'
          : 'mobile'
        : kindOf(s.device || ''),
    model,
  };
};

/** A sign-in event's device, parsed from its user agent the same way sessions are. */
function deviceOfAgent(ua) {
  if (!ua) return null;
  const a = new (require('express-useragent').UserAgent)().parse(String(ua));
  const app = APP_AGENT.test(ua);
  return {
    browser: app ? 'Jobblo app' : a.browser && a.browser !== 'unknown' ? a.browser : null,
    os: a.os && a.os !== 'unknown' ? a.os : null,
    kind: a.isTablet ? 'tablet' : a.isMobile || app ? 'mobile' : 'desktop',
    model: null,
  };
}

/**
 * The devices seen on this IP (from open sessions and sign-in events) and the accounts that
 * used them. One row per browser + OS + model, with how often, when last and by whom.
 */
function devicesAndAccounts(sessions, auth) {
  const devices = new Map();
  const accounts = new Map();
  const add = (device, at, who, source) => {
    if (!device) return;
    const key = [device.browser, device.os, device.kind, device.model].join('|');
    const row = devices.get(key) || {
      ...device,
      seen: 0,
      lastSeen: at,
      accounts: new Set(),
      sources: new Set(),
    };
    row.seen += 1;
    if (at && (!row.lastSeen || new Date(at) > new Date(row.lastSeen))) row.lastSeen = at;
    if (who) row.accounts.add(who);
    row.sources.add(source);
    devices.set(key, row);
  };
  for (const s of sessions) {
    const at = s.lastUsed || s.createdAt;
    const who = s.userId ? String(s.userId._id) : null;
    add(deviceOfSession(s), at, s.userId ? maskEmail(s.userId.email) : null, 'session');
    if (who) {
      const acc = accounts.get(who) || { ...accountOf(s.userId), sessions: 0, lastSeen: at };
      acc.sessions += 1;
      if (new Date(at) > new Date(acc.lastSeen)) acc.lastSeen = at;
      accounts.set(who, acc);
    }
  }
  for (const a of auth) add(deviceOfAgent(a.userAgent), a.at, a.email || null, 'sign-in');
  return {
    devices: [...devices.values()]
      .map((d) => ({ ...d, accounts: [...d.accounts], sources: [...d.sources] }))
      .sort((x, y) => new Date(y.lastSeen) - new Date(x.lastSeen)),
    accounts: [...accounts.values()].sort((x, y) => new Date(y.lastSeen) - new Date(x.lastSeen)),
  };
}

const getApiClients = asyncHandler(async (req, res) => {
  const { from, to, bucketMs } = parseRange(req.query);
  const match = { minute: { $gte: from, $lte: to } };
  const ip = String(req.query.ip || '')
    .trim()
    .slice(0, 64);
  if (ip) {
    const [endpoints, series, security, auth, sessions, network] = await Promise.all([
      ApiMetricMinute.aggregate([
        { $match: { ...match, 'ips.ip': ip } },
        { $unwind: '$ips' },
        { $match: { 'ips.ip': ip } },
        {
          $group: {
            _id: { method: '$method', route: '$route' },
            requests: { $sum: '$ips.n' },
            failed: { $sum: '$ips.failed' },
            lastSeen: { $max: '$minute' },
          },
        },
        { $sort: { requests: -1 } },
        // ponytail: the IP page pages these lists in the browser; past these caps the oldest
        // / quietest rows are cut (server-side paging per list is the upgrade).
        { $limit: 200 },
      ]),
      ApiMetricMinute.aggregate([
        { $match: { ...match, 'ips.ip': ip } },
        { $unwind: '$ips' },
        { $match: { 'ips.ip': ip } },
        {
          $group: {
            _id: bucketExpr('$minute', bucketMs),
            requests: { $sum: '$ips.n' },
            failed: { $sum: '$ips.failed' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      require('../../models/SecurityEvent').aggregate([
        { $match: { ip, at: { $gte: from, $lte: to } } },
        { $group: { _id: '$type', n: { $sum: 1 } } },
      ]),
      // Sign-ins and password resets from this IP: what happened, for which (masked) email.
      require('../../models/AuthEvent')
        .find({ ip, at: { $gte: from, $lte: to } })
        .sort({ at: -1 })
        .limit(200)
        .select('-_id type email at userAgent')
        .lean(),
      // Signed-in sessions still open from this IP: who, on what device, MFA or not.
      require('../../models/Session')
        .find({ ip })
        .sort({ lastUsed: -1 })
        .limit(100)
        .populate('userId', 'name lastName email role')
        .select(
          'userId device deviceName browser os userAgent location lastUsed createdAt mfaVerifiedAt'
        )
        .lean(),
      require('../../services/monitoring/ipGeo').networkFor(ip),
    ]);
    const { devices, accounts } = devicesAndAccounts(sessions, auth);
    return sendSuccess(res, {
      ip,
      range: { from, to, bucketMs },
      endpoints: endpoints.map((e) => ({
        method: e._id.method,
        route: e._id.route,
        requests: e.requests,
        failed: e.failed,
        lastSeen: e.lastSeen,
      })),
      series: series.map((s) => ({ t: s._id, requests: s.requests, failed: s.failed })),
      security: Object.fromEntries(security.map((s) => [s._id, s.n])),
      // Each sign-in with its device, parsed as sessions are (the raw agent stays for detail).
      auth: auth.map((a) => ({ ...a, device: deviceOfAgent(a.userAgent) })),
      network,
      devices,
      accounts,
      sessions: sessions.map((x) => ({
        _id: x._id,
        user: x.userId ? accountOf(x.userId) : null,
        device: deviceOfSession(x),
        location: x.location || null,
        lastUsed: x.lastUsed || x.createdAt,
        createdAt: x.createdAt,
        mfaVerified: Boolean(x.mfaVerifiedAt),
      })),
    });
  }
  if (!req.query.route) return sendError(res, 'ip or route is required.', 400);
  const clients = await ApiMetricMinute.aggregate([
    {
      $match: {
        ...match,
        route: String(req.query.route),
        ...(req.query.method && { method: String(req.query.method).toUpperCase() }),
      },
    },
    { $unwind: '$ips' },
    {
      $group: {
        _id: '$ips.ip',
        requests: { $sum: '$ips.n' },
        failed: { $sum: '$ips.failed' },
        lastSeen: { $max: '$minute' },
      },
    },
    { $sort: { requests: -1 } },
    { $limit: 20 },
  ]);
  return sendSuccess(res, {
    clients: clients.map((c) => ({
      ip: c._id,
      requests: c.requests,
      failed: c.failed,
      lastSeen: c.lastSeen,
    })),
  });
});

/** Recent error traces for one endpoint (request IDs to correlate). */
const getApiTraces = asyncHandler(async (req, res) => {
  const { route, method } = req.query;
  if (!route) return sendError(res, 'route is required.', 400);
  const query = { route: { $regex: `^${escapeRegex(route).replace(/:[^/]+/g, '[^/]+')}$` } };
  if (method) query.httpMethod = String(method).toUpperCase();
  const traces = await ErrorLog.find(query)
    .sort({ createdAt: -1 })
    .limit(50)
    .select('referenceId requestId statusCode message httpMethod route createdAt severity')
    .lean();
  return sendSuccess(res, { traces });
});

module.exports = { getApiMetrics, getApiClients, getApiTraces, devicesAndAccounts };
