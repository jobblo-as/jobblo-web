/**
 * M7 abuse and cost:
 *  - /api/ai/*: 20 calls per user per hour, oversized input refused before OpenAI;
 *  - POST /api/errors/client: 32 kb body cap (ahead of the global 12 mb parser), own limiter,
 *    stored fields truncated;
 *  - listing views: one per viewer per listing per 24 h.
 * Real app.js middleware chain; OpenAI is never reached (the controller is mocked).
 */
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = '';
delete process.env.REDIS_URL;
const request = require('supertest');
jest.setTimeout(30000); // loops of 20-31 requests; the full suite runs many workers at once

jest.mock('../models/ErrorLog', () => ({ create: jest.fn().mockResolvedValue({}) }));
jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.userId = req.headers['x-user'] || 'u1'; next(); },
}));
jest.mock('../controllers/aiController', () => {
  const ok = (req, res) => res.json({ success: true });
  return { analyzeJobImage: ok, generateJobInfo: ok, generateTitle: ok, generateFullJobListing: ok };
});
jest.mock('../routes/api', () => {
  const actual = jest.requireActual('../routes/api');
  return {
    ...actual,
    mountRoutes: (app) => {
      app.use('/api/errors', require('../routes/errors'));
      app.use('/api/ai', require('../routes/ai'));
    },
  };
});

const ErrorLog = require('../models/ErrorLog');
const app = require('../app');

describe('AI endpoints', () => {
  it('refuses an oversized prompt with 413', async () => {
    const r = await request(app).post('/api/ai/generate-full-listing').set('x-user', 'big').send({ prompt: 'x'.repeat(9000) });
    expect(r.status).toBe(413);
  });

  it('a non-text title/description/prompt is a 400, not a crash in .trim()', async () => {
    const r = await request(app).post('/api/ai/generate-title').set('x-user', 'typed').send({ description: { $gt: '' } });
    expect(r.status).toBe(400);
  });

  it('allows 20 calls per user per hour, then 429; another user is unaffected', async () => {
    for (let i = 0; i < 20; i++) {
      const r = await request(app).post('/api/ai/generate-title').set('x-user', 'heavy').send({ description: 'male to soverom' });
      expect(r.status).toBe(200);
    }
    const over = await request(app).post('/api/ai/generate-job-info').set('x-user', 'heavy').send({ title: 'male to soverom' });
    expect(over.status).toBe(429);
    const other = await request(app).post('/api/ai/generate-title').set('x-user', 'light').send({ description: 'male to soverom' });
    expect(other.status).toBe(200);
  });
});

describe('POST /api/errors/client', () => {
  it('refuses a body over 32 kb', async () => {
    const r = await request(app).post('/api/errors/client').send({ message: 'x', metadata: { blob: 'y'.repeat(40 * 1024) } });
    expect(r.status).toBe(413);
    expect(ErrorLog.create).not.toHaveBeenCalled();
  });

  it('truncates stored fields', async () => {
    ErrorLog.create.mockClear();
    const r = await request(app).post('/api/errors/client').send({ message: 'm'.repeat(10000), route: 'r'.repeat(2000), errorCode: 'E'.repeat(500) });
    expect(r.status).toBe(200);
    const doc = ErrorLog.create.mock.calls[0][0];
    expect(doc.technicalMessage.length).toBeLessThanOrEqual(4000);
    expect(doc.route.length).toBeLessThanOrEqual(500);
    expect(doc.errorCode.length).toBeLessThanOrEqual(100);
  });

  it('a client report can never pose as a server error (I10)', async () => {
    ErrorLog.create.mockClear();
    await request(app).post('/api/errors/client').send({ errorCode: 'PAYOUT_FAILED', message: 'x' });
    await request(app).post('/api/errors/client').send({ errorCode: 'frontend_render<script>', message: 'x' });
    const [a, b] = ErrorLog.create.mock.calls.map(([d]) => d);
    expect(a).toMatchObject({ errorCode: 'CLIENT_PAYOUT_FAILED', severity: 'warning', source: 'frontend' });
    expect(b.errorCode).toBe('FRONTEND_RENDER_SCRIPT_');
  });

  it('has its own limiter (429 after 30 in the window)', async () => {
    let last;
    for (let i = 0; i < 31; i++) last = await request(app).post('/api/errors/client').send({ message: 'boom' });
    expect(last.status).toBe(429);
  });
});

describe('listing views', () => {
  const { firstView } = require('../utils/firstView');

  it('counts one view per viewer per listing per day', async () => {
    expect(await firstView({ userId: 'a' }, 'L1')).toBe(true);
    expect(await firstView({ userId: 'a' }, 'L1')).toBe(false);
    expect(await firstView({ userId: 'b' }, 'L1')).toBe(true);
    expect(await firstView({ userId: 'a' }, 'L2')).toBe(true);
    expect(await firstView({ ip: '1.2.3.4' }, 'L1')).toBe(true);
    expect(await firstView({ ip: '1.2.3.4' }, 'L1')).toBe(false);
  });

  it('getServiceById does not count a repeat view by the same visitor', async () => {
    jest.resetModules();
    jest.doMock('../utils/cache', () => ({ get: jest.fn().mockResolvedValue(null), set: jest.fn() }));
    const Service = require('../models/Service');
    const listing = { _id: '64b000000000000000000001', status: 'open', userId: { _id: 'owner' }, toObject() { return { views: this.views }; } };
    jest.spyOn(Service, 'findById').mockReturnValue({ populate: () => ({ lean: async () => listing }) });
    const inc = jest.spyOn(require('../utils/viewCounter'), 'count').mockResolvedValue();
    const { getServiceById } = require('../controllers/services/browseController');
    const res = { json: jest.fn(), status() { return this; } };
    for (let i = 0; i < 3; i++) await getServiceById({ params: { id: listing._id }, ip: '9.9.9.9' }, res);
    expect(inc).toHaveBeenCalledTimes(1);
  });
});
