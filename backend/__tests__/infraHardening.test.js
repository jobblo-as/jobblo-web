/**
 * Infra hardening: support-ticket limiter, scheduler stopped on shutdown, SESSION_SECRET !==
 * JWT_SECRET in production, and credential limiters failing closed when Redis is down.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../controllers/supportController', () => ({
  createTicket: (req, res) => res.status(201).json({ ok: true }),
  getMyTickets: (req, res) => res.json([]),
}));

describe('POST /api/support/tickets limiter', () => {
  it('allows 10 anonymous tickets per hour, the 11th gets 429', async () => {
    const app = express().use(express.json()).use('/api/support', require('../routes/support'));
    for (let i = 0; i < 10; i += 1) expect((await request(app).post('/api/support/tickets').send({})).status).toBe(201);
    const res = await request(app).post('/api/support/tickets').send({});
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/For mange henvendelser/);
  });
});

describe('scheduler stop on shutdown', () => {
  it('startBackground hands back stop handles and shutdown runs them before closing http', async () => {
    const order = [];
    const bg = require('../bootstrap/background').startBackground([
      ['scheduler', () => ({ stop: () => order.push('scheduler') })],
      ['other', () => undefined],
    ]);
    expect(bg.stops.map(([n]) => n)).toEqual(['scheduler']);

    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const close = require('../bootstrap/shutdown').registerShutdown({
        server: { listening: true, close: (cb) => { order.push('http'); cb(); } },
        extra: bg.stops,
      });
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      await close('TEST');
      expect(order).toEqual(['scheduler', 'http']);
      expect(exit).toHaveBeenCalledWith(0);
      // A finished shutdown leaves no deadline behind to exit(1) later.
      jest.advanceTimersByTime(60_000);
      expect(exit).not.toHaveBeenCalledWith(1);
    } finally {
      jest.useRealTimers();
      jest.restoreAllMocks();
      process.removeAllListeners('SIGTERM');
      process.removeAllListeners('SIGINT');
    }
  });
});

describe('sessionMiddleware secrets', () => {
  const { sessionMiddleware } = require('../config/session');
  it('refuses SESSION_SECRET === JWT_SECRET in production', () => {
    expect(() => sessionMiddleware({ NODE_ENV: 'production', SESSION_SECRET: 's', JWT_SECRET: 's' })).toThrow(/must differ/);
  });
  it('accepts distinct secrets', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {}); // no MONGO_URI warning
    expect(typeof sessionMiddleware({ NODE_ENV: 'production', SESSION_SECRET: 'a', JWT_SECRET: 'b' })).toBe('function');
    jest.restoreAllMocks();
  });
});

describe('rate limiters with Redis down', () => {
  it('credential limiters fail closed, the general limiter fails open', async () => {
    let rl;
    jest.isolateModules(() => {
      jest.doMock('../config/redis', () => ({ PREFIX: 't', getRedis: () => ({ call: () => Promise.reject(new Error('redis down')) }) }));
      rl = require('../middleware/rateLimiter');
    });
    const hit = (limiter) => request(express().get('/', limiter, (req, res) => res.send('ok')).use((err, req, res, next) => res.status(503).end())).get('/');
    jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await hit(rl.apiLimiter)).status).toBe(200);
      for (const l of [rl.authLimiter, rl.otpSendLimiter, rl.otpVerifyLimiter]) expect((await hit(l)).status).toBe(503);
    } finally {
      jest.restoreAllMocks();
    }
  });
});
