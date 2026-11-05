/**
 * Security Intelligence API, Phase 5: who may do what, and input that must be refused before any
 * query runs. (The queries themselves: securityIntel.realmongo.test.js.)
 */
const fs = require('fs');
const path = require('path');
const intel = require('../services/security/intel');
const { hasAccess, requireAccess } = require('../controllers/developer/approvalsController');

const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'developer.js'), 'utf8');

test('every Security Intelligence write needs operations access; reads do not', () => {
  const lines = routes.split('\n').filter((l) => l.includes("'/security-intel/"));
  expect(lines.length).toBeGreaterThanOrEqual(12);
  for (const l of lines) {
    const write = /router\.(patch|post|put|delete)\(/.test(l);
    expect([l, write && l.includes(', operations,')]).toEqual([l, write]);
  }
  // …and the whole developer router sits behind authenticate + requireDeveloper.
  expect(routes).toMatch(/router\.use\(authenticate, requireDeveloper, adminLimiter\)/);
});

test('a read-only developer is refused a write (403); operations passes', () => {
  const run = (user) => {
    let status = 200;
    const res = { status: (s) => ((status = s), res), json: () => res };
    requireAccess('operations')({ user }, res, () => {});
    return status;
  };
  expect(run({ role: 'developer', developerAccess: 'readonly' })).toBe(403);
  expect(hasAccess({ role: 'developer', developerAccess: 'operations' }, 'operations')).toBe(true);
});

describe('refused before any query', () => {
  test('alert status: bad id, unknown status, closing without a reason', async () => {
    expect(await intel.updateAlert('nope', { status: 'resolved' })).toMatchObject({ code: 404 });
    const id = '64c000000000000000000001';
    expect(await intel.updateAlert(id, { status: 'deleted' })).toMatchObject({ code: 400 });
    expect(await intel.updateAlert(id, { status: 'escalated' })).toMatchObject({ code: 400 }); // only via escalate
    expect(await intel.updateAlert(id, { status: 'false_positive', note: 'ok' })).toMatchObject({
      code: 400,
      error: expect.stringMatching(/note/),
    });
  });

  test('escalation needs a reason', async () => {
    expect(await intel.escalateAlert('64c000000000000000000001', 'x')).toMatchObject({ code: 400 });
  });

  test('device search accepts a label, a key or a prefix — nothing that can become a regex attack', () => {
    expect(intel.deviceFilter('DEV-7A4C')).toEqual({ $regex: '^7a4c' });
    expect(intel.deviceFilter('a'.repeat(32))).toBe('a'.repeat(32));
    expect(intel.deviceFilter('abcd')).toEqual({ $regex: '^abcd' });
    expect(intel.deviceFilter('.*')).toBeNull();
    expect(intel.deviceFilter('(a+)+$')).toBeNull();
  });
});

test('threshold changes are validated: bands must rise', async () => {
  const ctl = require('../controllers/developer/securityIntelController');
  let status = 0;
  let body = null;
  const res = {
    status: (s) => ((status = s), res),
    json: (b) => ((body = b), res),
  };
  await ctl.updateConfig(
    { body: { bands: { medium: 60, high: 50, critical: 75 } }, user: { _id: 'x' } },
    res,
    () => {}
  );
  expect(status).toBe(400);
  expect(body.message).toMatch(/Bands must rise/);
});
