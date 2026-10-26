/**
 * Public job reads are cached (utils/cache namespace "services"). Proves against a REAL MongoDB
 * that a write clears the cache, the view counter does not, and non-public jobs are never cached.
 * Opt-in: SAFEPAY_REAL_MONGO_URI=mongodb://127.0.0.1:27017/jobblo-services-cache-test npx jest servicesCache
 */
const mongoose = require('mongoose');
const Service = require('../models/Service');
require('../models/User'); // populated by getServiceById
const cache = require('../utils/cache');
const { getServiceById } = require('../controllers/services/browseController');

const uri = process.env.SAFEPAY_REAL_MONGO_URI;
const run = uri && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/[\w-]+-test(\?.*)?$/.test(uri) ? describe : describe.skip;

const call = async (req) => {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await getServiceById({ headers: {}, ...req }, res);
  return res;
};
const key = (id) => `services:detail:${id}`;
const settle = () => new Promise((r) => setTimeout(r, 50)); // hooks invalidate without awaiting

run('services cache (real MongoDB)', () => {
  const ownerId = new mongoose.Types.ObjectId();
  let job;

  beforeAll(async () => {
    await mongoose.connect(uri, { dbName: 'jobblo-test-services-cache' });
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
  beforeEach(async () => {
    cache._local.clear();
    await mongoose.connection.collection('users').updateOne({ _id: ownerId }, { $set: { name: 'Ola' } }, { upsert: true }); // populated seller
    job = await Service.create({
      userId: ownerId,
      title: 'Male gjerde',
      price: 800,
      categories: ['Maling'],
      location: { type: 'Point', coordinates: [10.75, 59.91], city: 'Oslo' },
    });
    await settle();
  });

  test('a public job is cached on first read and served from the cache after', async () => {
    const first = await call({ params: { id: String(job._id) } });
    expect(first.statusCode).toBe(200);
    expect(await cache.get(key(job._id))).toMatchObject({ title: 'Male gjerde' });

    await Service.collection.updateOne({ _id: job._id }, { $set: { title: 'changed behind the cache' } }); // no hooks
    const second = await call({ params: { id: String(job._id) } });
    expect(second.body.title).toBe('Male gjerde');
  });

  test('the view counter does not clear the cache, a real change does', async () => {
    await call({ params: { id: String(job._id) } });
    await Service.updateOne({ _id: job._id }, { $inc: { views: 1 } });
    await settle();
    expect(await cache.get(key(job._id))).toBeDefined();

    await Service.updateOne({ _id: job._id }, { $set: { price: 900 } });
    await settle();
    expect(await cache.get(key(job._id))).toBeUndefined();
    expect((await call({ params: { id: String(job._id) } })).body.price).toBe(900);
  });

  test('a job that leaves the public statuses is not served from the cache', async () => {
    await call({ params: { id: String(job._id) } });
    await Service.findByIdAndUpdate(job._id, { status: 'cancelled' });
    await settle();
    const res = await call({ params: { id: String(job._id) } });
    expect(res.statusCode).toBe(404);
    expect(await cache.get(key(job._id))).toBeUndefined();
  });

  test('the owner reading a non-public job gets it, and it is not cached', async () => {
    await Service.updateOne({ _id: job._id }, { status: 'draft' });
    await settle();
    const res = await call({ params: { id: String(job._id) }, userId: String(ownerId) });
    expect(res.statusCode).toBe(200);
    expect(await cache.get(key(job._id))).toBeUndefined();
  });
});
