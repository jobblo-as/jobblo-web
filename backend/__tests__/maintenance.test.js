/**
 * Maintenance mode: one area off leaves the rest working; the whole site off leaves staff,
 * sign-in and the admin/developer APIs open; Stripe webhooks are never blocked.
 */
const fs = require('fs');
const path = require('path');
const m = require('../services/maintenance');

const state = (over = {}) => m.normalize({ enabled: false, message: '', areas: {}, ...over });
const off = (...keys) => Object.fromEntries(keys.map((k) => [k, { enabled: true, message: '' }]));

describe('one area at a time', () => {
  test.each([
    ['payments', 'POST', '/api/stripe/v2/create-checkout-session'],
    ['payments', 'POST', '/api/safepay-checkout/create-session'],
    ['payouts', 'POST', '/api/connect/account-link'],
    ['login_google', 'GET', '/api/auth/web/google'],
    ['login_google', 'GET', '/api/auth/google/callback'],
    ['login_apple', 'POST', '/api/auth/apple/native'],
    ['login_apple', 'GET', '/api/auth/mobile/apple'],
    ['login_vipps', 'GET', '/api/auth/web/vipps'],
    ['bankid', 'GET', '/api/auth/idura'],
    ['login_password', 'POST', '/api/auth/login'],
    ['registration', 'POST', '/api/auth/register'],
    ['job_posting', 'POST', '/api/services'],
    ['messaging', 'POST', '/api/messages/abc'],
    ['ai', 'POST', '/api/ai/generate-full-listing'],
  ])('%s off blocks %s %s', (key, method, url) => {
    expect(m.blockedArea(state({ areas: off(key) }), method, url)?.key).toBe(key);
  });

  test('…and nothing else', () => {
    const s = state({ areas: off('login_google') });
    expect(m.blockedArea(s, 'POST', '/api/auth/login')).toBeNull();
    expect(m.blockedArea(s, 'GET', '/api/auth/web/vipps')).toBeNull();
    expect(m.blockedArea(s, 'POST', '/api/stripe/v2/create-checkout-session')).toBeNull();
  });

  test('payments, job posting and messages off: reading still works', () => {
    const s = state({ areas: off('payments', 'job_posting', 'messaging') });
    expect(m.blockedArea(s, 'GET', '/api/stripe/v2/subscription')).toBeNull();
    expect(m.blockedArea(s, 'GET', '/api/services')).toBeNull();
    expect(m.blockedArea(s, 'GET', '/api/messages/abc')).toBeNull();
    expect(m.blockedArea(s, 'PUT', '/api/services/123')?.key).toBe('job_posting');
  });

  test('unknown areas and junk are dropped from what is stored', () => {
    expect(
      m.normalize({ enabled: 'yes', areas: { nope: { enabled: true }, ai: { enabled: 1 } } })
    ).toEqual({
      enabled: false,
      message: '',
      areas: { ai: { enabled: false, message: '' } },
    });
  });
});

describe('the guard', () => {
  const GlobalConfig = require('../models/GlobalConfig');
  const run = async (req) => {
    let status = 200;
    let body = null;
    let passed = false;
    const res = { status: (s) => ((status = s), res), json: (b) => ((body = b), res) };
    await m.maintenanceGuard(
      { headers: {}, cookies: {}, method: 'GET', ...req },
      res,
      () => (passed = true)
    );
    return { status, body, passed };
  };
  const stored = (value) =>
    jest.spyOn(GlobalConfig, 'findOne').mockReturnValue({ lean: async () => ({ value }) });
  beforeEach(() => m._clear());
  afterEach(() => jest.restoreAllMocks());

  test('an area off: 503 with its own message, code MAINTENANCE', async () => {
    stored({ areas: { payments: { enabled: true, message: 'Betaling er stengt til kl 14.' } } });
    const r = await run({ method: 'POST', originalUrl: '/api/stripe/v2/create-checkout-session' });
    expect(r).toMatchObject({
      status: 503,
      passed: false,
      body: { code: 'MAINTENANCE', area: 'payments', message: 'Betaling er stengt til kl 14.' },
    });
    expect((await run({ originalUrl: '/api/services' })).passed).toBe(true);
  });

  test('the whole site off: API refused, but sign-in, admin, developer and the status stay open', async () => {
    stored({ enabled: true, message: 'Oppgradering pågår.' });
    expect(await run({ originalUrl: '/api/services' })).toMatchObject({
      status: 503,
      body: { area: 'site', message: 'Oppgradering pågår.' },
    });
    for (const url of [
      '/api/auth/login',
      '/api/auth/profile',
      '/api/auth/refresh-token',
      '/api/admin/maintenance',
      '/api/developer/me',
      '/api/maintenance',
    ])
      expect([url, (await run({ method: 'POST', originalUrl: url })).passed]).toEqual([url, true]);
  });

  test('the whole site off: a signed-in superAdmin or developer still gets through', async () => {
    stored({ enabled: true });
    const tokens = require('../utils/tokenUtils');
    jest.spyOn(tokens, 'verifyToken').mockReturnValue({ id: 'u1' });
    const User = require('../models/User');
    const find = jest
      .spyOn(User, 'findById')
      .mockReturnValue({ select: () => ({ lean: async () => ({ role: 'developer' }) }) });
    expect(
      (await run({ originalUrl: '/api/services', headers: { authorization: 'Bearer t' } })).passed
    ).toBe(true);
    find.mockReturnValue({ select: () => ({ lean: async () => ({ role: 'user' }) }) });
    m._clear();
    expect(
      (await run({ originalUrl: '/api/services', headers: { authorization: 'Bearer t2' } })).status
    ).toBe(503);
  });

  test('a database error never blocks the site', async () => {
    jest.spyOn(GlobalConfig, 'findOne').mockReturnValue({
      lean: async () => {
        throw new Error('down');
      },
    });
    expect((await run({ originalUrl: '/api/services' })).passed).toBe(true);
  });
});

test('Stripe webhooks are mounted before the guard (never blocked)', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const guard = app.indexOf('maintenanceGuard');
  expect(guard).toBeGreaterThan(0);
  expect(app.indexOf("app.post('/api/stripe/webhook'")).toBeLessThan(guard);
  expect(app.indexOf("app.post('/api/safepay-checkout/webhook'")).toBeLessThan(guard);
});

describe('admin switch', () => {
  jest.mock('../services/admin/activityService', () => ({ logActivity: jest.fn() }));
  const GlobalConfig = require('../models/GlobalConfig');
  const ctl = require('../controllers/admin/contentAdminController');
  const call = async (body) => {
    const res = { status: jest.fn(() => res), json: jest.fn((b) => ((res.body = b), res)) };
    await ctl.toggleMaintenanceMode({ body, user: { _id: 'a1' }, ip: '1', headers: {} }, res);
    return res;
  };
  beforeEach(() => m._clear());
  afterEach(() => jest.restoreAllMocks());

  test('bad input is refused', async () => {
    expect((await call({ enabled: 'yes' })).status).toHaveBeenCalledWith(400);
    expect((await call({ enabled: false, areas: ['x'] })).status).toHaveBeenCalledWith(400);
  });

  test('one area is switched without touching the others; the cache is dropped', async () => {
    jest.spyOn(GlobalConfig, 'findOne').mockReturnValue({
      lean: async () => ({ value: { areas: { ai: { enabled: true, message: 'x' } } } }),
    });
    const save = jest
      .spyOn(GlobalConfig, 'findOneAndUpdate')
      .mockReturnValue({ lean: async () => ({ _id: 'c1' }) });
    await call({
      enabled: false,
      areas: { payments: { enabled: true, message: 'Stengt' }, bogus: { enabled: true } },
    });
    expect(save.mock.calls[0][1].value).toEqual({
      enabled: false,
      message: '',
      areas: {
        payments: { enabled: true, message: 'Stengt' },
        ai: { enabled: true, message: 'x' },
      },
    });
  });
});
