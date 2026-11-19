/**
 * Developer console → User Diagnostics → "Mobile app": the app version on each phone a user
 * used, newest event per install, newest phone first; other users' phones never show.
 * Opt-in: SAFEPAY_REAL_MONGO_URI=mongodb://127.0.0.1:27017/jobblo-appversions-test npx jest userAppVersions
 */
const mongoose = require('mongoose');

// The IP page looks the network up online; not in a test.
jest.mock('../services/monitoring/ipGeo', () => ({ networkFor: async () => ({}) }));

const uri = process.env.SAFEPAY_REAL_MONGO_URI;
const run =
  uri && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/[\w-]+-test(\?.*)?$/.test(uri)
    ? describe
    : describe.skip;

run('user diagnostics app versions (real MongoDB)', () => {
  const MobileEvent = require('../models/MobileEvent');
  const { getUserDiagnostics } = require('../controllers/developer/userDiagnosticsController');
  const alice = new mongoose.Types.ObjectId();
  const bob = new mongoose.Types.ObjectId();
  const at = (min) => new Date(Date.now() - min * 60_000);
  const event = (userId, installId, min, extra) => ({
    type: 'session',
    at: at(min),
    installId,
    sessionId: `s_${installId}_${min}`,
    userId,
    ...extra,
  });

  const call = async (id) => {
    const res = { statusCode: 200, body: null };
    res.status = (c) => ((res.statusCode = c), res);
    res.json = (b) => ((res.body = b), res);
    await new Promise((resolve, reject) => {
      res.json = (b) => ((res.body = b), resolve(), res);
      getUserDiagnostics({ params: { id: String(id) } }, res, reject);
    });
    return res;
  };

  beforeAll(async () => {
    await mongoose.connect(uri, { dbName: 'jobblo-test-appversions' });
    await mongoose.connection.db.collection('users').insertMany([
      { _id: alice, name: 'Alice', email: 'alice@test.local', createdAt: new Date() },
      { _id: bob, name: 'Bob', email: 'bob@test.local', createdAt: new Date() },
    ]);
    await MobileEvent.insertMany([
      // Alice's iPhone: updated from build 12 to 15; the newest event wins.
      event(alice, 'inst_iphone_a', 300, { platform: 'ios', appVersion: '1.0.0', build: '12' }),
      event(alice, 'inst_iphone_a', 5, {
        platform: 'ios',
        appVersion: '1.0.0',
        build: '15',
        device: 'iPhone 15 Pro',
        osVersion: '18.2',
      }),
      // Alice's older Android phone.
      event(alice, 'inst_android_a', 60, { platform: 'android', appVersion: '1.0.0', build: '9' }),
      // Bob's phone must not show up for Alice.
      event(bob, 'inst_bob', 1, { platform: 'ios', appVersion: '1.0.0', build: '16' }),
    ]);
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  test('latest version per phone, newest phone first, own phones only', async () => {
    const res = await call(alice);
    expect(res.statusCode).toBe(200);
    const apps = res.body.data?.appInstalls ?? res.body.appInstalls;
    expect(apps.map((a) => [a._id, a.platform, a.build])).toEqual([
      ['inst_iphone_a', 'ios', '15'],
      ['inst_android_a', 'android', '9'],
    ]);
    expect(apps[0]).toMatchObject({ device: 'iPhone 15 Pro', osVersion: '18.2' });
  });

  test('IP page: each account gets its own newest phone', async () => {
    const { appInstallsOf } = require('../services/monitoring/mobileTelemetry');
    const rows = await appInstallsOf([alice, bob], { limit: 500 });
    const newest = (u) => rows.find((r) => String(r.userId) === String(u));
    expect(newest(alice)).toMatchObject({ _id: 'inst_iphone_a', build: '15' });
    expect(newest(bob)).toMatchObject({ _id: 'inst_bob', build: '16' });
    expect(await appInstallsOf([])).toEqual([]);
  });

  test('IP page endpoint: the accounts table carries the app version of each account', async () => {
    require('../models/User');
    const Session = require('../models/Session');
    const ip = '10.20.30.40';
    await Session.collection.insertMany([
      { userId: alice, ip, refreshToken: 'rt-alice', lastUsed: at(5), createdAt: at(60) },
      { userId: bob, ip, refreshToken: 'rt-bob', lastUsed: at(1), createdAt: at(30) },
    ]);
    const { getApiClients } = require('../controllers/developer/apiMonitoringController');
    const body = await new Promise((resolve, reject) => {
      const res = { status: () => res, json: resolve };
      getApiClients({ query: { ip, range: '24h' } }, res, reject);
    });
    const accounts = (body.data ?? body).accounts;
    const appOf = (u) => accounts.find((a) => String(a._id) === String(u)).app;
    expect(appOf(alice)).toMatchObject({ platform: 'ios', build: '15', device: 'iPhone 15 Pro' });
    expect(appOf(bob)).toMatchObject({ build: '16' });
    expect(appOf(alice).userId).toBeUndefined();
  });

  test('a user who never used the app has an empty list', async () => {
    const carol = new mongoose.Types.ObjectId();
    await mongoose.connection.db
      .collection('users')
      .insertOne({ _id: carol, name: 'Carol', email: 'carol@test.local', createdAt: new Date() });
    const res = await call(carol);
    expect(res.body.data?.appInstalls ?? res.body.appInstalls).toEqual([]);
  });
});
