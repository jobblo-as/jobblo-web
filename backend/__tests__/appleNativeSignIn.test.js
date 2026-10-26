/**
 * POST /api/auth/apple/native: Apple identity tokens are verified against Apple's JWKS
 * (mocked here with a locally generated RSA key — Apple's servers are never called).
 */
jest.mock('../models/User', () => ({ findOne: jest.fn(), findById: jest.fn(), create: jest.fn() }));
jest.mock('../utils/tokenUtils', () => ({
  createSession: jest.fn(async () => ({ accessToken: 'h.p.s', refreshToken: 'rt' })),
}));
jest.mock('../utils/passwordUtils', () => ({ createUnusablePassword: jest.fn(async () => 'x') }));

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { createSession } = require('../utils/tokenUtils');
const apple = require('../controllers/appleAuthController');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-kid';
const RAW_NONCE = crypto.randomBytes(32).toString('hex');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

function token(overrides = {}, { key = privateKey, kid = KID } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: 'https://appleid.apple.com',
      aud: 'com.jobblo.app',
      sub: '001234.apple.sub',
      iat: now,
      exp: now + 600,
      nonce: sha(RAW_NONCE),
      email: 'abc123@privaterelay.appleid.com',
      email_verified: 'true',
      is_private_email: 'true',
      ...overrides,
    },
    key,
    { algorithm: 'RS256', keyid: kid }
  );
}

function makeRes() {
  return {
    statusCode: 200,
    cookies: {},
    set() {
      return this;
    },
    cookie(name, value) {
      this.cookies[name] = value;
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
  };
}

async function call(body) {
  const res = makeRes();
  await apple.appleNativeSignIn({ body, headers: {}, get: () => '' }, res);
  return res;
}

const selectable = (v) => ({ select: () => Promise.resolve(v), then: (r, j) => Promise.resolve(v).then(r, j) });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  apple._resetAppleKeyCache();
  delete process.env.APPLE_BUNDLE_ID; // default comes from jobblo-app/app.json (com.jobblo.app)
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }] }),
  }));
  User.findOne.mockImplementation(() => selectable(null));
  User.create.mockImplementation(async (doc) => ({ _id: 'new-user', ...doc }));
});

test('valid token for a new Apple identity creates the user and returns an access token', async () => {
  const res = await call({ identityToken: token(), rawNonce: RAW_NONCE, fullName: { givenName: 'Kari', familyName: 'Nordmann' } });
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ accessToken: 'h.p.s' });
  expect(res.cookies.refreshToken).toBe('rt');
  expect(User.create).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'Kari',
      lastName: 'Nordmann',
      email: 'abc123@privaterelay.appleid.com',
      oauthProviders: [{ provider: 'apple', providerId: '001234.apple.sub' }],
    })
  );
  expect(createSession).toHaveBeenCalledWith(expect.anything(), 'new-user');
  expect(global.fetch).toHaveBeenCalledWith('https://appleid.apple.com/auth/keys', expect.anything());
});

test('existing Apple user is reused, not recreated, and the JWKS is cached', async () => {
  const existing = { _id: 'apple-user', oauthProviders: [{ provider: 'apple', providerId: '001234.apple.sub' }] };
  User.findOne.mockImplementation((q) => selectable(q.oauthProviders ? existing : null));
  const first = await call({ identityToken: token(), rawNonce: RAW_NONCE });
  const second = await call({ identityToken: token(), rawNonce: RAW_NONCE });
  expect(first.statusCode).toBe(200);
  expect(second.statusCode).toBe(200);
  expect(User.create).not.toHaveBeenCalled();
  expect(createSession).toHaveBeenCalledWith(expect.anything(), 'apple-user');
  expect(User.findOne).toHaveBeenCalledWith({
    oauthProviders: { $elemMatch: { provider: 'apple', providerId: '001234.apple.sub' } },
  });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('an e-mail already owned by another account is refused, never linked', async () => {
  User.findOne.mockImplementation((q) => selectable(q.email ? { _id: 'password-user' } : null));
  const res = await call({ identityToken: token(), rawNonce: RAW_NONCE });
  expect(res.statusCode).toBe(409);
  expect(res.body.code).toBe('apple_account_exists');
  expect(createSession).not.toHaveBeenCalled();
});

test.each([
  ['wrong audience', () => token({ aud: 'com.evil.app' })],
  ['wrong issuer', () => token({ iss: 'https://evil.example' })],
  ['expired', () => token({ iat: 1000, exp: 2000 })],
  ['nonce mismatch', () => token({ nonce: sha('some other nonce value') })],
  ['missing nonce', () => token({ nonce: undefined })],
  ['signed by another key', () => token({}, { key: other.privateKey })],
  ['unknown kid', () => token({}, { kid: 'nope' })],
  ['HS256 forgery', () => jwt.sign({ iss: 'https://appleid.apple.com', aud: 'com.jobblo.app', sub: 's', nonce: sha(RAW_NONCE) }, 'secret', { keyid: KID })],
])('refuses %s', async (_name, make) => {
  const res = await call({ identityToken: make(), rawNonce: RAW_NONCE });
  expect(res.statusCode).toBe(401);
  expect(res.body.code).toBe('apple_invalid_token');
  expect(createSession).not.toHaveBeenCalled();
  expect(User.create).not.toHaveBeenCalled();
});

test('APPLE_BUNDLE_ID overrides the app.json default', async () => {
  process.env.APPLE_BUNDLE_ID = 'com.jobblo.staging';
  expect((await call({ identityToken: token(), rawNonce: RAW_NONCE })).statusCode).toBe(401);
  expect((await call({ identityToken: token({ aud: 'com.jobblo.staging' }), rawNonce: RAW_NONCE })).statusCode).toBe(200);
});

test('malformed bodies are a 400', async () => {
  expect((await call({})).statusCode).toBe(400);
  expect((await call({ identityToken: token(), rawNonce: 'short' })).statusCode).toBe(400);
  expect((await call({ identityToken: { $ne: 1 }, rawNonce: RAW_NONCE })).statusCode).toBe(400);
});

test('inactive account gets no session', async () => {
  User.findOne.mockImplementation((q) => selectable(q.oauthProviders ? { _id: 'u', accountStatus: 'deactivated' } : null));
  const res = await call({ identityToken: token(), rawNonce: RAW_NONCE });
  expect(res.statusCode).toBe(403);
  expect(createSession).not.toHaveBeenCalled();
});
