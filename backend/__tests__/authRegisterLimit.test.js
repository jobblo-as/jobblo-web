// The real auth router: login and register shared one rate-limit counter, so 20 mistyped logins
// behind one IP (an office, a household) also refused every sign-up from that IP for 15 minutes.
jest.mock(
  '../controllers/authController',
  () =>
    new Proxy(
      {
        login: (req, res) => res.status(401).json({ error: 'Feil e-post eller passord' }),
        register: (req, res) => res.status(201).json({ ok: true }),
      },
      { get: (target, key) => target[key] || ((req, res) => res.json({})) }
    )
);
jest.mock('../config/iduraClient', () => ({
  isIduraConfigured: () => false,
  createTransactionSecrets: jest.fn(),
  buildAuthorizationUrl: jest.fn(),
  exchangeCode: jest.fn(),
}));

const express = require('express');
const request = require('supertest');

const app = express().use(express.json()).use('/api/auth', require('../routes/auth'));

test('failed logins do not block sign-up from the same IP', async () => {
  for (let i = 0; i < 25; i += 1) await request(app).post('/api/auth/login').send({});
  expect((await request(app).post('/api/auth/login').send({})).status).toBe(429);

  expect((await request(app).post('/api/auth/register').send({})).status).toBe(201);
});
