/**
 * utils/cache.js serves hits as stored bytes (no parse/stringify), with a short L1 in front of
 * Redis; middleware/rateLimiter.js survives Redis being down at startup. Fake Redis, no server.
 */
const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');

function fakeRedis() {
  const data = new Map();
  const r = {
    status: 'ready',
    calls: { get: 0, eval: 0 },
    failGet: false,
    getBuffer: jest.fn(async (k) => {
      r.calls.get += 1;
      if (r.failGet) throw new Error('down');
      return data.has(k) ? Buffer.from(data.get(k)) : null;
    }),
    multi() {
      const ops = [];
      const m = {
        set: (k, v) => (ops.push(() => data.set(k, v)), m),
        sadd: () => m,
        expire: () => m,
        exec: async () => ops.forEach((f) => f()),
      };
      return m;
    },
    eval: jest.fn(async () => {
      r.calls.eval += 1;
      data.clear();
    }),
    del: async (k) => data.delete(k),
    data,
  };
  return r;
}

function loadCache(client) {
  jest.resetModules();
  if (client) jest.doMock('../config/redis', () => ({ PREFIX: 't', getRedis: () => client }));
  else jest.dontMock('../config/redis');
  return require('../utils/cache');
}

function appWith(cache, ns = 'pc') {
  let calls = 0;
  const app = express();
  app.get('/x', cache.cacheJson(ns, 60), (req, res) => res.json({ n: ++calls, s: 'ø"<' }));
  app.get('/missing', cache.cacheJson(ns, 60), (req, res) => res.status(404).json({ error: 'no' }));
  return app;
}

afterEach(() => jest.dontMock('../config/redis'));

test('in-process: a hit is byte-identical to the miss, same headers; invalidate forces a miss', async () => {
  const cache = loadCache(null);
  const app = appWith(cache);
  const miss = await request(app).get('/x');
  const hit = await request(app).get('/x');
  expect([miss.headers['x-cache'], hit.headers['x-cache']]).toEqual(['MISS', 'HIT']);
  expect(hit.text).toBe(miss.text);
  for (const h of ['content-type', 'content-length', 'etag'])
    expect(hit.headers[h]).toBe(miss.headers[h]);
  expect((await request(app).get('/x').set('If-None-Match', miss.headers.etag)).status).toBe(304);
  await cache.invalidate('pc');
  expect((await request(app).get('/x')).body.n).toBe(2);
  expect(await cache.get('pc:/x')).toMatchObject({ n: 2 });
  // errors are never cached
  await request(app).get('/missing');
  expect((await request(app).get('/missing')).headers['x-cache']).toBe('MISS');
});

test('Redis: L1 absorbs repeat reads, concurrent misses share one GET, invalidate clears both', async () => {
  const r = fakeRedis();
  const cache = loadCache(r);
  r.data.set('t:cache:pc:/y', JSON.stringify({ from: 'redis' }));
  const app = express().get('/y', cache.cacheJson('pc', 60), (req, res) =>
    res.json({ from: 'db' })
  );
  const all = await Promise.all([1, 2, 3, 4, 5].map(() => request(app).get('/y')));
  expect(all.map((x) => x.body.from)).toEqual(Array(5).fill('redis'));
  await request(app).get('/y');
  expect(r.calls.get).toBe(1); // one Redis GET for six requests
  await cache.invalidate('pc');
  expect(r.calls.eval).toBe(1);
  const after = await request(app).get('/y');
  expect([after.headers['x-cache'], after.body.from]).toEqual(['MISS', 'db']);
});

test('Redis error or not ready = cache miss, the request still succeeds', async () => {
  const r = fakeRedis();
  r.failGet = true;
  const cache = loadCache(r);
  const app = appWith(cache);
  const res = await request(app).get('/x');
  expect([res.status, res.headers['x-cache']]).toEqual([200, 'MISS']);
  r.status = 'reconnecting';
  expect(await cache.get('nothing:here')).toBeUndefined();
  expect(r.calls.get).toBe(1); // not asked while reconnecting
});

test('rate limiter still counts when SCRIPT LOAD failed at startup (Redis down at boot)', async () => {
  jest.resetModules();
  const client = {
    call: jest.fn(async (cmd, ...args) => {
      if (cmd === 'SCRIPT') throw new Error('Connection is closed.');
      if (cmd === 'EVALSHA') {
        expect(args[0]).toMatch(/^[0-9a-f]{40}$/);
        return [1, 60_000];
      }
      return null;
    }),
  };
  jest.doMock('../config/redis', () => ({ PREFIX: 't', getRedis: () => client }));
  const { makeLimiter } = require('../middleware/rateLimiter');
  const limiter = makeLimiter('perf-test', {
    windowMs: 60_000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
  });
  await new Promise((r) => setTimeout(r, 10)); // store.init settles
  const res = await request(
    express()
      .use(limiter)
      .get('/', (req, res) => res.send('ok'))
  ).get('/');
  expect(res.status).toBe(200);
  expect(res.headers['ratelimit-remaining']).toBe('4'); // counted in Redis, not failed open
  const sha = client.call.mock.calls.find(([c]) => c === 'EVALSHA')[1];
  const lua = client.call.mock.calls.find(([c]) => c === 'SCRIPT')[2];
  expect(sha).toBe(crypto.createHash('sha1').update(lua).digest('hex'));
});
