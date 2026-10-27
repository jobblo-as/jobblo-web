/**
 * H9: setting up an authenticator needs a code emailed to the account first, so a leaked
 * password alone cannot register an attacker's authenticator on an admin/developer account.
 */
jest.mock('../services/developer/stepUp', () => ({ sendCode: jest.fn(), verifyCode: jest.fn() }));
jest.mock('../services/auth/mfa', () => ({ startSetup: jest.fn(), requiresMfa: () => true }));
jest.mock('../services/admin/activityService', () => ({ logActivity: jest.fn() }));

const stepUp = require('../services/developer/stepUp');
const mfa = require('../services/auth/mfa');
const controller = require('../controllers/mfaController');

const user = (extra = {}) => ({ _id: 'u1', email: 'dev@example.test', name: 'Dev', mfaEnabledAt: null, ...extra });
const call = async (fn, req) => {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await fn({ ip: '1.2.3.4', get: () => 'jest', sessionId: 's1', body: {}, ...req }, res);
  return res;
};
const fail = (message, status) => Object.assign(new Error(message), { status });

beforeEach(() => jest.clearAllMocks());

describe('POST /api/auth/mfa/setup', () => {
  it('refuses without an email code and creates no secret', async () => {
    stepUp.verifyCode.mockRejectedValue(fail('Enter the 6-digit code.', 400));
    const res = await call(controller.setup, { user: user() });
    expect(res.code).toBe(400);
    expect(res.body.code).toBe('MFA_SETUP_EMAIL_CODE');
    expect(mfa.startSetup).not.toHaveBeenCalled();
  });

  it('refuses a wrong email code and creates no secret', async () => {
    stepUp.verifyCode.mockRejectedValue(fail('Wrong code. 4 attempt(s) left.', 400));
    const res = await call(controller.setup, { user: user(), body: { emailCode: '000000' } });
    expect(res.code).toBe(400);
    expect(mfa.startSetup).not.toHaveBeenCalled();
  });

  it('keeps the attempt limit of the email code (429)', async () => {
    stepUp.verifyCode.mockRejectedValue(fail('Too many wrong attempts. Request a new code.', 429));
    expect((await call(controller.setup, { user: user(), body: { emailCode: '111111' } })).code).toBe(429);
  });

  it('starts setup only after the right code, for this user and session', async () => {
    stepUp.verifyCode.mockResolvedValue({ token: 't' });
    mfa.startSetup.mockResolvedValue({ secret: 'ABCD EFGH', otpauthUrl: 'otpauth://totp/x' });
    const res = await call(controller.setup, { user: user(), body: { emailCode: '123456' } });
    expect(stepUp.verifyCode).toHaveBeenCalledWith(expect.objectContaining({ _id: 'u1' }), 's1', '123456');
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ secret: 'ABCD EFGH', otpauthUrl: 'otpauth://totp/x' });
  });
});

describe('POST /api/auth/mfa/setup/send-code', () => {
  it('emails a code and returns the masked address', async () => {
    const res = await call(controller.sendSetupCode, { user: user() });
    expect(stepUp.sendCode).toHaveBeenCalledWith(expect.objectContaining({ _id: 'u1' }));
    expect(res.code).toBe(200);
    expect(res.body.sentTo).not.toBe('dev@example.test');
    expect(res.body.sentTo).toMatch(/\*/);
  });

  it('refuses when an authenticator is already set up', async () => {
    const res = await call(controller.sendSetupCode, { user: user({ mfaEnabledAt: new Date() }) });
    expect(res.code).toBe(409);
    expect(stepUp.sendCode).not.toHaveBeenCalled();
  });

  it('passes on the send limits (1 per minute, 5 per hour)', async () => {
    stepUp.sendCode.mockRejectedValue(fail('Wait a minute before requesting another code.', 429));
    expect((await call(controller.sendSetupCode, { user: user() })).code).toBe(429);
  });
});
