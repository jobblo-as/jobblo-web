/**
 * cookie-parser turns `j:{...}` cookie values into objects. `refreshToken=j:{"$ne":null}`
 * on /logout or /refresh-token became `Session.deleteOne({ refreshToken: { $ne: null } })`:
 * any one request ended someone else's session. app.js drops non-string cookies, and the
 * controller only ever queries with a string.
 */
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = '';
const request = require('supertest');

jest.mock('../models/Session', () => ({
  deleteOne: jest.fn(async () => ({})),
  findOneAndDelete: jest.fn(async () => null),
  findOne: jest.fn(async () => null),
}));
jest.mock('../models/PushToken', () => ({ updateMany: jest.fn() }));
jest.mock('../routes/api', () => {
  const actual = jest.requireActual('../routes/api');
  return {
    ...actual,
    mountRoutes: (app) => {
      const login = require('../controllers/auth/loginController');
      app.post('/api/auth/logout', login.logout);
      app.post('/api/auth/refresh-token', login.refreshToken);
      app.get('/api/probe', (req, res) =>
        res.json({ type: typeof req.cookies.refreshToken, kept: req.cookies.keep })
      );
    },
  };
});

const Session = require('../models/Session');
const app = require('../app');
const EVIL = `refreshToken=${encodeURIComponent('j:{"$ne":null}')}; keep=plain`;

beforeEach(() => jest.clearAllMocks());

it('drops JSON-object cookies but keeps plain ones', async () => {
  const r = await request(app).get('/api/probe').set('Cookie', EVIL);
  expect(r.body).toEqual({ type: 'undefined', kept: 'plain' });
});

it.each(['/api/auth/logout', '/api/auth/refresh-token'])(
  '%s never queries Session with an operator object',
  async (path) => {
    await request(app).post(path).set('Cookie', EVIL);
    for (const m of [Session.deleteOne, Session.findOneAndDelete, Session.findOne]) {
      for (const [filter] of m.mock.calls) expect(JSON.stringify(filter)).not.toContain('$ne');
    }
  }
);

it('the controller guard holds on its own (no app middleware)', async () => {
  const { logout } = require('../controllers/auth/loginController');
  const res = { json: () => res, status: () => res, clearCookie: () => res, cookie: () => res };
  await logout({ cookies: { refreshToken: { $ne: null } } }, res);
  expect(Session.deleteOne).not.toHaveBeenCalled();
  expect(Session.findOneAndDelete).not.toHaveBeenCalled();
});
