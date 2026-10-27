/**
 * P3 account guards:
 *  - BankID completion never reactivates an account an admin set inactive.
 *  - Self-deletion needs the current password (or a fresh login for OAuth-only accounts),
 *    and the last active superAdmin cannot be deleted.
 *  - PUT /users/:id cannot change roles (only the audited admin role endpoint can).
 *  - Login spends bcrypt time on unknown e-mails and locks an e-mail after 10 failures.
 * Models mocked; real controllers.
 */
jest.mock('../models/User', () => ({
  findById: jest.fn(),
  findOne: jest.fn(),
  updateOne: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  countDocuments: jest.fn(),
}));
jest.mock('../models/Session', () => ({ findById: jest.fn(), deleteMany: jest.fn() }));
jest.mock('../models/Order', () => ({ countDocuments: jest.fn() }));
jest.mock('../models/Service', () => ({}));
jest.mock('../models/JobRequest', () => ({}));
jest.mock('../models/List', () => ({}));
jest.mock('../models/IdentityClaim', () => ({}));
jest.mock('../utils/tokenUtils', () => ({
  generateTokens: jest.fn(),
  verifyToken: jest.fn(),
  createSession: jest.fn(async () => ({ accessToken: 'a', refreshToken: 'r' })),
}));

const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Session = require('../models/Session');
const Order = require('../models/Order');

const mkRes = () => ({
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
  cookie() {
    return this;
  },
});

beforeEach(() => jest.clearAllMocks());

describe('BankID verification', () => {
  it('does not reactivate an inactive account', async () => {
    const row = { _id: 'u1', accountStatus: 'inactive' };
    const matches = (f) =>
      f._id === row._id && (!f.accountStatus || row.accountStatus !== f.accountStatus.$ne);
    User.updateOne.mockImplementation(async (f, u) => {
      if (matches(f)) Object.assign(row, u.$set);
    });
    User.findByIdAndUpdate.mockImplementation(async (id, u) => Object.assign(row, u.$set));
    const { applyVerification } = require('../controllers/iduraAuthController');
    await applyVerification('u1', { provider: 'idura' });
    expect(row).toMatchObject({
      verified: true,
      accountStatus: 'inactive',
      identityVerification: { provider: 'idura' },
    });

    row.accountStatus = 'active';
    await applyVerification('u1', { provider: 'idura' });
    expect(row.accountStatus).toBe('verified');
  });
});

describe('profile controller', () => {
  const { deleteUser, updateUser } = require('../controllers/users/profileController');
  const ID = '64b000000000000000000001';
  const selected = (doc) => ({
    select: () => ({ lean: async () => doc, then: (r, j) => Promise.resolve(doc).then(r, j) }),
  });
  const hash = bcrypt.hashSync('right-password', 4);

  it('refuses self-deletion without the current password', async () => {
    User.findById.mockReturnValue(
      selected({ _id: ID, email: 'a@b.no', role: 'user', password: hash })
    );
    const res = mkRes();
    await deleteUser({ params: { id: ID }, userId: ID, user: { role: 'user' }, body: {} }, res);
    expect(res.code).toBe(403);
    expect(res.body.code).toBe('CURRENT_PASSWORD_REQUIRED');
    expect(Order.countDocuments).not.toHaveBeenCalled();
  });

  it('refuses self-deletion of an OAuth-only account from a stale session', async () => {
    User.findById.mockReturnValue(
      selected({ _id: ID, email: 'a@b.no', role: 'user', password: 'oauth-user' })
    );
    Session.findById.mockReturnValue({
      select: () => ({ lean: async () => ({ createdAt: new Date(Date.now() - 60 * 60 * 1000) }) }),
    });
    const res = mkRes();
    await deleteUser(
      { params: { id: ID }, userId: ID, sessionId: 's1', user: { role: 'user' }, body: {} },
      res
    );
    expect(res.body.code).toBe('REAUTH_REQUIRED');
  });

  it('refuses to delete the last active superAdmin, even with the right password', async () => {
    User.findById.mockReturnValue(
      selected({ _id: ID, email: 'a@b.no', role: 'superAdmin', password: hash })
    );
    User.countDocuments.mockResolvedValue(1);
    const res = mkRes();
    await deleteUser(
      {
        params: { id: ID },
        userId: ID,
        user: { role: 'superAdmin' },
        body: { currentPassword: 'right-password' },
      },
      res
    );
    expect(res.code).toBe(403);
    expect(res.body.code).toBe('last_superadmin');
    expect(Order.countDocuments).not.toHaveBeenCalled();
  });

  it('PUT /users/:id ignores role, even from a superAdmin', async () => {
    const res = mkRes();
    await updateUser(
      {
        params: { id: ID },
        userId: 'admin',
        user: { role: 'superAdmin' },
        body: { role: 'superAdmin' },
      },
      res
    );
    expect(res.code).toBe(400); // "No valid fields": role is not an updatable field here
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});

describe('login', () => {
  const { login } = require('../controllers/auth/loginController');
  const attempt = async (email, password = 'wrong', ip = '203.0.113.1') => {
    const res = mkRes();
    await login({ body: { email, password }, headers: {}, ip }, res);
    return res;
  };

  it('runs a bcrypt compare even when the account does not exist', async () => {
    User.findOne.mockReturnValue({ select: async () => null });
    const spy = jest.spyOn(bcrypt, 'compare');
    const res = await attempt('nobody@example.no');
    expect(res.code).toBe(401);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('locks an e-mail after 10 failed logins, even with the right password', async () => {
    const hash = bcrypt.hashSync('right-password', 4);
    User.findOne.mockReturnValue({
      select: async () => ({
        _id: 'u1',
        password: hash,
        accountStatus: 'active',
        emailVerifiedAt: new Date(),
      }),
    });
    for (let i = 0; i < 10; i += 1) expect((await attempt('victim@example.no')).code).toBe(401);
    const locked = await attempt('victim@example.no', 'right-password');
    expect(locked.code).toBe(429);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    // Another e-mail is unaffected, and so is the owner on their own network.
    expect((await attempt('other@example.no', 'right-password')).code).toBe(200);
    expect((await attempt('victim@example.no', 'right-password', '198.51.100.7')).code).toBe(200);
  }, 20000);

  it('an e-mail attacked from many IPs locks the attacking clients at 100 failures, not the owner', async () => {
    const hash = bcrypt.hashSync('right-password', 4);
    User.findOne.mockReturnValue({
      select: async () => ({
        _id: 'u2',
        password: hash,
        accountStatus: 'active',
        emailVerifiedAt: new Date(),
      }),
    });
    const spy = jest.spyOn(bcrypt, 'compare').mockResolvedValue(false);
    for (let i = 0; i < 100; i += 1)
      await attempt('botnet@example.no', 'wrong', `10.0.${i >> 8}.${i & 255}`);
    spy.mockRestore();
    // A client that has failed for this e-mail is refused, even with the right password ...
    expect((await attempt('botnet@example.no', 'right-password', '10.0.0.5')).code).toBe(429);
    // ... but the owner, from a client with no failures, still signs in.
    expect((await attempt('botnet@example.no', 'right-password', '198.51.100.9')).code).toBe(200);
  }, 20000);
});
