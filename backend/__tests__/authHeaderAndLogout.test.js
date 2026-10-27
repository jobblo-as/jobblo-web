/**
 * - The Bearer header wins over the access-token cookie (the app's native cookie jar can
 *   still hold the previous user's cookie after an offline logout).
 * - Logout switches off the push tokens registered by the ended session server-side.
 */
jest.mock('../utils/tokenUtils', () => ({
  verifyToken: jest.fn((t) => ({ tokA: { id: 'A', sid: 'sA' }, tokB: { id: 'B', sid: 'sB' } })[t]),
  deviceNameFrom: () => null,
  generateTokens: jest.fn(),
  createSession: jest.fn(),
}));
jest.mock('../models/Session', () => ({
  findOne: jest.fn(() => ({ lean: async () => ({ _id: 's' }) })),
  updateOne: jest.fn(async () => ({})),
  findById: jest.fn(async (sid) => ({ userId: { sA: 'A', sB: 'B' }[sid], mfaVerifiedAt: new Date() })),
  deleteOne: jest.fn(async () => ({})),
  findOneAndDelete: jest.fn(async () => ({ _id: 'sCookie' })),
}));
jest.mock('../models/User', () => ({
  findById: jest.fn((id) => ({ select: () => ({ lean: async () => ({ _id: { toString: () => id }, role: 'user', accountStatus: 'active' }) }) })),
}));
jest.mock('../models/PushToken', () => ({ updateMany: jest.fn(), findOneAndUpdate: jest.fn(async () => ({})) }));

const PushToken = require('../models/PushToken');
const { authenticate } = require('../middleware/auth');
const { logout } = require('../controllers/auth/loginController');

it('answers the Bearer token, not a stale cookie', async () => {
  const req = { cookies: { accessToken: 'tokA' }, headers: { authorization: 'Bearer tokB' } };
  await authenticate(req, {}, jest.fn());
  expect(req.userId).toBe('B');
  expect(req.sessionId).toBe('sB');
});

it('still accepts the cookie when there is no Bearer header (web)', async () => {
  const req = { cookies: { accessToken: 'tokA' }, headers: {} };
  await authenticate(req, {}, jest.fn());
  expect(req.userId).toBe('A');
});

it('the chat socket also prefers its explicit auth token over a stale cookie', async () => {
  let guard;
  require('../sockets/chat.socket')({ use: (fn) => { guard = fn; }, on: () => {} });
  const socket = { handshake: { headers: { cookie: 'accessToken=tokA' }, auth: { token: 'tokB' } } };
  await new Promise((resolve) => guard(socket, resolve));
  expect(socket.userId).toBe('B');
});

it('logout deactivates the push tokens of every session it ends', async () => {
  const res = { json: () => res, status: () => res, clearCookie: () => res };
  await logout({ cookies: { refreshToken: 'r' }, userId: 'B', sessionId: 'sB' }, res);
  expect(PushToken.updateMany).toHaveBeenCalledWith(
    { sessionId: { $in: ['sCookie', 'sB'] } },
    { $set: { active: false } }
  );
});

it('a registered push token records the login session it belongs to', async () => {
  const res = { status: () => res, json: () => res };
  await require('../controllers/pushTokenController').register(
    { userId: 'B', sessionId: 'sB', body: { token: 'f'.repeat(40), platform: 'android' } }, res
  );
  expect(PushToken.findOneAndUpdate.mock.calls[0][1]).toMatchObject({ sessionId: 'sB' });
});
