/**
 * Sign in with Apple, web flow (Android app + website): GET /api/auth/{mobile,web}/apple and
 * POST /api/auth/apple/callback. Apple's JWKS is mocked with a local RSA key; Apple is never called.
 */
jest.mock('../models/User', () => ({ findOne: jest.fn(), findById: jest.fn(), create: jest.fn() }));
jest.mock('../models/MobileOAuthCode', () => ({ create: jest.fn(async () => ({})) }));
jest.mock('../utils/tokenUtils', () => ({
  createSession: jest.fn(async () => ({ accessToken: 'h.p.s', refreshToken: 'rt' })),
}));
jest.mock('../utils/passwordUtils', () => ({ createUnusablePassword: jest.fn(async () => 'x') }));

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const MobileOAuthCode = require('../models/MobileOAuthCode');
const { createSession } = require('../utils/tokenUtils');
const apple = require('../controllers/appleAuthController');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-kid';
const SERVICES_ID = 'no.jobblo.signin';
const VERIFIER = crypto.randomBytes(40).toString('base64url');
const CHALLENGE = crypto.createHash('sha256').update(VERIFIER).digest('base64url');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    cookies: {},
    cleared: [],
    set(name, value) {
      if (typeof name === 'object') Object.assign(this.headers, name);
      else this.headers[name] = value;
      return this;
    },
    cookie(name, value, opts) {
      this.cookies[name] = { value, opts };
      return this;
    },
    clearCookie(name) {
      this.cleared.push(name);
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    redirect(a, b) {
      this.statusCode = b === undefined ? 302 : a;
      this.location = b === undefined ? a : b;
      return this;
    },
  };
}

const req = (extra = {}) => ({ query: {}, body: {}, cookies: {}, headers: {}, protocol: 'https', get: () => 'api.test', ...extra });

/** Runs a start endpoint and returns the authorize URL's params plus the response. */
function start(platform, query = { code_challenge: CHALLENGE, code_challenge_method: 'S256' }) {
  const res = makeRes();
  apple.appleWebStart(req({ query }), res, platform);
  const params = res.location?.startsWith('https://appleid.apple.com/') ? new URL(res.location).searchParams : null;
  return { res, params };
}

function idToken(nonce, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: 'https://appleid.apple.com',
      aud: SERVICES_ID,
      sub: '001234.apple.sub',
      iat: now,
      exp: now + 600,
      nonce,
      email: 'abc123@privaterelay.appleid.com',
      email_verified: 'true',
      ...overrides,
    },
    privateKey,
    { algorithm: 'RS256', keyid: KID }
  );
}

async function callback(body, cookies = {}) {
  const res = makeRes();
  await apple.appleWebCallback(req({ body, cookies }), res);
  return res;
}

const selectable = (v) => ({ select: () => Promise.resolve(v), then: (r, j) => Promise.resolve(v).then(r, j) });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  apple._resetAppleKeyCache();
  process.env.APPLE_SERVICES_ID = SERVICES_ID;
  process.env.APPLE_REDIRECT_URI = 'https://jobblo.no/api/auth/apple/callback';
  process.env.SESSION_SECRET = 'test-session-secret';
  process.env.MOBILE_RETURN_URL = 'https://api.test';
  process.env.FRONTEND_URL = 'https://jobblo.no';
  delete process.env.APPLE_BUNDLE_ID;
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }] }),
  }));
  User.findOne.mockImplementation(() => selectable(null));
  User.create.mockImplementation(async (doc) => ({ _id: 'new-user', ...doc }));
});

describe('start', () => {
  test('mobile start redirects to Apple with form_post, the Services ID and a signed state', () => {
    const { res, params } = start('mobile');
    expect(res.statusCode).toBe(302);
    expect(res.location).toMatch(/response_type=code%20id_token/);
    expect(Object.fromEntries(params)).toEqual(
      expect.objectContaining({
        client_id: SERVICES_ID,
        redirect_uri: 'https://jobblo.no/api/auth/apple/callback',
        response_type: 'code id_token',
        scope: 'name email',
        response_mode: 'form_post',
      })
    );
    const state = jwt.decode(params.get('state'));
    expect(state).toEqual(expect.objectContaining({ p: 'mobile', cc: CHALLENGE, n: params.get('nonce') }));
    expect(res.headers['Cache-Control']).toMatch(/no-store/);
  });

  test.each([
    ['APPLE_SERVICES_ID', 'APPLE_SERVICES_ID'],
    ['APPLE_REDIRECT_URI', 'APPLE_REDIRECT_URI'],
  ])('503 when %s is not set', (_n, key) => {
    delete process.env[key];
    for (const platform of ['mobile', 'web']) {
      const { res } = start(platform);
      expect(res.statusCode).toBe(503);
      expect(res.body.code).toBe('apple_unavailable');
    }
  });

  test('503 for a non-https redirect URI', () => {
    process.env.APPLE_REDIRECT_URI = 'http://jobblo.no/api/auth/apple/callback';
    expect(start('mobile').res.statusCode).toBe(503);
  });

  test('mobile start without an S256 challenge goes to the bridge error, not to Apple', () => {
    const { res } = start('mobile', { code_challenge: CHALLENGE, code_challenge_method: 'plain' });
    expect(res.location).toBe('https://api.test/api/auth/mobile-return?state=error&code=apple_failed');
  });

  test('web start sets an httpOnly SameSite=None binding cookie whose hash is in the state', () => {
    const { res, params } = start('web', {});
    const cookie = res.cookies.jobblo_apple_web;
    expect(cookie.opts).toEqual(expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'none' }));
    expect(jwt.decode(params.get('state'))).toEqual(expect.objectContaining({ p: 'web', b: sha(cookie.value) }));
  });
});

describe('mobile callback', () => {
  test('a valid form_post creates the user and issues a one-time code bound to the challenge; no token in the URL', async () => {
    const { params } = start('mobile');
    const res = await callback({
      state: params.get('state'),
      id_token: idToken(params.get('nonce')),
      code: 'apple-auth-code',
      user: JSON.stringify({ name: { firstName: 'Kari', lastName: 'Nordmann' }, email: 'x@y.z' }),
    });
    expect(res.statusCode).toBe(303);
    expect(res.location).toMatch(/^https:\/\/api\.test\/api\/auth\/mobile-return\?state=success&code=[A-Za-z0-9_-]{43}$/);
    expect(res.location).not.toMatch(/token|h\.p\.s/);
    expect(MobileOAuthCode.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'new-user', codeChallenge: CHALLENGE }));
    expect(User.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Kari',
        lastName: 'Nordmann',
        oauthProviders: [{ provider: 'apple', providerId: '001234.apple.sub' }],
        emailVerifiedAt: expect.any(Date),
      })
    );
    // The session is created only when the app redeems the code.
    expect(createSession).not.toHaveBeenCalled();
  });

  test('an existing Apple user logs in; a garbage `user` field is ignored', async () => {
    const existing = { _id: 'apple-user' };
    User.findOne.mockImplementation((q) => selectable(q.oauthProviders ? existing : null));
    const { params } = start('mobile');
    const res = await callback({ state: params.get('state'), id_token: idToken(params.get('nonce')), user: '{not json' });
    expect(res.location).toMatch(/state=success&code=/);
    expect(User.create).not.toHaveBeenCalled();
    expect(MobileOAuthCode.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'apple-user' }));
  });

  const refused = async (body, code) => {
    const res = await callback(body);
    expect(res.statusCode).toBe(303);
    expect(res.location).toBe(`https://api.test/api/auth/mobile-return?state=error&code=${code}`);
    expect(MobileOAuthCode.create).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  };

  test('nonce mismatch is refused', async () => {
    const { params } = start('mobile');
    await refused({ state: params.get('state'), id_token: idToken('another-nonce') }, 'apple_invalid_token');
  });

  test('wrong audience (the iOS bundle id) is refused', async () => {
    const { params } = start('mobile');
    await refused({ state: params.get('state'), id_token: idToken(params.get('nonce'), { aud: 'com.jobblo.app' }) }, 'apple_invalid_token');
  });

  test('an e-mail owned by another account is refused, never linked', async () => {
    User.findOne.mockImplementation((q) => selectable(q.email ? { _id: 'pw-user' } : null));
    const { params } = start('mobile');
    await refused({ state: params.get('state'), id_token: idToken(params.get('nonce')) }, 'apple_account_exists');
  });

  test('Apple-reported cancel reaches the app', async () => {
    const { params } = start('mobile');
    await refused({ state: params.get('state'), error: 'user_cancelled_authorize' }, 'apple_cancelled');
  });

  test.each([
    ['missing', () => undefined],
    ['forged (other secret)', () => jwt.sign({ p: 'mobile', cc: CHALLENGE, n: 'n' }, 'attacker', { audience: 'jobblo:apple-web-state' })],
    ['expired', () => jwt.sign({ p: 'mobile', cc: CHALLENGE, n: 'n', exp: Math.floor(Date.now() / 1000) - 10 }, 'test-session-secret', { audience: 'jobblo:apple-web-state' })],
    ['wrong audience (e.g. an access token)', () => jwt.sign({ p: 'mobile', cc: CHALLENGE, n: 'n' }, 'test-session-secret', { audience: 'jobblo:access' })],
    ['tampered', () => {
      const s = start('mobile').params.get('state');
      return s.slice(0, -2) + (s.endsWith('A') ? 'BB' : 'AA');
    }],
  ])('%s state is refused', async (_n, make) => {
    const res = await callback({ state: make(), id_token: idToken('n') });
    expect(res.location).toBe('https://jobblo.no/login?error=apple_invalid_state');
    expect(MobileOAuthCode.create).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe('web callback', () => {
  test('a valid form_post from the browser that started it sets auth cookies and lands on /oauth-success (no token in URL)', async () => {
    const { res: startRes, params } = start('web', {});
    const binding = startRes.cookies.jobblo_apple_web.value;
    const setCookies = jest.fn();
    const res = makeRes();
    res.cookie = (name, value) => setCookies(name, value);
    await apple.appleWebCallback(req({ body: { state: params.get('state'), id_token: idToken(params.get('nonce')) }, cookies: { jobblo_apple_web: binding } }), res);
    expect(res.statusCode).toBe(303);
    expect(res.location).toBe('https://jobblo.no/oauth-success');
    expect(createSession).toHaveBeenCalledWith(expect.anything(), 'new-user');
    expect(setCookies).toHaveBeenCalledWith('refreshToken', 'rt');
    expect(res.cleared).toContain('jobblo_apple_web');
    expect(MobileOAuthCode.create).not.toHaveBeenCalled();
  });

  test.each([
    ['no binding cookie (replayed into another browser: login CSRF)', undefined],
    ['a different browser’s cookie', 'someone-else'],
  ])('%s is refused', async (_n, cookie) => {
    const { params } = start('web', {});
    const res = await callback({ state: params.get('state'), id_token: idToken(params.get('nonce')) }, cookie ? { jobblo_apple_web: cookie } : {});
    expect(res.location).toBe('https://jobblo.no/login?error=apple_invalid_state');
    expect(createSession).not.toHaveBeenCalled();
  });
});

test('native endpoint still verifies against the bundle id', async () => {
  const raw = crypto.randomBytes(32).toString('hex');
  const res = makeRes();
  await apple.appleNativeSignIn({ body: { identityToken: idToken(sha(raw), { aud: 'com.jobblo.app' }), rawNonce: raw }, headers: {}, get: () => '' }, res);
  expect(res.statusCode).toBe(200);
  const wrong = makeRes();
  await apple.appleNativeSignIn({ body: { identityToken: idToken(sha(raw)), rawNonce: raw }, headers: {}, get: () => '' }, wrong);
  expect(wrong.statusCode).toBe(401); // a Services-ID token is not an iOS-app token
});

test('the callback is mounted before the CSRF origin guard (Apple posts cross-site)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  expect(src.indexOf("app.post('/api/auth/apple/callback'")).toBeGreaterThan(-1);
  expect(src.indexOf("app.post('/api/auth/apple/callback'")).toBeLessThan(src.indexOf('createCsrfOriginGuard(origins)'));
});
