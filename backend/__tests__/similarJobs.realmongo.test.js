/**
 * "Lignende oppdrag" (GET /api/services/:id/similar): open jobs in the same category, the most
 * alike title first (iPhone 17 → 17, 17 Pro, 17 Pro Max, 18, 16, 15 …), wherever they are.
 * Never another category, the job itself, a non-public job or a full one ("Fulltegnet"). Paged.
 * Opt-in: SAFEPAY_REAL_MONGO_URI=mongodb://127.0.0.1:27017/jobblo-similar-test npx jest similarJobs
 */
const mongoose = require('mongoose');

const uri = process.env.SAFEPAY_REAL_MONGO_URI;
const run =
  uri && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/[\w-]+-test(\?.*)?$/.test(uri)
    ? describe
    : describe.skip;

run('similar jobs (real MongoDB)', () => {
  const Service = require('../models/Service');
  const JobRequest = require('../models/JobRequest');
  require('../models/User');
  const { getSimilarServices } = require('../controllers/services/browseController');

  const seller = new mongoose.Types.ObjectId();
  const OSLO = [10.7522, 59.9139];
  const BERGEN = [5.3221, 60.3913]; // far away: distance no longer matters
  const ago = (min) => new Date(Date.now() - min * 60_000);
  const ids = {};
  const job = (
    title,
    { at = OSLO, categories = ['Elektronikk'], status = 'open', min = 10, ...rest } = {}
  ) => {
    ids[title] = new mongoose.Types.ObjectId();
    return {
      _id: ids[title],
      title,
      userId: seller,
      status,
      categories,
      location: { type: 'Point', coordinates: at },
      createdAt: ago(min),
      ...rest,
    };
  };

  const call = (id, query = {}) =>
    new Promise((resolve, reject) => {
      const res = {
        statusCode: 200,
        status: (c) => ((res.statusCode = c), res),
        json: (body) => resolve({ status: res.statusCode, body }),
      };
      getSimilarServices({ params: { id: String(id) }, query }, res).catch(reject);
    });
  const titles = (r) => r.body.data.map((s) => s.title);

  beforeAll(async () => {
    await mongoose.connect(uri, { dbName: 'jobblo-test-similar' });
    await mongoose.connection.db
      .collection('users')
      .insertOne({ _id: seller, name: 'Selger', email: 'selger@test.local' });
    await Service.collection.insertMany([
      job('Selge iPhone 17', { min: 1 }), // the job being viewed
      job('Selge iPhone 14', { min: 2 }),
      job('Selge iPhone 17 Pro Max', { at: BERGEN, min: 3 }),
      job('Selge iPhone 16', { min: 4 }),
      job('Selge iPhone 17 Pro', { min: 5 }),
      job('Selge iPhone 18', { at: BERGEN, min: 6 }),
      job('Selge iPhone 17 ', { min: 7 }), // same title (trailing space)
      job('Reparere TV', { min: 8 }), // same category, nothing in common: last
      job('Selge iPhone 15', { maxApplicants: 1, min: 9 }), // full: never
      job('Selge iPhone 17 Plus', { status: 'completed', min: 10 }), // closed: never
      job('Selge iPhone 17 Mini', { categories: ['Småjobber'], min: 11 }), // other category: never
      job('Tom', { categories: [], min: 12 }),
      job('Utkast', { status: 'draft', min: 13 }),
    ]);
    await JobRequest.collection.insertMany([
      {
        serviceId: ids['Selge iPhone 15'],
        customerId: new mongoose.Types.ObjectId(),
        status: 'pending',
      },
    ]);
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  test('most alike title first, distance does not matter', async () => {
    const r = await call(ids['Selge iPhone 17']);
    expect(r.status).toBe(200);
    expect(titles(r)).toEqual([
      'Selge iPhone 17 ',
      'Selge iPhone 17 Pro',
      'Selge iPhone 17 Pro Max',
      'Selge iPhone 18',
      'Selge iPhone 16',
      'Selge iPhone 14',
      'Reparere TV',
    ]);
    expect(r.body.data[0].userId).toMatchObject({ name: 'Selger' });
    expect(r.body.pagination).toMatchObject({ total: 7, page: 1, totalPages: 1 });
  });

  test('pages follow the same order without gaps or repeats', async () => {
    const all = titles(await call(ids['Selge iPhone 17']));
    const pages = [];
    for (let page = 1; page <= 4; page += 1) {
      const r = await call(ids['Selge iPhone 17'], { page: String(page), limit: '3' });
      expect(r.body.pagination).toMatchObject({ total: 7, limit: 3, totalPages: 3 });
      pages.push(...titles(r));
    }
    expect(pages).toEqual(all); // page 4 is empty
  });

  test('bad id, a non-public job and a job without a category', async () => {
    expect((await call('not-an-id')).status).toBe(400);
    expect((await call(ids.Utkast)).status).toBe(404);
    expect((await call(new mongoose.Types.ObjectId())).status).toBe(404);
    const none = await call(ids.Tom);
    expect(none.body.data).toEqual([]);
    expect(none.body.pagination.total).toBe(0);
  });
});
