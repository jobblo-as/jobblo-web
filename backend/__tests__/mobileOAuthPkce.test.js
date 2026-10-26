/**
 * P6: the mobile OAuth deep link carries a one-time code redeemable only with the app's PKCE
 * verifier, not an access token any app registering `jobblo://` could use.
 */
jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../models/User', () => ({ findOne: jest.fn(), findById: jest.fn(), create: jest.fn() }));
jest.mock('../models/MobileOAuthCode', () => ({ create: jest.fn(), findOneAndDelete: jest.fn() }));
jest.mock('../utils/tokenUtils', () => ({
  createSession: jest.fn(async () => ({ accessToken: 'h.p.s', refreshToken: 'rt' })),
}));
jest.mock('../utils/oauthLinking', () => ({
  resolveOAuthLogin: jest.fn(async () => ({ outcome: 'login', user: { _id: 'u1' } })),
  findUserByProviderIdentity: jest.fn(),
}));

const crypto = require('crypto');
const axios = require('axios');
const User = require('../models/User');
const MobileOAuthCode = require('../models/MobileOAuthCode');
const { createSession } = require('../utils/tokenUtils');
const oauthReturn = require('../utils/oauthReturn');
const vippsController = require('../controllers/vippsController');

const VERIFIER = 'v'.repeat(20) + crypto.randomBytes(24).toString('base64url');
const CHALLENGE = crypto.createHash('sha256').update(VERIFIER).digest('base64url');
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    cookies: {},
    body: undefined,
    redirectedTo: null,
    set(name, value) {
      if (typeof name === 'object') Object.assign(this.headers, name);
      else this.headers[name] = value;
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
    send(body) {
      this.body = body;
      return this;
    },
    redirect(url) {
      this.redirectedTo = url;
      return this;
    },
  };
}

const OLD_ENV = process.env;
beforeEach(() => {
  jest.clearAllMocks();
  process.env = {
    ...OLD_ENV,
    NODE_ENV: 'test',
    FRONTEND_URL: 'https://jobblo.example',
    MOBILE_RETURN_URL: 'https://api.example',
    MOBILE_APP_LINK_PREFIX: 'jobblo://',
    SESSION_SECRET: 'secret',
    VIPPS_CLIENT_ID: 'cid',
    VIPPS_MOBILE_REDIRECT_URI: 'https://api.example/api/auth/mobile/vipps/callback',
  };
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  process.env = OLD_ENV;
});

/** The one-time code the bridge URL carries, after asserting it carries no token. */
function codeFrom(url) {
  const q = new URL(url).searchParams;
  expect(q.get('token')).toBeNull();
  expect(q.get('state')).toBe('success');
  return q.get('code');
}

describe('readCodeChallenge', () => {
  it('accepts only an S256 challenge of the right shape', () => {
    const q = (query) => oauthReturn.readCodeChallenge({ query });
    expect(q({ code_challenge: CHALLENGE, code_challenge_method: 'S256' })).toBe(CHALLENGE);
    expect(q({ code_challenge: CHALLENGE, code_challenge_method: 'plain' })).toBe('');
    expect(q({ code_challenge: CHALLENGE })).toBe('');
    expect(q({ code_challenge: 'short', code_challenge_method: 'S256' })).toBe('');
  });
});

describe('signedInDestination', () => {
  it('mobile + challenge: issues a hashed 60 s code, no token, no session yet', async () => {
    const res = makeRes();
    const url = await oauthReturn.signedInDestination({
      req: {}, res, platform: 'mobile', userId: 'u1', codeChallenge: CHALLENGE,
    });
    const code = codeFrom(url);
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const doc = MobileOAuthCode.create.mock.calls[0][0];
    expect(doc).toMatchObject({ codeHash: hash(code), userId: 'u1', codeChallenge: CHALLENGE });
    expect(JSON.stringify(doc)).not.toContain(code);
    expect(doc.expiresAt - Date.now()).toBeLessThanOrEqual(60 * 1000);
    expect(createSession).not.toHaveBeenCalled();
    expect(res.cookies).toEqual({});
  });

  it('mobile without challenge (old app builds) still gets the token link', async () => {
    const res = makeRes();
    const url = await oauthReturn.signedInDestination({ req: {}, res, platform: 'mobile', userId: 'u1' });
    expect(new URL(url).searchParams.get('token')).toBe('h.p.s');
    expect(MobileOAuthCode.create).not.toHaveBeenCalled();
  });

  it('web ignores a challenge and keeps cookies + /oauth-success', async () => {
    const res = makeRes();
    const url = await oauthReturn.signedInDestination({
      req: {}, res, platform: 'web', userId: 'u1', codeChallenge: CHALLENGE,
    });
    expect(url).toBe('https://jobblo.example/oauth-success');
    expect(res.cookies.refreshToken).toBe('rt');
  });
});

describe('mobileReturn bridge', () => {
  it('hands the one-time code to the app as ?code=, never as a token', () => {
    const code = crypto.randomBytes(32).toString('base64url');
    const res = makeRes();
    oauthReturn.mobileReturn({ query: { state: 'success', code } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(`href="jobblo://oauth-success?code=${code}"`);
  });
});

describe('exchangeMobileCode', () => {
  const CODE = crypto.randomBytes(32).toString('base64url');
  const exchange = async (body) => {
    const res = makeRes();
    await oauthReturn.exchangeMobileCode({ body, headers: {} }, res);
    return res;
  };

  it('right verifier: consumes the code atomically, creates the session, returns the token', async () => {
    MobileOAuthCode.findOneAndDelete.mockResolvedValue({ userId: 'u1', codeChallenge: CHALLENGE });
    User.findById.mockReturnValue({ select: async () => ({ accountStatus: 'active' }) });
    const res = await exchange({ code: CODE, code_verifier: VERIFIER });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ accessToken: 'h.p.s' });
    expect(res.cookies.refreshToken).toBe('rt');
    const filter = MobileOAuthCode.findOneAndDelete.mock.calls[0][0];
    expect(filter.codeHash).toBe(hash(CODE));
    expect(filter.expiresAt.$gt).toBeInstanceOf(Date);
  });

  it('wrong verifier: 400, no session — and the code is already gone (burned)', async () => {
    MobileOAuthCode.findOneAndDelete.mockResolvedValue({ userId: 'u1', codeChallenge: CHALLENGE });
    const res = await exchange({ code: CODE, code_verifier: 'x'.repeat(43) });
    expect(res.statusCode).toBe(400);
    expect(MobileOAuthCode.findOneAndDelete).toHaveBeenCalledTimes(1);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('used, expired or unknown code: 400', async () => {
    MobileOAuthCode.findOneAndDelete.mockResolvedValue(null);
    expect((await exchange({ code: CODE, code_verifier: VERIFIER })).statusCode).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('malformed input never reaches the database', async () => {
    for (const body of [{}, { code: CODE }, { code: 'abc', code_verifier: VERIFIER }, { code: { $ne: null }, code_verifier: VERIFIER }]) {
      expect((await exchange(body)).statusCode).toBe(400);
    }
    expect(MobileOAuthCode.findOneAndDelete).not.toHaveBeenCalled();
  });

  it('account deactivated since the callback: 403, no session', async () => {
    MobileOAuthCode.findOneAndDelete.mockResolvedValue({ userId: 'u1', codeChallenge: CHALLENGE });
    User.findById.mockReturnValue({ select: async () => ({ accountStatus: 'deactivated' }) });
    expect((await exchange({ code: CODE, code_verifier: VERIFIER })).statusCode).toBe(403);
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe('challenge carried through the provider round-trip', () => {
  it('Google state store keeps it for the callback', () => {
    const { buildGoogleStateStore } = require('../config/passport');
    const store = buildGoogleStateStore('k');
    const req = { session: {}, oauthCodeChallenge: CHALLENGE };
    let state;
    store.store(req, {}, (err, s) => (state = s));
    store.verify(req, state, {}, () => {});
    expect(req.googleOAuthIntent.codeChallenge).toBe(CHALLENGE);
  });

  it('Vipps mobile: start stores it, callback answers with a code', async () => {
    const session = { save: (cb) => cb(null) };
    await vippsController.redirectToVipps(
      { query: { code_challenge: CHALLENGE, code_challenge_method: 'S256' }, session },
      makeRes(),
      { platform: 'mobile' }
    );
    expect(session.vippsAuth.codeChallenge).toBe(CHALLENGE);

    axios.post.mockResolvedValue({ data: { access_token: 'vipps-at' } });
    axios.get.mockResolvedValue({ data: { sub: 's1' } });
    const res = makeRes();
    await vippsController.vippsCallback(
      { query: { code: 'c', state: session.vippsAuth.state }, session },
      res,
      { platform: 'mobile' }
    );
    expect(codeFrom(res.redirectedTo)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('POST /exchange is mounted on the mobile OAuth router', () => {
    const router = require('../routes/mobileOAuth');
    const layer = router.stack.find((l) => l.route?.path === '/exchange');
    expect(layer?.route.methods.post).toBe(true);
  });
});
