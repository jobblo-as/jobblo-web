/**
 * Middleware-chain performance changes keep behaviour:
 *  - express-session + passport.session run on /api/auth/* (every req.session reader lives there)
 *    and nowhere else;
 *  - req.ip is resolved once per request but still honours `trust proxy`;
 *  - requestMetrics' 60 s live window (moving head instead of Array#shift) counts the same.
 */
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = ''; // MemoryStore: no connect-mongo connection from this test
const EventEmitter = require('events');
const request = require('supertest');

// The real app.js middleware chain, with probe routes in place of the real routers
// (routes/auth pulls in an ESM-only util jest cannot load).
jest.mock('../routes/api', () => {
  const actual = jest.requireActual('../routes/api');
  const probe = (req, res) => {
    // Reflect.get runs Express's own req.ip getter: the memoised value must equal it.
    const fresh = Reflect.get(Object.getPrototypeOf(req), 'ip', req);
    if (req.session && req.query.save) req.session.probe = 1; // like the OAuth/BankID start endpoints
    res.json({ session: Boolean(req.session), login: typeof req.login, ip: req.ip, fresh });
  };
  return { ...actual, mountRoutes: (app) => app.get(['/api/auth/probe', '/api/auth/web/probe', '/api/services/probe', '/probe'], probe) };
});

describe('app.js session scoping', () => {
  const app = require('../app');

  it('req.session exists under /api/auth (and its sub-routers), and sets the cookie when used', async () => {
    for (const p of ['/api/auth/probe', '/api/auth/web/probe']) {
      const r = await request(app).get(p);
      expect(r.body.session).toBe(true);
      expect(r.headers['set-cookie']).toBeUndefined(); // saveUninitialized: false still holds
    }
    const saved = await request(app).get('/api/auth/probe?save=1');
    expect(String(saved.headers['set-cookie'])).toMatch(/^connect\.sid=/);
  });

  it('public routes skip the session but keep passport.initialize helpers', async () => {
    for (const p of ['/api/services/probe', '/probe']) {
      const r = await request(app).get(p).set('Cookie', 'connect.sid=s%3Aabc.def');
      expect(r.body).toMatchObject({ session: false, login: 'function' });
      expect(r.headers['set-cookie']).toBeUndefined();
    }
  });

  it('every router that reads req.session is mounted under /api/auth', () => {
    const { ROUTES } = jest.requireActual('../routes/api');
    for (const [mount, file] of ROUTES) if (['./auth', './webOAuth', './mobileOAuth'].includes(file)) expect(mount.startsWith('/api/auth')).toBe(true);
  });

  it('req.ip is memoised and equals Express’s own trust-proxy answer', async () => {
    const r = await request(app).get('/api/services/probe').set('X-Forwarded-For', '203.0.113.7');
    expect(r.body.ip).toBe(r.body.fresh);
    expect(r.body.ip).toBeTruthy();
  });
});

describe('requestMetrics live window', () => {
  const { requestMetrics, liveSnapshot } = require('../middleware/requestMetrics');
  const hit = (status = 200) => {
    const res = new EventEmitter();
    res.statusCode = status;
    res.json = () => {};
    res.locals = {};
    requestMetrics({ originalUrl: '/api/x', method: 'GET', ip: '1.2.3.4', get: () => '' }, res, () => {});
    res.emit('finish');
  };

  it('keeps exactly the last 60 s across compactions', () => {
    let now = Date.now() + 120_000; // past any real request recorded above
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    for (let i = 0; i < 5000; i++) { hit(i % 10 === 0 ? 500 : 200); now += 20; } // 100 s of traffic
    const s = liveSnapshot();
    // entries with t >= now_last - 60000 survive: last 3001 hits (20 ms apart), 300 of them 5xx
    expect(s.requestsLastMin).toBe(3001);
    expect(s.errorsLastMin).toBe(300);
    expect(s.rps).toBe(50);
    now += 61_000;
    hit();
    expect(liveSnapshot().requestsLastMin).toBe(1);
    spy.mockRestore();
  });

  it('stays O(1) per request under a full window', () => {
    let now = Date.now() + 10_000_000;
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    // Relative, not absolute µs: a busy CI box slows both runs alike, an O(window) step does not.
    const timed = (stepMs) => {
      for (let i = 0; i < 110_000; i++) { hit(); now += stepMs; } // fill the window first
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < 20_000; i++) { hit(); now += stepMs; }
      return Number(process.hrtime.bigint() - t0);
    };
    now += 120_000;
    const small = timed(60); // ~1k entries in the window
    now += 120_000;
    const full = timed(0.6); // ~100k entries in the window
    spy.mockRestore();
    expect(full / small).toBeLessThan(5); // Array#shift: 100x the window ≈ 30–250 µs vs ~1 µs
  });

  it('unmatched paths cannot mint one stored row per request', async () => {
    const { flush } = require('../middleware/requestMetrics');
    const ApiMetricMinute = require('../models/ApiMetricMinute');
    const insert = jest.spyOn(ApiMetricMinute, 'insertMany').mockResolvedValue([]);
    await flush(); // drop buckets left by the tests above
    const unrouted = (url) => {
      const res = new EventEmitter();
      Object.assign(res, { statusCode: 404, json: () => {}, locals: {} });
      requestMetrics({ originalUrl: url, method: 'GET', ip: '1.2.3.4', get: () => '' }, res, () => {});
      res.emit('finish');
    };
    for (let i = 0; i < 1500; i++) unrouted(`/api/x/${i}-uuid`); // ids in the 3rd segment
    for (let i = 0; i < 3000; i++) unrouted(`/api/r${i}/y`); // random mount names
    await flush();
    const rows = insert.mock.calls.at(-1)[0];
    insert.mockRestore();
    expect(rows.length).toBeLessThanOrEqual(1001);
    expect(rows.find((r) => r.route === '/api/x/*').count).toBe(1500);
    expect(rows.reduce((a, r) => a + r.count, 0)).toBe(4500); // overflow is counted, not dropped
  });
});
