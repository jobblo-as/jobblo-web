/**
 * Device intelligence, Phase 3: pseudonymous installation ids, installation ↔ IP ↔ account
 * observations, and IP classification. Models and providers are faked; no network, no DB.
 */
const deviceId = require('../services/security/deviceId');
const observations = require('../services/security/observations');
const ipIntel = require('../services/security/ipIntel');

const UUID_A = '3f2b8c1e-9d4a-4b7e-8c21-5a6f7e8d9c0b';
const UUID_B = '7a1c2d3e-4f50-4a6b-9c8d-0e1f2a3b4c5d';

afterEach(() => {
  observations._reset();
  delete process.env.DEVICE_ID_SECRET;
  process.env.NODE_ENV = 'test';
});

describe('installation ids', () => {
  test('a signed cookie round-trips; a forged or malformed one is refused', () => {
    const cookie = deviceId.signWeb(UUID_A);
    expect(deviceId.parseWeb(cookie)).toBe(UUID_A);
    expect(deviceId.parseWeb(`${UUID_B}.${cookie.split('.')[1]}`)).toBeNull(); // someone else's sig
    expect(deviceId.parseWeb(`${UUID_A}.deadbeefdeadbeefdeadbeef`)).toBeNull();
    expect(deviceId.parseWeb('not-a-uuid.abc')).toBeNull();
    expect(deviceId.parseWeb(undefined)).toBeNull();
  });

  test('only a keyed hash is stored: stable, and never the raw id', () => {
    const key = deviceId.keyFor(UUID_A);
    expect(key).toBe(deviceId.keyFor(UUID_A.toUpperCase()));
    expect(key).not.toContain(UUID_A.slice(0, 8));
    expect(key).toHaveLength(32);
    expect(deviceId.labelFor(key)).toMatch(/^DEV-[0-9A-F]{4}$/);
  });

  test('the app id is "claimed"; a bad header is ignored', () => {
    expect(deviceId.fromRequest({ headers: { 'x-install-id': UUID_A } })).toMatchObject({
      platform: 'app',
      confidence: 'claimed',
      deviceKey: deviceId.keyFor(UUID_A),
    });
    expect(deviceId.fromRequest({ headers: { 'x-install-id': 'x' }, cookies: {} })).toBeNull();
  });

  test('production without DEVICE_ID_SECRET turns identification off (no cookie, no key)', () => {
    process.env.NODE_ENV = 'production';
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = { cookie: jest.fn() };
    const next = jest.fn();
    deviceId.deviceCookie({ headers: {}, cookies: {}, originalUrl: '/api/auth/login' }, res, next);
    expect(res.cookie).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    expect(deviceId.fromRequest({ headers: {}, cookies: {} })).toBeNull();
  });

  test('a browser without a valid cookie gets one, httpOnly; a valid one is kept', () => {
    const res = { cookie: jest.fn() };
    const req = { headers: {}, cookies: {}, originalUrl: '/api/auth/login' };
    deviceId.deviceCookie(req, res, () => {});
    expect(res.cookie).toHaveBeenCalledWith(
      'jb_did',
      expect.stringMatching(/^[0-9a-f-]{36}\.[0-9a-f]{24}$/),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' })
    );
    expect(req.deviceIdIssued).toBe(true);
    expect(deviceId.fromRequest(req).confidence).toBe('new');

    const back = {
      headers: {},
      cookies: { jb_did: res.cookie.mock.calls[0][1] },
      originalUrl: '/api/auth/refresh-token',
    };
    const res2 = { cookie: jest.fn() };
    deviceId.deviceCookie(back, res2, () => {});
    expect(res2.cookie).not.toHaveBeenCalled();
    expect(deviceId.fromRequest(back).confidence).toBe('confirmed');
  });
});

test('public responses get no cookie (cacheable, and no id for visitors who never sign in)', () => {
  for (const url of ['/api/services', '/api/categories?x=1', '/api/auth/probe']) {
    const res = { cookie: jest.fn() };
    deviceId.deviceCookie({ headers: {}, cookies: {}, originalUrl: url }, res, () => {});
    expect(res.cookie).not.toHaveBeenCalled();
  }
  for (const url of ['/api/auth/login', '/api/auth/register', '/api/auth/profile']) {
    const res = { cookie: jest.fn() };
    deviceId.deviceCookie({ headers: {}, cookies: {}, originalUrl: url }, res, () => {});
    expect(res.cookie).toHaveBeenCalledTimes(1);
  }
});

test('resolving a request is memoised: one HMAC per request, a forged cookie stays refused', () => {
  deviceId._clearCache();
  const crypto = require('crypto');
  const spy = jest.spyOn(crypto, 'createHmac');
  const cookie = deviceId.signWeb(UUID_A);
  spy.mockClear();
  const req = { headers: {}, cookies: { jb_did: cookie } };
  const first = deviceId.fromRequest(req);
  const calls = spy.mock.calls.length;
  expect(deviceId.fromRequest(req)).toBe(first); // same request: no work at all
  expect(deviceId.fromRequest({ headers: {}, cookies: { jb_did: cookie } }).deviceKey).toBe(
    first.deviceKey
  );
  expect(spy.mock.calls.length).toBe(calls); // same browser, next request: cached
  const forged = `${UUID_B}.${cookie.split('.')[1]}`;
  expect(deviceId.fromRequest({ headers: {}, cookies: { jb_did: forged } })).toBeNull();
  expect(deviceId.fromRequest({ headers: {}, cookies: { jb_did: forged } })).toBeNull();
  spy.mockRestore();
});

describe('what is observed', () => {
  test.each([
    ['POST', '/api/auth/login', 200, 'login'],
    ['POST', '/api/auth/login', 401, 'login_failed'],
    ['POST', '/api/auth/login', 429, null],
    ['POST', '/api/auth/register', 201, 'register'],
    ['POST', '/api/auth/reset-password', 200, 'password_reset'],
    ['POST', '/api/auth/refresh-token', 200, 'session'],
    ['PUT', '/api/users/64c000000000000000000001', 200, 'sensitive'],
    ['GET', '/api/services', 200, null],
  ])('%s %s %i → %s', (method, path, status, event) => {
    expect(observations.classifyEvent({ method, path, status })).toBe(event);
  });

  const cookieFor = (id) => ({ jb_did: deviceId.signWeb(id) });
  const req = (over = {}) => ({
    method: 'GET',
    originalUrl: '/api/services',
    ip: '::ffff:84.210.1.2',
    headers: {},
    cookies: cookieFor(UUID_A),
    get: () => 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0',
    ...over,
  });

  test('a browser that never kept its cookie only counts on a security outcome', () => {
    const issued = { ...req(), cookies: {}, deviceId: UUID_B, deviceIdIssued: true };
    observations.record(issued, { statusCode: 200 });
    expect(observations._buffer()).toHaveLength(0);
    observations.record(
      { ...issued, method: 'POST', originalUrl: '/api/auth/login' },
      { statusCode: 401 }
    );
    expect(observations._buffer()).toHaveLength(1);
  });

  test('plain sightings are deduped for 10 minutes; events always count', () => {
    observations.record(req(), { statusCode: 200 });
    observations.record(req(), { statusCode: 200 });
    expect(observations._buffer()).toHaveLength(1);
    const fail = req({ method: 'POST', originalUrl: '/api/auth/login' });
    observations.record(fail, { statusCode: 401 });
    observations.record(fail, { statusCode: 401 });
    expect(observations._buffer().filter((o) => o.event === 'login_failed')).toHaveLength(2);
    // Coalescing a batch keeps every event row.
    expect(observations.coalesce(observations._buffer())).toHaveLength(3);
  });

  test('the IP is Express req.ip (trust proxy), never a client-sent X-Forwarded-For', () => {
    observations.record(req({ headers: { 'x-forwarded-for': '1.2.3.4' } }), { statusCode: 200 });
    expect(observations._buffer()[0].ip).toBe('84.210.1.2');
  });

  test('the sign-in user and session come from createSession for the login response', () => {
    observations.record(
      req({
        method: 'POST',
        originalUrl: '/api/auth/login',
        securityUserId: '64c000000000000000000009',
        securitySessionId: '64c00000000000000000000a',
      }),
      { statusCode: 200 }
    );
    expect(observations._buffer()[0]).toMatchObject({
      event: 'login',
      userId: '64c000000000000000000009',
      sessionId: '64c00000000000000000000a',
    });
  });

  test('a stored row holds a browser family, not the user agent', () => {
    observations.record(req(), { statusCode: 200 });
    const row = observations._buffer()[0];
    expect(row.uaFamily).toMatch(/Chrome 131/);
    expect(JSON.stringify(row)).not.toContain('Mozilla');
    expect(JSON.stringify(row)).not.toContain(UUID_A);
  });

  test('prefixes: one network counts once', () => {
    expect(observations.prefixOf('84.210.1.2')).toBe('84.210.1.0/24');
    expect(observations.prefixOf('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:85a3::/48');
  });
});

/** In-memory stand-ins for the two models and SecurityEvent. */
function fakeStore() {
  const installs = new Map();
  const obs = new Map();
  const events = [];
  const DeviceInstallation = {
    MAX_USERS: 3,
    findOne: ({ deviceKey }) => ({
      select: () => ({
        lean: async () => (installs.has(deviceKey) ? { ...installs.get(deviceKey) } : null),
      }),
    }),
    updateOne: async ({ deviceKey }, update) => {
      const doc = installs.get(deviceKey) || { deviceKey, userIds: [], ...update.$setOnInsert };
      Object.assign(doc, update.$set);
      if (update.$addToSet) {
        const id = update.$addToSet.userIds;
        if (!doc.userIds.some((u) => String(u) === String(id))) doc.userIds.push(id);
      }
      installs.set(deviceKey, doc);
    },
  };
  const DeviceObservation = {
    updateOne: async ({ deviceKey, ip }, update) => {
      const k = `${deviceKey}|${ip}`;
      const isNew = !obs.has(k);
      const doc = obs.get(k) || { deviceKey, ip, hits: 0, ...update.$setOnInsert };
      Object.assign(doc, update.$set);
      doc.hits += update.$inc.hits;
      obs.set(k, doc);
      return { upsertedCount: isNew ? 1 : 0 };
    },
  };
  const SecurityEvent = { insertMany: async (rows) => events.push(...rows) };
  const enqueued = [];
  const enqueue = async (q, name, data) => enqueued.push([q, name, data.ip]);
  return {
    installs,
    obs,
    events,
    enqueued,
    deps: { DeviceInstallation, DeviceObservation, SecurityEvent, enqueue },
  };
}

describe('writing observations', () => {
  const KEY = 'a'.repeat(32);
  const row = (ip, userId, at = new Date()) => ({
    at,
    deviceKey: KEY,
    platform: 'web',
    ip,
    userId,
    sessionId: null,
    event: null,
    uaFamily: 'Chrome 131 · Windows 10',
  });
  const U1 = '64c000000000000000000001';

  test('the example: one installation from Pakistan, then two VPN exits → two new-IP events', async () => {
    const s = fakeStore();
    await observations.writeBatch([row('39.45.120.10', U1)], s.deps);
    await observations.writeBatch([row('185.220.101.20', U1)], s.deps);
    await observations.writeBatch([row('146.70.120.40', U1)], s.deps);
    expect(s.obs.size).toBe(3);
    // The first sighting of a brand-new installation is not "a new IP".
    expect(s.events.map((e) => [e.type, e.ip])).toEqual([
      ['device_new_ip', '185.220.101.20'],
      ['device_new_ip', '146.70.120.40'],
    ]);
    // Each new pair is classified once, off the request path.
    expect(s.enqueued.filter((e) => e[1] === 'enrich').map((e) => e[2])).toEqual([
      '39.45.120.10',
      '185.220.101.20',
      '146.70.120.40',
    ]);
  });

  test('the same IP again is counted, not re-reported', async () => {
    const s = fakeStore();
    await observations.writeBatch([row('39.45.120.10', U1)], s.deps);
    await observations.writeBatch([row('39.45.120.10', U1)], s.deps);
    expect(s.obs.get(`${KEY}|39.45.120.10`).hits).toBe(2);
    expect(s.events).toHaveLength(0);
    expect(s.enqueued.filter((e) => e[1] === 'enrich')).toHaveLength(1);
    // Every write also asks for the installation's risk rules.
    expect(s.enqueued.filter((e) => e[1] === 'evaluate')).toHaveLength(2);
  });

  test('a second account on one installation is an event; the account list is capped', async () => {
    const s = fakeStore();
    const ids = ['1', '2', '3', '4', '5'].map((n) => `64c00000000000000000000${n}`);
    for (const id of ids) await observations.writeBatch([row('39.45.120.10', id)], s.deps);
    expect(s.events.filter((e) => e.type === 'device_new_account')).toHaveLength(4);
    expect(s.installs.get(KEY).userIds).toHaveLength(3); // MAX_USERS in the fake
  });

  test('no signed-in user: sighting stored, no account event', async () => {
    const s = fakeStore();
    await observations.writeBatch([row('39.45.120.10', U1)], s.deps);
    await observations.writeBatch([row('39.45.120.10', null)], s.deps);
    expect(s.events).toHaveLength(0);
  });
});

describe('IP intelligence', () => {
  const provider = (name, result) => ({ name, lookup: async () => result });
  const cache = require('../utils/cache');
  beforeEach(() => {
    jest.spyOn(cache, 'get').mockResolvedValue(undefined);
    jest.spyOn(cache, 'set').mockResolvedValue(undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  test('Tor beats everything; a VPN/proxy flag is vpn_proxy, not "VPN for sure"', () => {
    const tor = ipIntel.merge([
      { name: 'tor', result: { tor: true } },
      { name: 'ip-api', result: { vpnProxy: true, countryCode: 'DE' } },
    ]);
    expect(tor).toMatchObject({ class: 'tor', confidence: 'high', sources: ['tor', 'ip-api'] });
    expect(
      ipIntel.merge([{ name: 'ip-api', result: { vpnProxy: true, countryCode: 'NL' } }]).class
    ).toBe('vpn_proxy');
    expect(
      ipIntel.merge([{ name: 'ip-api', result: { hosting: true, countryCode: 'US' } }]).class
    ).toBe('hosting');
    expect(
      ipIntel.merge([{ name: 'ip-api', result: { mobile: true, countryCode: 'NO' } }]).class
    ).toBe('mobile');
  });

  test('"residential" is low confidence; nothing known is "unknown"', () => {
    expect(ipIntel.merge([{ name: 'ip-api', result: { countryCode: 'NO' } }])).toMatchObject({
      class: 'residential',
      confidence: 'low',
    });
    expect(ipIntel.merge([{ name: 'tor', result: { tor: false } }]).class).toBe('unknown');
    expect(ipIntel.merge([]).class).toBe('unknown');
  });

  test('a provider that throws or hangs leaves the others, and the result is never a throw', async () => {
    const broken = {
      name: 'broken',
      lookup: async () => {
        throw new Error('ECONNRESET');
      },
    };
    const hanging = { name: 'slow', lookup: () => new Promise(() => {}) };
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const net = await ipIntel.classify('185.220.101.20', {
      providers: [broken, hanging, provider('tor', { tor: true })],
      timeoutMs: 50,
    });
    expect(net).toMatchObject({ class: 'tor', sources: ['tor'] });
    const none = await ipIntel.classify('146.70.120.40', {
      providers: [broken, hanging],
      timeoutMs: 50,
    });
    expect(none.class).toBe('unknown');
    expect(cache.set).toHaveBeenLastCalledWith(
      expect.stringContaining('146.70.120.40'),
      expect.anything(),
      3600
    );
  });

  test('private addresses are not looked up; Redis down does not break a lookup', async () => {
    const spy = jest.fn();
    expect(
      (await ipIntel.classify('192.168.1.10', { providers: [{ name: 'x', lookup: spy }] })).class
    ).toBe('private');
    expect(spy).not.toHaveBeenCalled();
    cache.get.mockRejectedValue(new Error('redis down'));
    cache.set.mockRejectedValue(new Error('redis down'));
    const net = await ipIntel.classify('185.220.101.20', {
      providers: [provider('tor', { tor: true })],
    });
    expect(net.class).toBe('tor');
  });

  test('ip-api is off in production unless IPINTEL_IPAPI=on', () => {
    const ipApi = require('../services/security/ipIntel/providers/ipApi');
    process.env.NODE_ENV = 'production';
    delete process.env.IPINTEL_IPAPI;
    expect(ipApi.enabled()).toBe(false);
    process.env.IPINTEL_IPAPI = 'on';
    expect(ipApi.enabled()).toBe(true);
    delete process.env.IPINTEL_IPAPI;
  });
});
