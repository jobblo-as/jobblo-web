/**
 * authenticate() read path: lean session and user, and the lastUsed write at most once a
 * minute per session (it was a write on every authenticated request).
 */
process.env.JWT_SECRET = 'test-secret';
jest.mock('../models/Session', () => ({
  findOne: jest.fn(),
  updateOne: jest.fn(async () => ({})),
}));
jest.mock('../models/User', () => {
  const { Schema } = jest.requireActual('mongoose');
  return {
    findById: jest.fn(),
    schema: new Schema({
      name: String,
      skills: { type: [String], default: undefined },
      verified: { type: Boolean, default: false },
    }),
  };
});
jest.mock('jsonwebtoken', () => ({
  ...jest.requireActual('jsonwebtoken'),
  verify: jest.fn(() => ({
    id: 'u1',
    sid: 's1',
    typ: 'access',
    aud: 'jobblo:access',
    iss: 'jobblo-api',
  })),
}));

const Session = require('../models/Session');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');

const run = async (lastUsed) => {
  Session.findOne.mockReturnValue({ lean: async () => ({ _id: 's1', userId: 'u1', lastUsed }) });
  User.findById.mockReturnValue({
    select: () => ({
      lean: async () => ({ _id: { toString: () => 'u1' }, name: 'A', role: 'user' }),
    }),
  });
  const req = {
    cookies: {},
    headers: { authorization: 'Bearer t' },
    originalUrl: '/api/x',
    get: () => '',
  };
  const res = {
    status() {
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
    clearCookie() {},
  };
  const next = jest.fn();
  await authenticate(req, res, next);
  return { req, res, next };
};

beforeEach(() => Session.updateOne.mockClear());

it('does not write the session when it was used under a minute ago', async () => {
  const { next } = await run(new Date(Date.now() - 5_000));
  expect(next).toHaveBeenCalled();
  expect(Session.updateOne).not.toHaveBeenCalled();
});

it('writes lastUsed once it is older than a minute (or never set)', async () => {
  for (const lastUsed of [new Date(Date.now() - 61_000), null]) {
    Session.updateOne.mockClear();
    await run(lastUsed);
    expect(Session.updateOne).toHaveBeenCalledTimes(1);
    expect(Session.updateOne.mock.calls[0][0]).toEqual({ _id: 's1' });
    expect(Session.updateOne.mock.calls[0][1].$set.lastUsed).toBeInstanceOf(Date);
  }
});

it('req.user reads like the hydrated document: id virtual and schema defaults', async () => {
  const { req, next } = await run(new Date());
  expect(next).toHaveBeenCalled();
  expect(req.user).toMatchObject({ id: 'u1', name: 'A', role: 'user', verified: false });
  expect(req.userId).toBe('u1');
  expect(req.sessionId).toBe('s1');
});
