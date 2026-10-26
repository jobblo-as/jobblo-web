/**
 * E-mail verification at sign-up (security review A5 pre-hijack, P3 "Email already exists").
 *  - register answers 202 { verificationRequired } for new AND taken addresses, never signs in
 *  - the owner of a taken address gets a code (unverified) or a notice (verified), nothing else
 *  - verify-email checks a verify-email code (never a reset code) and then signs in
 *  - password login, payout onboarding and BankID refuse unverified post-cutoff accounts;
 *    accounts from before EMAIL_PROOF_CUTOFF are never locked out
 *  - providers asserting the account's address stamp emailVerifiedAt
 * Models mocked; real controllers.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

jest.mock('../models/User', () => ({
  findOne: jest.fn(), findById: jest.fn(), create: jest.fn(), updateOne: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn(),
}));
jest.mock('../models/Session', () => ({ deleteMany: jest.fn() }));
jest.mock('../models/IdentityClaim', () => ({ deleteMany: jest.fn() }));
jest.mock('../utils/emailService', () => ({ sendOtpEmail: jest.fn(), queueSecurityAlertEmail: jest.fn() }));
jest.mock('../utils/tokenUtils', () => ({ generateTokens: jest.fn(), verifyToken: jest.fn(), createSession: jest.fn(async () => ({ accessToken: 'at', refreshToken: 'rt' })) }));
jest.mock('../config/iduraClient', () => ({ isIduraConfigured: () => true, createTransactionSecrets: jest.fn(), buildAuthorizationUrl: jest.fn(), exchangeCode: jest.fn() }));

const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Session = require('../models/Session');
const { sendOtpEmail, queueSecurityAlertEmail } = require('../utils/emailService');
const { createSession } = require('../utils/tokenUtils');
const { register, login, verifyEmail, resendVerification } = require('../controllers/auth/loginController');
const { verifyOtp } = require('../controllers/auth/passwordController');
const { sha256 } = require('../controllers/auth/authHelpers');
const { requireVerifiedEmail } = require('../middleware/auth');
const { resolveOAuthLogin } = require('../utils/oauthLinking');
const { startIduraAuth } = require('../controllers/iduraAuthController');

const mkRes = () => ({
  code: 200, body: null, location: null,
  status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; },
  cookie() { return this; }, set() { return this; }, redirect(url) { this.location = url; return this; },
});
const selectable = (row) => ({ select: async () => row });
const HASH = bcrypt.hashSync('Passord123', 4);
const NEW = new Date('2026-11-01'); // after EMAIL_PROOF_CUTOFF
const LEGACY = new Date('2026-01-01');
let n = 0;
const mail = () => `kari${++n}@example.test`;
const signUp = (email, extra = {}) => ({ body: { name: 'Kari', lastName: 'N', email, password: 'Passord123', acceptedTerms: true, ...extra }, headers: {} });
const run = async (handler, req) => { const res = mkRes(); await handler({ headers: {}, ip: '203.0.113.5', ...req }, res); return res; };

beforeEach(() => {
  jest.clearAllMocks();
  User.updateOne.mockResolvedValue({ modifiedCount: 1 });
});

describe('register', () => {
  it('creates the account unverified, mails a verify-email code and does not sign in', async () => {
    const email = mail();
    User.findOne.mockReturnValue(selectable(null));
    User.create.mockImplementation(async (d) => ({ _id: 'new1', createdAt: NEW, ...d }));
    const res = await run(register, signUp(email));
    expect(res.code).toBe(202);
    expect(res.body).toMatchObject({ verificationRequired: true });
    expect(res.body.user).toBeUndefined();
    expect(res.body.accessToken).toBeUndefined();
    expect(createSession).not.toHaveBeenCalled();
    expect(User.create.mock.calls[0][0].emailVerifiedAt).toBeUndefined();
    expect(User.updateOne.mock.calls[0][1].$set.otpPurpose).toBe('verify-email');
    expect(sendOtpEmail).toHaveBeenCalledWith(email, expect.stringMatching(/^\d{6}$/), 'Kari', 'verify-email');
  });

  it('a taken, verified address gets the identical answer; its owner gets a notice, no code', async () => {
    User.findOne.mockReturnValue(selectable(null));
    User.create.mockImplementation(async (d) => ({ _id: 'new2', createdAt: NEW, ...d }));
    const fresh = await run(register, signUp(mail()));

    const email = mail();
    User.findOne.mockReturnValue(selectable({ _id: 'old1', email, name: 'Owner', emailVerifiedAt: LEGACY, createdAt: NEW }));
    jest.clearAllMocks();
    const taken = await run(register, signUp(email));
    expect(taken.code).toBe(fresh.code);
    expect(taken.body).toEqual(fresh.body);
    expect(User.create).not.toHaveBeenCalled();
    expect(User.updateOne).not.toHaveBeenCalled(); // the existing account is untouched
    expect(sendOtpEmail).not.toHaveBeenCalled();
    expect(queueSecurityAlertEmail).toHaveBeenCalledWith(email, expect.any(String), expect.stringContaining('Noen prøvde'));
  });

  it('a legacy (pre-cutoff) account counts as verified: notice, not a code', async () => {
    const email = mail();
    User.findOne.mockReturnValue(selectable({ _id: 'old2', email, name: 'Owner', createdAt: LEGACY }));
    const res = await run(register, signUp(email));
    expect(res.code).toBe(202);
    expect(sendOtpEmail).not.toHaveBeenCalled();
    expect(queueSecurityAlertEmail).toHaveBeenCalled();
  });

  it('a taken, still-unverified address gets a fresh code instead', async () => {
    const email = mail();
    User.findOne.mockReturnValue(selectable({ _id: 'pend1', email, name: 'First', createdAt: NEW }));
    const res = await run(register, signUp(email));
    expect(res.code).toBe(202);
    expect(sendOtpEmail).toHaveBeenCalledWith(email, expect.stringMatching(/^\d{6}$/), 'First', 'verify-email');
    expect(queueSecurityAlertEmail).not.toHaveBeenCalled();
  });

  it('mails one address at most 5 times an hour', async () => {
    const email = mail();
    User.findOne.mockReturnValue(selectable({ _id: 'pend2', email, name: 'X', createdAt: NEW }));
    for (let i = 0; i < 7; i += 1) expect((await run(resendVerification, { body: { email } })).code).toBe(200);
    expect(sendOtpEmail).toHaveBeenCalledTimes(5);
  });
});

describe('login', () => {
  it('refuses an unverified post-cutoff account with EMAIL_NOT_VERIFIED and mails a code', async () => {
    const email = mail();
    User.findOne.mockReturnValue(selectable({ _id: 'u1', email, name: 'K', password: HASH, accountStatus: 'active', createdAt: NEW }));
    const res = await run(login, { body: { email, password: 'Passord123' } });
    expect(res.code).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(createSession).not.toHaveBeenCalled();
    expect(sendOtpEmail).toHaveBeenCalledWith(email, expect.any(String), 'K', 'verify-email');
  });

  it('never locks out a legacy account without emailVerifiedAt', async () => {
    const email = mail();
    User.findOne.mockReturnValue(selectable({ _id: 'u2', email, password: HASH, accountStatus: 'active', createdAt: LEGACY }));
    const res = await run(login, { body: { email, password: 'Passord123' } });
    expect(res.code).toBe(200);
    expect(res.body.accessToken).toBe('at');
  });

  it('wrong password on an unverified account is still just 401 (reveals nothing)', async () => {
    const email = mail();
    User.findOne.mockReturnValue(selectable({ _id: 'u3', email, password: HASH, accountStatus: 'active', createdAt: NEW }));
    const res = await run(login, { body: { email, password: 'Feil12345' } });
    expect(res.code).toBe(401);
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });
});

describe('verify-email', () => {
  const pendingRow = (email, code = '123456') => ({ _id: 'p1', email, passwordResetToken: sha256(code), passwordResetAttempts: 1 });
  const account = (email, extra = {}) => ({
    _id: 'p1', email, name: 'K', password: HASH, accountStatus: 'active', createdAt: NEW, oauthProviders: [],
    set(v) { Object.assign(this, v); }, ...extra,
  });

  it('a right code verifies the address and signs in, like the old register response', async () => {
    const email = mail();
    User.findOneAndUpdate.mockImplementation(() => ({ select: async () => pendingRow(email) }));
    User.findById.mockReturnValue(selectable(account(email)));
    const res = await run(verifyEmail, { body: { email, code: '123456', password: 'Passord123' } });
    expect(res.code).toBe(200);
    expect(res.body.accessToken).toBe('at');
    expect(res.body.user.password).toBeUndefined();
    expect(User.findOneAndUpdate.mock.calls[0][0]).toMatchObject({ email, otpPurpose: 'verify-email' });
    const update = User.updateOne.mock.calls[0][1];
    expect(update.$set.emailVerifiedAt).toBeInstanceOf(Date);
    expect(update.$set.password).toBeUndefined(); // same password: kept
    expect(update.$unset).toMatchObject({ passwordResetToken: 1, otpPurpose: 1 });
    expect(createSession).toHaveBeenCalled();
  });

  it('a wrong code neither verifies nor signs in', async () => {
    const email = mail();
    User.findOneAndUpdate.mockImplementation(() => ({ select: async () => pendingRow(email, '999999') }));
    const res = await run(verifyEmail, { body: { email, code: '123456', password: 'Passord123' } });
    expect(res.code).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
    expect(User.updateOne.mock.calls.some(([, u]) => u.$set?.emailVerifiedAt)).toBe(false);
  });

  it('when someone else registered the address first, the mailbox owner’s password replaces theirs', async () => {
    const email = mail();
    User.findOneAndUpdate.mockImplementation(() => ({ select: async () => pendingRow(email) }));
    User.findById.mockReturnValue(selectable(account(email, { oauthProviders: [{ provider: 'google', providerId: 'x' }] })));
    const res = await run(verifyEmail, { body: { email, code: '123456', password: 'Eierens1Passord' } });
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
    const res = await run(verifyEmail, { body: { email, code: '123456', password: 'Angriper1Passord' } });
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

describe('payout onboarding and BankID need a verified e-mail', () => {
  const gate = (user) => { const res = mkRes(); const next = jest.fn(); requireVerifiedEmail({ user }, res, next); return { res, next }; };

  it('requireVerifiedEmail: 403 for unverified post-cutoff, through for verified and legacy', () => {
    const blocked = gate({ _id: 'a', createdAt: NEW });
    expect(blocked.res.code).toBe(403);
    expect(blocked.res.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(blocked.next).not.toHaveBeenCalled();
    expect(gate({ _id: 'b', createdAt: NEW, emailVerifiedAt: NEW }).next).toHaveBeenCalled();
    expect(gate({ _id: 'c', createdAt: LEGACY }).next).toHaveBeenCalled();
  });

  it('the Connect onboarding routes carry the gate', () => {
    const router = require('../routes/connect');
    const handlers = (path) => router.stack.find((l) => l.route?.path === path).route.stack.map((s) => s.handle);
    expect(handlers('/account')).toContain(requireVerifiedEmail);
    expect(handlers('/account-link')).toContain(requireVerifiedEmail);
  });

  it('BankID start sends an unverified account back with bankid_email_not_verified', async () => {
    const res = mkRes();
    await startIduraAuth({ session: {}, userId: 'u9', user: { _id: 'u9', createdAt: NEW } }, res);
    expect(res.location).toMatch(/profile\?error=bankid_email_not_verified$/);
  });
});

describe('OAuth sign-in', () => {
  it('a provider-verified e-mail stamps emailVerifiedAt on the linked account', async () => {
    const user = { _id: 'g1', email: 'g@example.test' };
    User.findOne.mockResolvedValue(user);
    const out = await resolveOAuthLogin({ provider: 'google', providerId: 'sub1', email: 'G@example.test', emailVerified: true });
    expect(out.outcome).toBe('login');
    expect(User.updateOne).toHaveBeenCalledWith({ _id: 'g1' }, { $set: { emailVerifiedAt: expect.any(Date) } });
  });

  it('an unverified or different provider e-mail stamps nothing', async () => {
    User.findOne.mockResolvedValue({ _id: 'g2', email: 'g2@example.test' });
    await resolveOAuthLogin({ provider: 'vipps', providerId: 'sub2', email: 'g2@example.test', emailVerified: undefined });
    await resolveOAuthLogin({ provider: 'vipps', providerId: 'sub2', email: 'other@example.test', emailVerified: true });
    expect(User.updateOne).not.toHaveBeenCalled();
  });
});
