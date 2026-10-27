/**
 * Password reset hardening:
 *  - a reset unlinks every OAuth identity (pre-hijack: attacker registers the victim's
 *    address, links their own Google; the victim's reset must end that access);
 *  - code guesses are capped per ACCOUNT per hour across codes (issueOtp resets the per-code count).
 */
let users;
jest.mock('../models/User', () => ({
  findOne: jest.fn(),
  updateOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));
jest.mock('../models/Session', () => ({ deleteMany: jest.fn() }));
jest.mock('../models/IdentityClaim', () => ({ deleteMany: jest.fn() }));
jest.mock('../utils/emailService', () => ({ sendOtpEmail: jest.fn() }));

const User = require('../models/User');
const { sha256, checkOtp, MAX_OTP_ATTEMPTS } = require('../controllers/auth/authHelpers');
const { resetPassword } = require('../controllers/auth/passwordController');
const { resolveOAuthLogin } = require('../utils/oauthLinking');

const res = () => ({
  code: 200,
  body: null,
  status(c) {
    this.code = c;
    return this;
  },
  json(b) {
    this.body = b;
    return this;
  },
});

it("reset unlinks OAuth identities, so the attacker's Google no longer signs in", async () => {
  users = [
    {
      _id: 'u1',
      email: 'victim@example.no',
      oauthProviders: [{ provider: 'google', providerId: 'attacker-g' }],
      passwordResetSessionToken: sha256('tok'),
    },
  ];
  const matches = (u, f) =>
    Object.entries(f).every(([k, v]) => {
      if (k === 'oauthProviders')
        return u.oauthProviders.some(
          (p) => p.provider === v.$elemMatch.provider && p.providerId === v.$elemMatch.providerId
        );
      if (v && typeof v === 'object' && '$gt' in v) return true;
      return u[k] === v;
    });
  User.findOne.mockImplementation((f) => {
    const u = users.find((x) => matches(x, f)) || null;
    return { select: async () => u, then: (r, j) => Promise.resolve(u).then(r, j) };
  });
  User.updateOne.mockImplementation(async (f, u) => {
    const row = users.find((x) => matches(x, f));
    if (!row) return { modifiedCount: 0 };
    Object.assign(row, u.$set);
    return { modifiedCount: 1 };
  });

  const r = res();
  await resetPassword({ body: { resetToken: 'tok', password: 'NyttPassord1' } }, r);
  expect(r.code).toBe(200);
  expect(users[0].oauthProviders).toEqual([]);

  const decision = await resolveOAuthLogin({
    provider: 'google',
    providerId: 'attacker-g',
    email: 'victim@example.no',
    emailVerified: true,
  });
  expect(decision.outcome).not.toBe('login');
});

it('caps code guesses per account across fresh codes', async () => {
  let row = { _id: 'u9', passwordResetToken: sha256('123456'), passwordResetAttempts: 0 };
  User.findOneAndUpdate.mockImplementation(() => ({
    select: async () =>
      row.passwordResetAttempts >= MAX_OTP_ATTEMPTS
        ? null
        : { ...row, passwordResetAttempts: ++row.passwordResetAttempts },
  }));
  User.updateOne.mockResolvedValue({});
  let wrong = 0;
  for (let code = 0; code < 10; code += 1) {
    row = { ...row, passwordResetAttempts: 0 }; // issueOtp: a fresh code resets the per-code count
    for (let g = 0; g < 4; g += 1) {
      await checkOtp({ email: 'x' }, '000000');
      wrong += 1;
    }
  }
  expect(wrong).toBe(40);
  row = { ...row, passwordResetAttempts: 0 };
  // The 41st guess is the right code, yet the hourly per-account budget (20) is spent.
  await expect(checkOtp({ email: 'x' }, '123456')).resolves.toBeNull();
});
