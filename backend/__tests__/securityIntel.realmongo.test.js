/**
 * Security Intelligence end to end on a real MongoDB: observations → IP classification → risk
 * rules → alerts → every dashboard query → a decision → an escalation. Runs the aggregation
 * pipelines for real (a typo in one would only show here).
 *
 * Opt-in, against a throwaway database:
 *   SECURITY_REAL_MONGO_URI=mongodb://127.0.0.1:27017 npx jest securityIntel.realmongo
 */
const mongoose = require('mongoose');

const uri = process.env.SECURITY_REAL_MONGO_URI;
const maybe = uri ? describe : describe.skip;

maybe('security intelligence on MongoDB', () => {
  jest.setTimeout(60_000);
  const observations = require('../services/security/observations');
  const engine = require('../services/security/risk/engine');
  const intel = require('../services/security/intel');
  const { DEFAULTS } = require('../services/security/risk/config');
  const DeviceObservation = require('../models/DeviceObservation');
  const SecurityAlert = require('../models/SecurityAlert');
  const FraudCase = require('../models/FraudCase');
  const User = require('../models/User');

  const KEY = 'c'.repeat(32);
  const range = () => ({
    from: new Date(Date.now() - 86400000),
    to: new Date(),
    bucketMs: 3600000,
  });
  let users;

  beforeAll(async () => {
    await mongoose.connect(uri, { dbName: 'jobblo-test-security' });
    await mongoose.connection.dropDatabase();
    await Promise.all(
      [require('../models/DeviceInstallation'), DeviceObservation, SecurityAlert].map((M) =>
        M.init()
      )
    );
    users = await User.insertMany(
      ['a', 'b', 'c'].map((n) => ({
        name: `Test ${n}`,
        email: `security-${n}@example.test`,
        password: 'x'.repeat(60),
        role: 'user',
      })),
      { lean: true }
    );
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  test('the example: Pakistan, then two VPN exits; three accounts on it', async () => {
    const enqueue = async () => {}; // the queue is exercised elsewhere
    const at = (min) => new Date(Date.now() - min * 60000);
    const row = (ip, u, min) => ({
      at: at(min),
      deviceKey: KEY,
      platform: 'web',
      ip,
      userId: String(u._id),
      sessionId: null,
      event: null,
      uaFamily: 'Chrome 131 · Windows 10',
    });
    await observations.writeBatch([row('39.45.120.10', users[0], 50)], { enqueue });
    await observations.writeBatch([row('185.220.101.20', users[1], 20)], { enqueue });
    await observations.writeBatch([row('146.70.120.40', users[2], 5)], { enqueue });

    // What the enrich job writes once the providers answered.
    const net = (cls, cc) => ({
      class: cls,
      countryCode: cc,
      confidence: 'medium',
      sources: ['test'],
      checkedAt: new Date(),
    });
    await DeviceObservation.updateMany(
      { ip: '39.45.120.10' },
      { $set: { network: net('residential', 'PK') } }
    );
    await DeviceObservation.updateMany(
      { ip: '185.220.101.20' },
      { $set: { network: net('vpn_proxy', 'DE') } }
    );
    await DeviceObservation.updateMany(
      { ip: '146.70.120.40' },
      { $set: { network: net('vpn_proxy', 'NL') } }
    );

    const r = await engine.evaluateDevice(KEY, { config: DEFAULTS });
    expect(Object.keys(r.outcomes).sort()).toEqual(['B_VPN_TRANSITION', 'C_MULTI_ACCOUNT']);
    expect(r.band).toBe('medium'); // 8 (B) + 20 (C, likely) + 10 corroboration = 38
    // Running it again changes nothing.
    await engine.evaluateDevice(KEY, { config: DEFAULTS });
    expect(await SecurityAlert.countDocuments({ deviceKey: KEY })).toBe(2);
  });

  test('every dashboard query runs and agrees', async () => {
    const o = await intel.overview(range());
    expect(o.totals).toMatchObject({
      openAlerts: 2,
      multiAccountDevices: 1,
      maskedObservations: 2,
    });
    expect(o.trend.length).toBeGreaterThan(0);

    const devices = await intel.listDevices(
      { q: '185.220.101.20' },
      { page: 1, limit: 25, skip: 0 }
    );
    expect(devices.rows[0]).toMatchObject({ deviceKey: KEY, ips: 3, maskedIps: 2, accounts: 3 });
    expect(devices.rows[0].countries.sort()).toEqual(['DE', 'NL', 'PK']);

    const detail = await intel.deviceDetail(KEY);
    expect(detail.observations).toHaveLength(3);
    expect(detail.accounts.map((a) => a.email)).toEqual([
      's***@example.test',
      's***@example.test',
      's***@example.test',
    ]);
    expect(detail.score.band).toBe('medium');

    const events = await intel.listEvents({ device: detail.device.device }, range(), {
      page: 1,
      limit: 25,
      skip: 0,
    });
    expect(events.rows.map((e) => e.type).sort()).toEqual([
      'device_new_account',
      'device_new_account',
      'device_new_ip',
      'device_new_ip',
    ]);
    expect(events.byType.device_new_ip).toBe(2);

    const alerts = await intel.listAlerts({ status: 'live' }, { page: 1, limit: 25, skip: 0 });
    expect(alerts.pagination.total).toBe(2);
    const ip = await intel.ipIntel('146.70.120.40');
    expect(ip).toMatchObject({ network: { class: 'vpn_proxy' }, devices: [{ deviceKey: KEY }] });
    const a = await intel.analytics({
      ...range(),
      from: new Date(Date.now() - 30 * 86400000),
      bucketMs: 86400000,
    });
    expect(a.byRule.map((r) => r.ruleId).sort()).toEqual(['B_VPN_TRANSITION', 'C_MULTI_ACCOUNT']);
  });

  test('a false positive is kept closed; an escalation opens a fraud case per account', async () => {
    const vpn = await SecurityAlert.findOne({ ruleId: 'B_VPN_TRANSITION' }).lean();
    const dev = users[0]._id;
    const fp = await intel.updateAlert(
      String(vpn._id),
      { status: 'false_positive', note: 'Known corporate VPN.' },
      dev
    );
    expect(fp.alert.status).toBe('false_positive');
    expect((await SecurityAlert.findById(vpn._id).lean()).closedAt).toBeInstanceOf(Date);
    await engine.evaluateDevice(KEY, { config: DEFAULTS });
    expect((await SecurityAlert.findById(vpn._id).lean()).status).toBe('false_positive');

    const multi = await SecurityAlert.findOne({ ruleId: 'C_MULTI_ACCOUNT' }).lean();
    const esc = await intel.escalateAlert(
      String(multi._id),
      'Three accounts, one browser, same week.',
      dev
    );
    expect(esc.cases).toHaveLength(3);
    expect(await FraudCase.countDocuments({ status: 'investigating' })).toBe(3);
    const detail = await intel.alertDetail(String(multi._id));
    expect(detail.alert.status).toBe('escalated');
    expect(detail.fraudCases).toHaveLength(3);
    expect(detail.alert.notes.at(-1).text).toMatch(/^Escalated:/);
  });
});
