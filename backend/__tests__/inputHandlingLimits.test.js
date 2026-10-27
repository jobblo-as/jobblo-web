/**
 * Final review I2/I3/I4/I7/I8/I9: multipart field caps + body guard on every multer instance,
 * query-independent cache keys, sharp pixel ceiling, page ceiling on public lists, no query
 * string (and redacted path) in the error log, AI image type from bytes. No DB, no Azure.
 */
// Building and decoding a large PNG is slow while the full suite runs in parallel.
jest.setTimeout(30000);
jest.mock('../middleware/auth', () => {
  const as = (req, _res, next) => ((req.userId = 'u1'), (req.user = { _id: 'u1', role: 'user' }), next());
  return { authenticate: as, optionalAuthenticate: as, requireAdmin: (_q, _s, n) => n() };
});
jest.mock('../services/monitoring/searchHealth', () => ({ recordSearch: jest.fn() }));
const chain = () => {
  const q = {};
  for (const m of ['populate', 'lean', 'skip', 'limit', 'sort', 'select']) q[m] = jest.fn(() => q);
  q.then = (ok, ko) => Promise.resolve([]).then(ok, ko);
  return q;
};
jest.mock('../models/Service', () => ({ find: jest.fn(), countDocuments: jest.fn() }));

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const sharp = require('sharp');
const Service = require('../models/Service');
const upload = require('../middleware/upload');
const { uploadErrors } = require('../middleware/errorHandlers');

beforeEach(() => {
  jest.clearAllMocks();
  Service.find.mockImplementation(chain);
  Service.countDocuments.mockResolvedValue(0);
});

describe('I2 multipart limits', () => {
  const app = express();
  app.post('/x', upload.array('images', 6), (req, res) => res.json({ ok: true }));
  app.use(uploadErrors);
  const post = (fields) => {
    const r = request(app).post('/x');
    for (const [k, v] of fields) r.field(k, v);
    return r;
  };

  it('accepts an ordinary form', async () => {
    expect((await post([['title', 'Maling'], ['tags[0]', 'a'], ['tags[1]', 'b']])).status).toBe(200);
  });
  it('refuses a huge sparse array index and a $ operator key', async () => {
    expect((await post([['tags[5000000]', 'a']])).status).toBe(400);
    expect((await post([['email[$ne]', 'x']])).status).toBe(400);
  });
  it('refuses too many fields and an oversize field', async () => {
    expect((await post(Array.from({ length: 51 }, (_, i) => [`f${i}`, 'a']))).status).toBe(413);
    expect((await post([['bio', 'a'.repeat(70 * 1024)]])).status).toBe(413);
  });
  it('every multer instance spreads MULTIPART_LIMITS', () => {
    const files = ['middleware/upload.js', 'middleware/multer.js', 'routes/upload.js', 'routes/chat.js',
      'routes/safepay.js', 'routes/safePayCheckout.js', 'routes/admin/index.js'];
    for (const f of files) {
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      const instances = src.match(/multer\(\{[\s\S]*?limits: \{[^}]*\}/g) || [];
      expect(instances.length).toBeGreaterThan(0);
      for (const m of instances) expect([f, /MULTIPART_LIMITS/.test(m)]).toEqual([f, true]);
    }
  });
});

describe('I3 cache key without the query', () => {
  it('ignoreQuery: ?r=<random> hits the same entry', async () => {
    const cache = require('../utils/cache');
    let calls = 0;
    const app = express();
    app.get('/t', cache.cacheJson('iq-test', 60, { ignoreQuery: true }), (req, res) => res.json({ n: ++calls }));
    await request(app).get('/t?r=1');
    const second = await request(app).get('/t?r=2');
    expect(second.headers['x-cache']).toBe('HIT');
    expect(calls).toBe(1);
    for (const f of ['routes/category.js', 'routes/filter.js', 'routes/locationFilter.js']) {
      expect(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).toMatch(/ignoreQuery: true/);
    }
  });
});

describe('I4 OG render pixel ceiling', () => {
  it('refuses a >40 MP image instead of resizing it', async () => {
    const big = await sharp({ create: { width: 9000, height: 5000, channels: 3, background: '#fff' } }).png({ compressionLevel: 1 }).toBuffer();
    await expect(upload.makeOgBuffer(big)).rejects.toThrow(/pixel limit/i);
  }, 30000);
});

describe('I7 page ceiling', () => {
  it('anonymous GET /api/services caps page at 1000', async () => {
    const { getAllServices } = require('../controllers/services/browseController');
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
    await getAllServices({ query: { page: '1000000000' } }, res);
    const q = Service.find.mock.results[0].value;
    expect(q.skip).toHaveBeenCalledWith(999 * 25);
    expect(res.json.mock.calls[0][0].pagination).toMatchObject({ page: 1000, limit: 25 });
  });
  it('search-all caps page at 1000', async () => {
    const { searchAll } = require('../controllers/users/searchController');
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
    await searchAll({ query: { query: 'maling', type: 'jobs', page: '1000000000' } }, res);
    expect(Service.find.mock.results[0].value.skip).toHaveBeenCalledWith(999 * 10);
    expect(res.json.mock.calls[0][0]).toMatchObject({ page: 1000, limit: 10 });
  });
});

describe('I8 error log has no query string, path is redacted', () => {
  const AdminActivity = require('../models/AdminActivity');
  const ErrorLog = require('../models/ErrorLog');
  // The logger only writes with a connected database (utils/errorLogger.js).
  beforeEach(() => {
    jest.replaceProperty(ErrorLog, 'db', { readyState: 1 });
    jest.spyOn(ErrorLog, 'findOne').mockReturnValue({ sort: () => ({ select: () => ({ lean: async () => null }) }) });
  });
  afterEach(() => jest.restoreAllMocks());

  it('serverError logs base+path only', async () => {
    const create = jest.spyOn(ErrorLog, 'create').mockResolvedValue({});
    jest.spyOn(AdminActivity, 'create').mockResolvedValue({});
    const { serverError } = require('../utils/serverError');
    const req = { baseUrl: '/api/users', path: '/search', originalUrl: '/api/users/search?query=kari', method: 'GET', get: () => 'ua' };
    const res = { req, getHeader: () => undefined, status: jest.fn(() => res), json: jest.fn(() => res) };
    serverError(res, new Error('x'));
    await new Promise((r) => setImmediate(r));
    expect(create.mock.calls[0][0].route).toBe('/api/users/search');
  });
  it('route and description go through redactText', async () => {
    const create = jest.spyOn(ErrorLog, 'create').mockResolvedValue({});
    const activity = jest.spyOn(AdminActivity, 'create').mockResolvedValue({});
    const { logApplicationError } = require('../utils/errorLogger');
    await logApplicationError({ error: new Error('x'), requestPath: '/api/u/kari@example.no', httpMethod: 'GET', httpStatus: 500 });
    expect(create.mock.calls[0][0].route).toBe('/api/u/[EMAIL]');
    expect(activity.mock.calls[0][0].description).not.toMatch(/kari/);
  });
});

describe('I9 AI image type from the bytes', () => {
  it('refuses HTML labelled image/png before the controller', async () => {
    const app = express();
    app.use('/ai', require('../routes/ai'));
    app.use(uploadErrors);
    const r = await request(app).post('/ai/analyze-job-image')
      .attach('image', Buffer.from('<!doctype html><script>alert(1)</script>'), { filename: 'a.png', contentType: 'image/png' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Ugyldig filtype/);
  });
});
