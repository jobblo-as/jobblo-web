/**
 * Final auth review (A3-A9, W4, Z4, Z5). A2 lives in p3AccountGuards. Models mocked; real controllers.
 *  A3 current-password guesses are capped per user (e-mail change, self-delete, change password)
 *  A4 every request-path bcrypt goes through the bounded queue (busy -> 503)
 *  A5 first reset of a never-proven e-mail drops payout destination + BankID identity
 *  A6 OTP budget counts misses only, per account + IP
 *  A7 TOTP step / backup code cannot be spent twice in parallel
 *  A8/Z4 nobody changes another user's e-mail via PUT /users/:id; trust flags are audited
 *  A9 20 wrong 2FA codes in 24 h end the session and e-mail the owner
 *  W4 website must be http(s); Z5/I6 user image fields take only our public uploads (never
 *  private-container URLs), service images capped at 6
 */
process.env.AZURE_PRIVATE_CONTAINER = 'evidence';
process.env.AZURE_CONTAINER_NAME = 'bilder-newsub';
process.env.AZURE_STORAGE_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=dGVzdGtleQ==;EndpointSuffix=core.windows.net';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

jest.mock('../models/User', () => ({
  findOne: jest.fn(), findById: jest.fn(), updateOne: jest.fn(), findOneAndUpdate: jest.fn(), findByIdAndUpdate: jest.fn(),
}));
jest.mock('../models/Session', () => ({ deleteMany: jest.fn(), deleteOne: jest.fn(), updateOne: jest.fn(), findById: jest.fn() }));
jest.mock('../models/IdentityClaim', () => ({ deleteMany: jest.fn() }));
jest.mock('../models/Order', () => ({ countDocuments: jest.fn() }));
jest.mock('../models/Service', () => ({}));
jest.mock('../models/JobRequest', () => ({}));
jest.mock('../models/List', () => ({}));
jest.mock('../utils/emailService', () => ({ sendOtpEmail: jest.fn(), sendSecurityAlertEmail: jest.fn(async () => {}) }));
jest.mock('../utils/tokenUtils', () => ({ generateTokens: jest.fn(), verifyToken: jest.fn(), createSession: jest.fn(async () => ({ accessToken: 'a', refreshToken: 'r' })) }));
jest.mock('../services/admin/activityService', () => ({ logActivity: jest.fn(async () => {}) }));

const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Session = require('../models/Session');
const IdentityClaim = require('../models/IdentityClaim');
const { sendSecurityAlertEmail } = require('../utils/emailService');
const { logActivity } = require('../services/admin/activityService');
const { updateUser, deleteUser } = require('../controllers/users/profileController');
const { login } = require('../controllers/auth/loginController');
const { resetPassword, changePasswordSendOtp } = require('../controllers/auth/passwordController');
const { sha256, checkOtp } = require('../controllers/auth/authHelpers');
const { comparePassword, MAX_ACTIVE, MAX_WAITING } = require('../utils/passwordUtils');
const mfa = require('../services/auth/mfa');
const mfaController = require('../controllers/mfaController');
const { normaliseReviewPhotos } = require('../utils/reviewPhotos');

const mkRes = () => ({
  code: 200, body: null, headers: {},
  status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; },
  set(k, v) { this.headers[k] = v; return this; }, cookie() { return this; },
});
const doc = (d) => ({ select: () => ({ lean: async () => d, then: (r, j) => Promise.resolve(d).then(r, j) }), then: (r, j) => Promise.resolve(d).then(r, j) });
const HASH = bcrypt.hashSync('Right-pass1', 4);
const PRIVATE_URL = 'https://acct.blob.core.windows.net/evidence/disputes/proof.jpg';
const OUR_URL = 'https://acct.blob.core.windows.net/bilder-newsub/services/a.jpg';
const EXTERNAL_URL = 'https://tracker.example.com/pixel.jpg';
let n = 0;
const oid = () => `64b0000000000000000${String(++n).padStart(5, '0')}`;

beforeEach(() => jest.clearAllMocks());

describe('A3 current-password guesses are capped per user', () => {
  it('e-mail change: after 10 wrong passwords even the right one gets 429', async () => {
    const id = oid();
    User.findById.mockImplementation(() => doc({ _id: id, email: 'me@x.no', password: HASH }));
    User.findByIdAndUpdate.mockResolvedValue({ _id: id, email: 'new@x.no' });
    const change = async (pw) => { const r = mkRes(); await updateUser({ params: { id }, userId: id, user: { role: 'user' }, body: { email: 'new@x.no', currentPassword: pw } }, r); return r; };
    for (let i = 0; i < 10; i += 1) expect((await change('wrong')).code).toBe(403);
    const r = await change('Right-pass1');
    expect(r.code).toBe(429);
    expect(r.body.code).toBe('PASSWORD_ATTEMPTS');
  }, 20000);

  it('the cap is shared with self-delete and change-password', async () => {
    const id = oid();
    User.findById.mockImplementation(() => doc({ _id: id, email: 'me@x.no', role: 'user', password: HASH }));
    for (let i = 0; i < 10; i += 1) {
      const r = mkRes();
      await deleteUser({ params: { id }, userId: id, user: { role: 'user' }, body: { currentPassword: 'wrong' } }, r);
      expect(r.code).toBe(403);
    }
    const r = mkRes();
    await changePasswordSendOtp({ userId: id, body: { currentPassword: 'Right-pass1' } }, r);
    expect(r.code).toBe(429);
  }, 20000);
});

describe('A4 bcrypt in request paths uses the bounded queue', () => {
  it('login, register and the profile password check answer 503 when the queue is full', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const real = bcrypt.compare;
    let calls = 0;
    const spy = jest.spyOn(bcrypt, 'compare').mockImplementation((...a) => (++calls <= MAX_ACTIVE ? gate.then(() => false) : real(...a)));
    const fillers = Array.from({ length: MAX_ACTIVE + MAX_WAITING }, () => comparePassword('x', HASH));

    User.findOne.mockReturnValue(doc(null));
    const r1 = mkRes();
    await login({ body: { email: 'busy@x.no', password: 'x' }, headers: {}, ip: '1.1.1.1' }, r1);
    const id = oid();
    User.findById.mockImplementation(() => doc({ _id: id, email: 'me@x.no', password: HASH }));
    const r2 = mkRes();
    await updateUser({ params: { id }, userId: id, user: { role: 'user' }, body: { email: 'n@x.no', currentPassword: 'x' } }, r2);
    const r3 = mkRes();
    await require('../controllers/auth/loginController').register({ body: { name: 'A', email: 'reg@x.no', password: 'Abcdefg1', acceptedTerms: true }, headers: {} }, r3);

    release();
    await Promise.all(fillers);
    spy.mockRestore();
    expect([r1.code, r2.code, r3.code]).toEqual([503, 503, 503]);
  }, 30000);
});

describe('A5 first reset of an unproven e-mail drops pre-attached payout + identity', () => {
  const run = async (row) => {
    User.findOne.mockReturnValue(doc(row));
    User.updateOne.mockResolvedValue({ modifiedCount: 1 });
    const r = mkRes();
    await resetPassword({ body: { resetToken: 'tok', password: 'NyttPassord1' } }, r);
    return { r, update: User.updateOne.mock.calls[0][1] };
  };

  it('never-proven: unsets Connect/bank/identity, deletes the claim, says so', async () => {
    const { r, update } = await run({ _id: 'u1', accountStatus: 'verified', identityVerification: { subject: 'attacker' } });
    expect(r.code).toBe(200);
    expect(r.body.payoutAndIdentityReset).toBe(true);
    expect(update.$unset).toMatchObject({ stripeConnectAccountId: 1, stripeConnectAccountIdTest: 1, bankAccountNumber: 1, vippsHandle: 1, identityVerification: 1, passwordResetSessionToken: 1 });
    expect(update.$set).toMatchObject({ payoutEnabled: false, verified: false, accountStatus: 'active' });
    expect(update.$set.emailVerifiedAt).toBeInstanceOf(Date);
    expect(IdentityClaim.deleteMany).toHaveBeenCalledWith({ userId: 'u1' });
  });

  it('an account that existed before email proof was tracked keeps payout and BankID', async () => {
    const { r, update } = await run({ _id: 'u3', createdAt: new Date('2026-01-01'), identityVerification: { subject: 'owner' } });
    expect(r.body.payoutAndIdentityReset).toBe(false);
    expect(update.$unset.stripeConnectAccountId).toBeUndefined();
    expect(IdentityClaim.deleteMany).not.toHaveBeenCalled();
  });

  it('already proven: payout and identity stay', async () => {
    const { r, update } = await run({ _id: 'u2', emailVerifiedAt: new Date() });
    expect(r.body.payoutAndIdentityReset).toBe(false);
    expect(update.$unset.stripeConnectAccountId).toBeUndefined();
    expect(IdentityClaim.deleteMany).not.toHaveBeenCalled();
  });
});

describe('A6 OTP budget: misses only, per account + IP', () => {
  it('20 misses from one IP do not stop the owner on another IP; the guessing IP is stopped', async () => {
    const row = { _id: 'otp1', passwordResetToken: sha256('123456') };
    User.findOneAndUpdate.mockImplementation(() => ({ select: async () => ({ ...row, passwordResetAttempts: 1 }) }));
    User.updateOne.mockResolvedValue({});
    for (let i = 0; i < 20; i += 1) await checkOtp({ email: 'otp@x.no' }, '000000', '6.6.6.6');
    await expect(checkOtp({ email: 'otp@x.no' }, '123456', '6.6.6.6')).resolves.toBeNull();
    await expect(checkOtp({ email: 'otp@x.no' }, '123456', '7.7.7.7')).resolves.toMatchObject({ _id: 'otp1' });
  });

  it('correct codes do not spend the budget', async () => {
    const row = { _id: 'otp2', passwordResetToken: sha256('123456') };
    User.findOneAndUpdate.mockImplementation(() => ({ select: async () => ({ ...row, passwordResetAttempts: 1 }) }));
    for (let i = 0; i < 25; i += 1) await expect(checkOtp({ email: 'otp2@x.no' }, '123456', '8.8.8.8')).resolves.toBeTruthy();
  });
});

describe('A7 a 2FA code cannot be spent twice in parallel', () => {
  // Atomic store: the first conditional update wins, the second matches nothing.
  const atomicUpdate = () => { let spent = false; return async () => { const m = spent ? 0 : 1; spent = true; return { modifiedCount: m }; }; };
  const user = (extra) => ({ _id: 'm1', email: 'a@x.no', role: 'superAdmin', mfaEnabledAt: new Date(), save: jest.fn(async () => {}), ...extra });

  it('backup code', async () => {
    const h = mfa.hashBackup('ABCD-EFGH');
    User.findById.mockImplementation(() => ({ select: async () => user({ mfaBackupCodes: [h, 'other'] }) }));
    User.updateOne.mockImplementation(atomicUpdate());
    const results = await Promise.all([1, 2].map(() => mfa.verify('m1', 's1', { backupCode: 'ABCD-EFGH' })));
    expect(results.filter((x) => x.ok)).toHaveLength(1);
  });

  it('TOTP code', async () => {
    const secret = Buffer.alloc(20, 7);
    const code = mfa.codeAt(secret, Math.floor(Date.now() / 30000));
    User.findById.mockImplementation(() => ({ select: async () => user({ mfaSecret: mfa.encrypt(secret), mfaLastStep: null }) }));
    User.updateOne.mockImplementation(atomicUpdate());
    const results = await Promise.all([1, 2].map(() => mfa.verify('m1', 's1', { code })));
    expect(results.filter((x) => x.ok)).toHaveLength(1);
  });
});

describe('A8/Z4 PUT /users/:id and other users', () => {
  it('a superAdmin cannot change another user\'s e-mail', async () => {
    const id = oid();
    User.findById.mockImplementation(() => doc({ _id: id, email: 'victim@x.no', password: HASH }));
    User.findByIdAndUpdate.mockResolvedValue({});
    const r = mkRes();
    await updateUser({ params: { id }, userId: oid(), user: { _id: 'admin', role: 'superAdmin' }, body: { email: 'attacker@x.no' } }, r);
    expect(r.code).toBe(403);
    expect(r.body.code).toBe('EMAIL_SELF_ONLY');
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('a superAdmin setting verified/isTrusted on someone is audit-logged', async () => {
    const id = oid();
    User.findById.mockImplementation(() => doc({ _id: id, email: 'u@x.no' }));
    User.findByIdAndUpdate.mockResolvedValue({ _id: id });
    const r = mkRes();
    await updateUser({ params: { id }, userId: oid(), user: { _id: 'admin', role: 'superAdmin' }, body: { isTrusted: true }, get: () => 'ua' }, r);
    expect(r.code).toBe(200);
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ adminId: 'admin', targetId: id, metadata: expect.objectContaining({ isTrusted: true }) }));
  });
});

describe('A9 repeated wrong 2FA codes end the session', () => {
  it('the 20th wrong code in 24 h ends the session and e-mails the owner once', async () => {
    const spy = jest.spyOn(mfa, 'verify').mockResolvedValue({ ok: false });
    const req = { user: { _id: 'mfa-user-1', email: 'admin@x.no', mfaEnabledAt: new Date() }, sessionId: 's9', body: { code: '000000' }, ip: '1.2.3.4', get: () => 'ua' };
    const codes = [];
    for (let i = 0; i < 21; i += 1) { const r = mkRes(); await mfaController.verify(req, r); codes.push(r.code); }
    spy.mockRestore();
    expect(codes.slice(0, 19).every((c) => c === 400)).toBe(true);
    expect(codes[19]).toBe(401);
    expect(codes[20]).toBe(401);
    expect(Session.deleteOne).toHaveBeenCalledWith({ _id: 's9', userId: 'mfa-user-1' });
    expect(sendSecurityAlertEmail).toHaveBeenCalledTimes(1);
    expect(sendSecurityAlertEmail.mock.calls[0][0]).toBe('admin@x.no');
  });
});

describe('W4 website must be an http(s) URL', () => {
  const save = async (website) => {
    const id = oid();
    User.findById.mockImplementation(() => doc({ _id: id, email: 'c@x.no' }));
    User.findByIdAndUpdate.mockResolvedValue({ _id: id });
    const r = mkRes();
    await updateUser({ params: { id }, userId: id, user: { role: 'user' }, body: { website } }, r);
    return { r, saved: User.findByIdAndUpdate.mock.calls.at(-1)?.[1] };
  };
  it.each(['javascript:alert(1)', 'data:text/html,x', 'ftp://x.no', 'not a url', `https://x.no/${'a'.repeat(200)}`])('refuses %s', async (w) => {
    expect((await save(w)).r.code).toBe(400);
  });
  it('accepts https and clears with an empty string', async () => {
    expect((await save(' https://firma.no ')).saved.website).toBe('https://firma.no');
    expect((await save('')).saved.website).toBe('');
  });
});

describe('Z5/I6 user image fields take only our public uploads', () => {
  it('review photos: private and external refused, ours (and already-stored) accepted', () => {
    expect(normaliseReviewPhotos([PRIVATE_URL]).ok).toBe(false);
    expect(normaliseReviewPhotos([EXTERNAL_URL]).ok).toBe(false);
    expect(normaliseReviewPhotos([OUR_URL]).ok).toBe(true);
    expect(normaliseReviewPhotos([EXTERNAL_URL], [EXTERNAL_URL]).ok).toBe(true);
  });

  it('portfolio / previousProjects imageUrl', async () => {
    const id = oid();
    User.findById.mockImplementation(() => doc({ _id: id, email: 'p@x.no', portfolio: [{ imageUrl: 'https://legacy.example/old.jpg' }] }));
    User.findByIdAndUpdate.mockResolvedValue({ _id: id });
    const put = async (body) => { const r = mkRes(); await updateUser({ params: { id }, userId: id, user: { role: 'user' }, body }, r); return r.code; };
    expect(await put({ portfolio: [{ imageUrl: PRIVATE_URL }] })).toBe(400);
    expect(await put({ previousProjects: [{ imageUrl: PRIVATE_URL }] })).toBe(400);
    expect(await put({ portfolio: [{ imageUrl: EXTERNAL_URL }] })).toBe(400);
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(await put({ portfolio: [{ imageUrl: OUR_URL }, { imageUrl: 'https://legacy.example/old.jpg' }] })).toBe(200);
  });

  it('service body images (create): private, external and more than 6 refused', async () => {
    User.findById.mockResolvedValue({ _id: 'u' });
    const { createService } = require('../controllers/services/manageController');
    const post = async (images) => { const r = mkRes(); await createService({ userId: oid(), body: { title: 'Maling av hus', description: 'Trenger maling av hele huset', images } }, r); return r; };
    for (const images of [[PRIVATE_URL], [EXTERNAL_URL], Array(7).fill(OUR_URL)]) {
      const r = await post(images);
      expect(r.code).toBe(400);
      expect(r.body.error).toMatch(/Bilde-URL er ikke tillatt|Maks 6/);
    }
  });
});
