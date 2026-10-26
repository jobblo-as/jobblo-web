/**
 * Fixes from the logged-in load-break run (many concurrent users against an isolated instance).
 */
jest.mock('bcryptjs', () => ({ compare: jest.fn(), hash: jest.fn() }));
jest.mock('axios', () => ({ get: jest.fn() }));

const bcrypt = require('bcryptjs');
const axios = require('axios');

describe('bounded password hashing (login storm starved the event loop)', () => {
  it('runs at most MAX_ACTIVE at once, FIFO, and sheds past MAX_WAITING as 503', async () => {
    const { comparePassword, MAX_ACTIVE, MAX_WAITING } = require('../utils/passwordUtils');
    const pending = [];
    let running = 0;
    let peak = 0;
    bcrypt.compare.mockImplementation(() => {
      running += 1;
      peak = Math.max(peak, running);
      return new Promise((resolve) => pending.push(() => { running -= 1; resolve(true); }));
    });

    const order = [];
    const calls = Array.from({ length: MAX_ACTIVE + MAX_WAITING }, (_, i) => comparePassword('pw', 'h').then(() => order.push(i)));
    const overflow = comparePassword('pw', 'h');
    await expect(overflow).rejects.toMatchObject({ code: 'PASSWORD_HASH_BUSY' });

    while (order.length < calls.length) {
      await new Promise((r) => setImmediate(r));
      pending.shift()?.();
    }
    await Promise.all(calls);
    expect(peak).toBe(MAX_ACTIVE);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    const { sendServerError } = require('../controllers/auth/authHelpers');
    const res = { set: jest.fn(), status: jest.fn(() => res), json: jest.fn(() => res) };
    sendServerError(res, Object.assign(new Error('busy'), { code: 'PASSWORD_HASH_BUSY' }));
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.set).toHaveBeenCalledWith('Retry-After', '5');
  });
});

describe('session geo lookup', () => {
  it('bounds the ip-api.com call so a slow lookup cannot hold a login open', async () => {
    const { getGeoLocation, GEO_TIMEOUT_MS } = require('../utils/tokenUtils');
    axios.get.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }));
    await expect(getGeoLocation('203.0.113.9')).resolves.toBe('Unknown');
    expect(axios.get.mock.calls[0][1]).toEqual({ timeout: GEO_TIMEOUT_MS });
  });
});

describe('DELETE /api/auth/sessions/:sessionId', () => {
  it('answers 400, not 500, for a malformed id', async () => {
    const { revokeSession } = require('../controllers/auth/accountController');
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
    await revokeSession({ params: { sessionId: 'not-an-id' }, userId: '507f1f77bcf86cd799439011' }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
