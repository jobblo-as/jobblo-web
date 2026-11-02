/**
 * "Dine utkast": a user's drafts are theirs alone, bounded in size and count.
 * Opt-in: SAFEPAY_REAL_MONGO_URI=mongodb://127.0.0.1:27017/jobblo-drafts-test npx jest jobDrafts
 */
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    const id = req.headers['x-test-user'];
    if (!id) return res.status(401).json({ error: 'auth' });
    req.user = { _id: new (require('mongoose').Types.ObjectId)(id) };
    next();
  },
}));

const uri = process.env.SAFEPAY_REAL_MONGO_URI;
const run =
  uri && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/[\w-]+-test(\?.*)?$/.test(uri)
    ? describe
    : describe.skip;

run('job drafts (real MongoDB)', () => {
  const app = express()
    .use(express.json({ limit: '1mb' }))
    .use('/api/job-drafts', require('../routes/jobDrafts'));
  const alice = String(new mongoose.Types.ObjectId());
  const bob = String(new mongoose.Types.ObjectId());
  const as = (user) => ({
    get: (p) => request(app).get(p).set('x-test-user', user),
    post: (p, b) => request(app).post(p).set('x-test-user', user).send(b),
    put: (p, b) => request(app).put(p).set('x-test-user', user).send(b),
    del: (p) => request(app).delete(p).set('x-test-user', user),
  });

  beforeAll(() => mongoose.connect(uri, { dbName: 'jobblo-test-drafts' }));
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  beforeEach(() => mongoose.connection.collection('jobdrafts').deleteMany({}));

  test('create, list, read, update, delete — owner only', async () => {
    const created = await as(alice).post('/api/job-drafts', {
      data: { title: 'Male bod', price: '900' },
    });
    expect(created.status).toBe(201);
    const id = created.body.draft._id;

    expect((await as(alice).get('/api/job-drafts')).body.drafts).toMatchObject([
      { _id: id, title: 'Male bod' },
    ]);
    expect((await as(alice).get(`/api/job-drafts/${id}`)).body.draft.data).toEqual({
      title: 'Male bod',
      price: '900',
    });
    expect(
      (await as(alice).put(`/api/job-drafts/${id}`, { data: { title: 'Male stor bod' } })).body
        .draft.title
    ).toBe('Male stor bod');

    // Bob sees nothing of it and cannot change or delete it.
    expect((await as(bob).get('/api/job-drafts')).body.drafts).toEqual([]);
    expect((await as(bob).get(`/api/job-drafts/${id}`)).status).toBe(404);
    expect((await as(bob).put(`/api/job-drafts/${id}`, { data: { title: 'x' } })).status).toBe(404);
    expect((await as(bob).del(`/api/job-drafts/${id}`)).status).toBe(404);

    expect((await as(alice).del(`/api/job-drafts/${id}`)).status).toBe(200);
    expect((await as(alice).get(`/api/job-drafts/${id}`)).status).toBe(404);
  });

  test('a draft saved by the app (jobblo-app post-job/draft.ts) fits and comes back unchanged', async () => {
    const data = {
      title: 'Male stua',
      description: 'x'.repeat(5000),
      categories: 'Maling',
      latitude: 59.91,
      longitude: 10.75,
      price: '3000',
      paymentType: 'Fastpris',
      checklistItems: [{ id: '1', text: 'Dekke til' }],
      smartFillPrompt: 'male stua',
      draftImageUrls: Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [
          `file:///data/user/0/no.jobblo.app/cache/ImagePicker/${'a'.repeat(36)}-${i}.jpg`,
          `https://jobblo.blob.core.windows.net/services/draft-${'b'.repeat(40)}-${i}.webp`,
        ])
      ),
      customerType: 'business',
      jobType: 'Male ett rom (vegger)',
    };
    const created = await as(alice).post('/api/job-drafts', { data });
    expect(created.status).toBe(201);
    const read = await as(alice).get(`/api/job-drafts/${created.body.draft._id}`);
    expect(read.body.draft.data).toEqual(data);
  });

  test('bad input is a 400/404, never stored', async () => {
    expect((await as(alice).post('/api/job-drafts', {})).status).toBe(400);
    expect((await as(alice).post('/api/job-drafts', { data: ['x'] })).status).toBe(400);
    expect(
      (await as(alice).post('/api/job-drafts', { data: { description: 'x'.repeat(40000) } })).status
    ).toBe(400);
    expect((await as(alice).get('/api/job-drafts/not-an-id')).status).toBe(404);
    expect((await request(app).get('/api/job-drafts')).status).toBe(401);
    expect(await mongoose.connection.collection('jobdrafts').countDocuments()).toBe(0);
  });

  test('at most 20 drafts per user', async () => {
    for (let i = 0; i < 20; i++)
      expect((await as(alice).post('/api/job-drafts', { data: { title: `d${i}` } })).status).toBe(
        201
      );
    const over = await as(alice).post('/api/job-drafts', { data: { title: 'one too many' } });
    expect(over.status).toBe(409);
    expect(over.body.code).toBe('DRAFT_LIMIT');
    expect((await as(bob).post('/api/job-drafts', { data: { title: 'bob' } })).status).toBe(201);
  });
});
