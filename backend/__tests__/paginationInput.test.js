/**
 * Bad `page` / `limit` is a 400 on every /api list endpoint (real app.js chain, a stub list
 * route behind it): missing is fine, text / decimal / negative / zero / huge / repeated are not.
 */
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = '';
delete process.env.REDIS_URL;
const request = require('supertest');

jest.mock('../routes/api', () => {
  const actual = jest.requireActual('../routes/api');
  return {
    ...actual,
    mountRoutes: (app) => {
      const { parsePagination } = require('../utils/pagination');
      app.get('/api/things', (req, res) => res.json(parsePagination(req.query)));
    },
  };
});

const app = require('../app');
const get = (qs) => request(app).get(`/api/things${qs}`);

it('missing params use the defaults', async () => {
  const r = await get('');
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ page: 1, limit: 20, skip: 0 });
});

it('valid params pass through', async () => {
  const r = await get('?page=3&limit=50');
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ page: 3, limit: 50, skip: 100 });
});

it.each([
  ['text limit', '?limit=abc'],
  ['decimal limit', '?limit=10.5'],
  ['negative limit', '?limit=-5'],
  ['zero limit', '?limit=0'],
  ['huge limit', '?limit=1000000'],
  ['limit over the global cap', '?limit=301'],
  ['text page', '?page=two'],
  ['negative page', '?page=-1'],
  ['zero page', '?page=0'],
  ['page past the last allowed', '?page=1001'],
  ['repeated param', '?limit=10&limit=20'],
  ['exponent', '?limit=1e3'],
])('%s is a 400', async (_name, qs) => {
  const r = await get(qs);
  expect(r.status).toBe(400);
  expect(r.body.code).toBe('INVALID_PAGINATION');
});
