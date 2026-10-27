/**
 * E-mail verification (security review A5 pre-hijack).
 *  - register signs in straight away (201) and mails a verify-email code in the background;
 *    a taken address is 400 "E-post er allerede registrert" (accepted enumeration trade-off)
 *  - login does not care whether the e-mail is confirmed
 *  - the signed-in user confirms it from the profile: POST /email/send-code + /email/verify
 *  - the owner profile reports emailVerified (legacy pre-cutoff accounts: true)
 *  - legacy verify-email still checks a verify-email code (never a reset code)
 *  - payout onboarding and BankID refuse unverified post-cutoff accounts
 *  - providers asserting the account's address stamp emailVerifiedAt
 * Models mocked; real controllers.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

jest.mock('../models/User', () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  deleteOne: jest.fn(),
}));
jest.mock('../models/Session', () => ({ deleteMany: jest.fn() }));
jest.mock('../models/IdentityClaim', () => ({ deleteMany: jest.fn() }));
jest.mock('../utils/emailService', () => ({
  sendOtpEmail: jest.fn(),
  queueSecurityAlertEmail: jest.fn(),
}));
jest.mock('../utils/tokenUtils', () => ({
  generateTokens: jest.fn(),
  verifyToken: jest.fn(),
  createSession: jest.fn(async () => ({ accessToken: 'at', refreshToken: 'rt' })),
}));
jest.mock('../config/iduraClient', () => ({
  isIduraConfigured: () => true,
  createTransactionSecrets: jest.fn(),
  buildAuthorizationUrl: jest.fn(),
  exchangeCode: jest.fn(),
}));

const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Session = require('../models/Session');
const { sendOtpEmail } = require('../utils/emailService');
const { createSession } = require('../utils/tokenUtils');
const {
  register,
  login,
  verifyEmail,
  resendVerification,
  sendEmailCode,
  confirmEmailCode,
} = require('../controllers/auth/loginController');
const { sanitizeUser } = require('../controllers/auth/authHelpers');
const { sanitizeUserOwner, OWN_USER_SELECT } = require('../utils/userProjections');
const { verifyOtp } = require('../controllers/auth/passwordController');
const { sha256 } = require('../controllers/auth/authHelpers');
const { resolveOAuthLogin } = require('../utils/oauthLinking');
const { startIduraAuth } = require('../controllers/iduraAuthController');

const mkRes = () => ({
  code: 200,
  body: null,
  location: null,
  status(c) {
    this.code = c;
    return this;
  },
  json(b) {
    this.body = b;
    return this;
  },
  cookie() {
    return this;
  },
  set() {
    return this;
  },
  redirect(url) {
    this.location = url;
    return this;
  },
});
const selectable = (row) => ({ select: async () => row });
const HASH = bcrypt.hashSync('Passord123', 4);
const NEW = new Date('2026-11-01'); // after EMAIL_PROOF_CUTOFF
const LEGACY = new Date('2026-01-01');
let n = 0;
const mail = () => `kari${++n}@example.test`;
const signUp = (email, extra = {}) => ({
  body: {
    name: 'Kari',
    lastName: 'N',
    email,
    password: 'Passord123',
    acceptedTerms: true,
    ...extra,
  },
  headers: {},
});
const run = async (handler, req) => {
  const res = mkRes();
  await handler({ headers: {}, ip: '203.0.113.5', ...req }, res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  User.updateOne.mockResolvedValue({ modifiedCount: 1 });
});

describe('register', () => {
  it('creates the account, signs in at once (201) and mails a verify-email code in the background', async () => {
    const email = mail();
    User.findOne.mockReturnValue(selectable(null));
    User.create.mockImplementation(async (d) => ({ _id: 'new1', createdAt: NEW, ...d }));
    const res = await run(register, signUp(email));
    expect(res.code).toBe(201);
    expect(res.body.accessToken).toBe('at');
    expect(res.body.user).toMatchObject({ email, emailVerified: false });
    expect(res.body.user.password).toBeUndefined();
    expect(createSession).toHaveBeenCalledWith(expect.anything(), 'new1');
    expect(User.create.mock.calls[0][0].emailVerifiedAt).toBeUndefined();
    await new Promise(setImmediate);
    expect(User.updateOne.mock.calls[0][1].$set.otpPurpose).toBe('verify-email');
    expect(sendOtpEmail).toHaveBeenCalledWith(
      email,
      expect.stringMatching(/^\d{6}$/),
      'Kari',
      'verify-email'
    );
  });

  it('a failing verification mail does not undo the sign-up', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    User.findOne.mockReturnValue(selectable(null));
    User.create.mockImplementation(async (d) => ({ _id: 'new3', createdAt: NEW, ...d }));
    sendOtpEmail.mockRejectedValueOnce(new Error('smtp down'));
    const res = await run(register, signUp(mail()));
    await new Promise(setImmediate);
    expect(res.code).toBe(201);
    expect(User.deleteOne).not.toHaveBeenCalled();
  });

  it('a taken address is refused and nothing about the account changes', async () => {
    User.findOne.mockReturnValue(selectable({ _id: 'old1' }));
    const res = await run(register, signUp(mail()));
    expect(res.code).toBe(400);
    expect(res.body).toEqual({ error: 'E-post er allerede registrert' });
    expect(User.create).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });

  it('losing the race on the unique index gives the same answer', async () => {
    User.findOne.mockReturnValue(selectable(null));
    User.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    const res = await run(register, signUp(mail()));
    expect(res.code).toBe(400);
    expect(res.body).toEqual({ error: 'E-post er allerede registrert' });
  });

  it('mails one address at most 5 times an hour (legacy resend)', async () => {
    const email = mail();
    User.findOne.mockReturnValue(selectable({ _id: 'pend2', email, name: 'X', createdAt: NEW }));
    for (let i = 0; i < 7; i += 1)
      expect((await run(resendVerification, { body: { email } })).code).toBe(200);
    expect(sendOtpEmail).toHaveBeenCalledTimes(5);
  });
});

describe('login', () => {
  it('an unverified post-cutoff account logs in normally', async () => {
    const email = mail();
    User.findOne.mockReturnValue(
      selectable({
        _id: 'u1',
        email,
        name: 'K',
        password: HASH,
        accountStatus: 'active',
        createdAt: NEW,
      })
    );
    const res = await run(login, { body: { email, password: 'Passord123' } });
    expect(res.code).toBe(200);
    expect(res.body.accessToken).toBe('at');
    expect(res.body.user.emailVerified).toBe(false);
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });

  it('a legacy account without emailVerifiedAt counts as confirmed', async () => {
    const email = mail();
    User.findOne.mockReturnValue(
      selectable({ _id: 'u2', email, password: HASH, accountStatus: 'active', createdAt: LEGACY })
    );
    const res = await run(login, { body: { email, password: 'Passord123' } });
    expect(res.code).toBe(200);
    expect(res.body.user.emailVerified).toBe(true);
  });

  it('wrong password is still just 401', async () => {
    const email = mail();
    User.findOne.mockReturnValue(
      selectable({ _id: 'u3', email, password: HASH, accountStatus: 'active', createdAt: NEW })
    );
    const res = await run(login, { body: { email, password: 'Feil12345' } });
    expect(res.code).toBe(401);
  });
});

describe('confirming the e-mail from the profile (signed in)', () => {
  const me = (extra = {}) => ({ _id: 'me1', email: mail(), name: 'K', createdAt: NEW, ...extra });

  it('send-code mails a verify-email code to the account\u2019s own address', async () => {
    const user = me();
    User.findById.mockReturnValue(selectable(user));
    const res = await run(sendEmailCode, {
      userId: 'me1',
      body: { email: 'attacker@example.test' },
    });
    expect(res.code).toBe(200);
    expect(sendOtpEmail).toHaveBeenCalledWith(
      user.email,
      expect.stringMatching(/^\d{6}$/),
      'K',
      'verify-email'
    );
    expect(User.updateOne.mock.calls[0][1].$set.otpPurpose).toBe('verify-email');
  });

  it('send-code: 409 when already confirmed (or legacy), 429 past the hourly cap', async () => {
    User.findById.mockReturnValue(selectable(me({ emailVerifiedAt: NEW })));
    expect((await run(sendEmailCode, { userId: 'me1' })).code).toBe(409);
    User.findById.mockReturnValue(selectable(me({ createdAt: LEGACY })));
    expect((await run(sendEmailCode, { userId: 'me1' })).code).toBe(409);
    const user = me();
    User.findById.mockReturnValue(selectable(user));
    const codes = [];
    for (let i = 0; i < 6; i += 1) codes.push((await run(sendEmailCode, { userId: 'me1' })).code);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('verify: the right code stamps emailVerifiedAt and nothing else (no password, no BankID `verified`)', async () => {
    User.findById.mockReturnValue(selectable(me()));
    User.findOneAndUpdate.mockImplementation(() => ({
      select: async () => ({ _id: 'me1', passwordResetToken: sha256('123456') }),
    }));
    const res = await run(confirmEmailCode, { userId: 'me1', body: { code: '123456' } });
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ emailVerified: true });
    expect(User.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
      _id: 'me1',
      otpPurpose: 'verify-email',
    });
    const [filter, update] = User.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: 'me1' });
    expect(Object.keys(update.$set)).toEqual(['emailVerifiedAt']);
    expect(update.$unset).toMatchObject({ passwordResetToken: 1 });
    expect(createSession).not.toHaveBeenCalled();
  });

  it('verify: a wrong or malformed code changes nothing', async () => {
    User.findById.mockReturnValue(selectable(me()));
    User.findOneAndUpdate.mockImplementation(() => ({
      select: async () => ({ _id: 'me1', passwordResetToken: sha256('999999') }),
    }));
    expect((await run(confirmEmailCode, { userId: 'me1', body: { code: '123456' } })).code).toBe(
      400
    );
    expect((await run(confirmEmailCode, { userId: 'me1', body: { code: { $ne: 1 } } })).code).toBe(
      400
    );
    expect(User.updateOne.mock.calls.some(([, u]) => u.$set?.emailVerifiedAt)).toBe(false);
  });

  it('both endpoints need a signed-in user', () => {
    const router = require('../routes/auth');
    const { authenticate } = require('../middleware/auth');
    for (const path of ['/email/send-code', '/email/verify']) {
      const layer = router.stack.find((l) => l.route?.path === path && l.route.methods.post);
      expect(layer.route.stack[0].handle).toBe(authenticate);
    }
  });
});

describe('owner profile reports emailVerified (separate from BankID `verified`)', () => {
  it('false for an unconfirmed post-cutoff account, true when confirmed or legacy; `verified` untouched', () => {
    expect(OWN_USER_SELECT.split(' ')).toContain('emailVerifiedAt');
    expect(sanitizeUserOwner({ _id: 'a', createdAt: NEW, verified: true })).toMatchObject({
      emailVerified: false,
      verified: true,
    });
    expect(
      sanitizeUserOwner({ _id: 'b', createdAt: NEW, emailVerifiedAt: NEW, verified: false })
    ).toMatchObject({ emailVerified: true, verified: false });
    expect(sanitizeUserOwner({ _id: 'c', createdAt: LEGACY }).emailVerified).toBe(true);
    expect(sanitizeUser({ _id: 'd', createdAt: NEW }).emailVerified).toBe(false);
  });
});

describe('verify-email', () => {
  const pendingRow = (email, code = '123456') => ({
    _id: 'p1',
    email,
    passwordResetToken: sha256(code),
    passwordResetAttempts: 1,
  });
  const account = (email, extra = {}) => ({
    _id: 'p1',
    email,
    name: 'K',
    password: HASH,
    accountStatus: 'active',
    createdAt: NEW,
    oauthProviders: [],
    set(v) {
      Object.assign(this, v);
    },
    ...extra,
  });

  it('a right code verifies the address and signs in, like the old register response', async () => {
    const email = mail();
    User.findOneAndUpdate.mockImplementation(() => ({ select: async () => pendingRow(email) }));
    User.findById.mockReturnValue(selectable(account(email)));
    const res = await run(verifyEmail, { body: { email, code: '123456', password: 'Passord123' } });
    expect(res.code).toBe(200);
    expect(res.body.accessToken).toBe('at');
    expect(res.body.user.password).toBeUndefined();
    expect(User.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
      email,
      otpPurpose: 'verify-email',
    });
    const update = User.updateOne.mock.calls[0][1];
    expect(update.$set.emailVerifiedAt).toBeInstanceOf(Date);
    expect(update.$set.password).toBeUndefined(); // same password: kept
    expect(update.$unset).toMatchObject({ passwordResetToken: 1, otpPurpose: 1 });
    expect(createSession).toHaveBeenCalled();
  });

  it('a wrong code neither verifies nor signs in', async () => {
    const email = mail();
    User.findOneAndUpdate.mockImplementation(() => ({
      select: async () => pendingRow(email, '999999'),
    }));
    const res = await run(verifyEmail, { body: { email, code: '123456', password: 'Passord123' } });
    expect(res.code).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
    expect(User.updateOne.mock.calls.some(([, u]) => u.$set?.emailVerifiedAt)).toBe(false);
  });

  it('when someone else registered the address first, the mailbox owner’s password replaces theirs', async () => {
    const email = mail();
    User.findOneAndUpdate.mockImplementation(() => ({ select: async () => pendingRow(email) }));
    User.findById.mockReturnValue(
      selectable(account(email, { oauthProviders: [{ provider: 'google', providerId: 'x' }] }))
    );
    const res = await run(verifyEmail, {
      body: { email, code: '123456', password: 'Eierens1Passord' },
    });
    expect(res.code).toBe(200);
    const { $set } = User.updateOne.mock.calls[0][1];
    expect(await bcrypt.compare('Eierens1Passord', $set.password)).toBe(true);
    expect($set.oauthProviders).toEqual([]);
    expect(Session.deleteMany).toHaveBeenCalledWith({ userId: 'p1' });
  });

  it('an already-verified account can never be changed through verify-email', async () => {
    const email = mail();
    User.findOneAndUpdate.mockImplementation(() => ({ select: async () => pendingRow(email) }));
    User.findById.mockReturnValue(selectable(account(email, { emailVerifiedAt: new Date() })));
    const res = await run(verifyEmail, {
      body: { email, code: '123456', password: 'Angriper1Passord' },
    });
    expect(res.code).toBe(400);
    expect(User.updateOne.mock.calls.some(([, u]) => u.$set?.password)).toBe(false);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('the password-reset check never accepts a verify-email code (separate purposes)', async () => {
    User.findOneAndUpdate.mockImplementation(() => ({ select: async () => null }));
    await run(verifyOtp, { body: { email: mail(), otp: '123456' } });
    expect(User.findOneAndUpdate.mock.calls[0][0].otpPurpose).toBeNull();
  });
});

describe('an unverified e-mail locks nothing (it only backs account recovery)', () => {
  it('the Connect onboarding routes have no e-mail gate', () => {
    const router = require('../routes/connect');
    const names = (path) =>
      router.stack.find((l) => l.route?.path === path).route.stack.map((s) => s.handle.name);
    expect(names('/account')).not.toContain('requireVerifiedEmail');
    expect(names('/account-link')).not.toContain('requireVerifiedEmail');
  });

  it('BankID start does not send an unverified account back', async () => {
    const res = mkRes();
    await startIduraAuth({ session: {}, userId: 'u9', user: { _id: 'u9', createdAt: NEW } }, res);
    expect(res.location || '').not.toMatch(/email_not_verified/);
  });
});

describe('OAuth sign-in', () => {
  it('a provider-verified e-mail stamps emailVerifiedAt on the linked account', async () => {
    const user = { _id: 'g1', email: 'g@example.test' };
    User.findOne.mockResolvedValue(user);
    const out = await resolveOAuthLogin({
      provider: 'google',
      providerId: 'sub1',
      email: 'G@example.test',
      emailVerified: true,
    });
    expect(out.outcome).toBe('login');
    expect(User.updateOne).toHaveBeenCalledWith(
      { _id: 'g1' },
      { $set: { emailVerifiedAt: expect.any(Date) } }
    );
  });

  it('an unverified or different provider e-mail stamps nothing', async () => {
    User.findOne.mockResolvedValue({ _id: 'g2', email: 'g2@example.test' });
    await resolveOAuthLogin({
      provider: 'vipps',
      providerId: 'sub2',
      email: 'g2@example.test',
      emailVerified: undefined,
    });
    await resolveOAuthLogin({
      provider: 'vipps',
      providerId: 'sub2',
      email: 'other@example.test',
      emailVerified: true,
    });
    expect(User.updateOne).not.toHaveBeenCalled();
  });
});
