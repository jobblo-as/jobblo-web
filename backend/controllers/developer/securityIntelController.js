/**
 * Security Intelligence (developer dashboard): installations, IP intelligence, security events,
 * risk alerts and their investigation. Reads are open to every developer; writes (alert status,
 * escalation, thresholds) need 'operations' access (routes/developer.js) and are audited.
 */
const { sendSuccess, sendError, asyncHandler } = require('../../utils/apiResponse');
const { parseRange, pageParams, audit } = require('../../utils/devQuery');
const intel = require('../../services/security/intel');
const { getConfig, mergeConfig, CONFIG_KEY } = require('../../services/security/risk/config');

const page = (req) => pageParams(req.query, 100);

exports.getOverview = asyncHandler(async (req, res) =>
  sendSuccess(res, await intel.overview(parseRange(req.query)))
);

exports.getDevices = asyncHandler(async (req, res) => {
  const r = await intel.listDevices(req.query, page(req));
  return sendSuccess(res, { rows: r.rows }, 'OK', r.pagination);
});

exports.getDevice = asyncHandler(async (req, res) => {
  const key = String(req.params.key || '');
  if (!/^[0-9a-f]{32}$/.test(key)) return sendError(res, 'Installation not found.', 404);
  const data = await intel.deviceDetail(key);
  return data ? sendSuccess(res, data) : sendError(res, 'Installation not found.', 404);
});

exports.getEvents = asyncHandler(async (req, res) => {
  const r = await intel.listEvents(req.query, parseRange(req.query), page(req));
  return sendSuccess(res, { types: r.types, byType: r.byType, rows: r.rows }, 'OK', r.pagination);
});

exports.getAlerts = asyncHandler(async (req, res) => {
  const r = await intel.listAlerts(req.query, page(req));
  return sendSuccess(
    res,
    { rules: r.rules, statuses: r.statuses, rows: r.rows },
    'OK',
    r.pagination
  );
});

exports.getAlert = asyncHandler(async (req, res) => {
  const data = await intel.alertDetail(req.params.id);
  return data ? sendSuccess(res, data) : sendError(res, 'Alert not found.', 404);
});

exports.updateAlert = asyncHandler(async (req, res) => {
  const status = String(req.body?.status || '');
  const r = await intel.updateAlert(req.params.id, { status, note: req.body?.note }, req.user._id);
  if (r.error) return sendError(res, r.error, r.code);
  await audit(req, `Developer marked security alert ${status}`, {
    area: 'developer.security',
    alertId: req.params.id,
    ruleId: r.alert.ruleId,
    device: r.alert.device,
    status,
    note: req.body?.note ? String(req.body.note).slice(0, 1000) : null,
  });
  return sendSuccess(res, r.alert, 'Alert updated.');
});

exports.escalateAlert = asyncHandler(async (req, res) => {
  const r = await intel.escalateAlert(req.params.id, req.body?.note, req.user._id);
  if (r.error) return sendError(res, r.error, r.code);
  for (const userId of r.cases)
    await audit(
      req,
      'Developer escalated a security alert to a fraud case',
      {
        area: 'developer.security',
        alertId: req.params.id,
        ruleId: r.alert.ruleId,
        device: r.alert.device,
      },
      'User',
      userId
    );
  return sendSuccess(res, { alert: r.alert, cases: r.cases }, 'Escalated to fraud cases.');
});

exports.getAnalytics = asyncHandler(async (req, res) =>
  sendSuccess(res, await intel.analytics(parseRange({ range: '30d', ...req.query })))
);

exports.getIp = asyncHandler(async (req, res) => {
  const ip = String(req.params.ip || '');
  if (!/^[0-9a-fA-F.:]{3,64}$/.test(ip)) return sendError(res, 'Invalid IP.', 400);
  return sendSuccess(res, await intel.ipIntel(ip));
});

exports.getConfig = asyncHandler(async (req, res) => {
  const { DEFAULTS } = require('../../services/security/risk/config');
  return sendSuccess(res, { config: await getConfig(), defaults: DEFAULTS });
});

exports.updateConfig = asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const next = mergeConfig(body);
  const b = next.bands;
  if (!(b.medium < b.high && b.high < b.critical && b.critical <= 100))
    return sendError(res, 'Bands must rise: medium < high < critical ≤ 100.', 400);
  const before = await getConfig();
  await require('../../models/GlobalConfig').updateOne(
    { key: CONFIG_KEY },
    { $set: { value: next, description: 'Security Intelligence risk rule thresholds' } },
    { upsert: true }
  );
  await require('../../services/admin/activityService').logActivity({
    adminId: req.user._id,
    action: 'settings_updated',
    targetModel: 'GlobalConfig',
    description: 'Developer changed the security risk thresholds',
    metadata: { area: 'developer.security', before, after: next },
    ip: req.ip,
    userAgent: req.get('user-agent') || 'unknown',
  });
  return sendSuccess(res, { config: next }, 'Thresholds saved.');
});
