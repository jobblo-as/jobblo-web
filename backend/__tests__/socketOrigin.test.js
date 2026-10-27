/**
 * C2: a page on another website must not be able to open a Socket.IO connection with the
 * visitor's cookies. The engine.io handshake is refused for a foreign Origin; Jobblo's own
 * origins and requests without an Origin (mobile app) still connect.
 */
const http = require('http');
const request = require('supertest');
const { setupSockets } = require('../bootstrap/socket');

let server;
let io;
beforeAll(() => {
  server = http.createServer();
  io = setupSockets(server, { set: () => {} });
});
afterAll(() => io.close());

const handshake = (origin) => {
  const req = request(server).get('/socket.io/?EIO=4&transport=polling');
  return origin ? req.set('Origin', origin) : req;
};

it('refuses a handshake from a foreign origin', async () => {
  const res = await handshake('https://evil.example');
  expect(res.status).toBe(403);
  expect(res.text).not.toMatch(/^0\{"sid"/);
});

it('refuses a lookalike origin', async () => {
  expect((await handshake('http://localhost:5173.evil.example')).status).toBe(403);
});

it('accepts Jobblo\'s own origin', async () => {
  const res = await handshake('http://localhost:5173');
  expect(res.status).toBe(200);
  expect(res.text).toMatch(/^0\{"sid"/);
});

it('accepts a request without an Origin (mobile app)', async () => {
  const res = await handshake(null);
  expect(res.status).toBe(200);
  expect(res.text).toMatch(/^0\{"sid"/);
});

it('accepts the API own origin (React Native on Android sends it) but not another site with that Host', async () => {
  const at = (origin) => request(server).get('/socket.io/?EIO=4&transport=polling').set('Host', 'api.jobblo.test:5001').set('Origin', origin);
  expect((await at('http://api.jobblo.test:5001')).status).toBe(200);
  expect((await at('http://evil.example')).status).toBe(403);
  expect((await at('http://api.jobblo.test:5002')).status).toBe(403);
});
