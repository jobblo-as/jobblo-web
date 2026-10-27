/**
 * Query cost of the hot public reads. Unit part always runs; the index part needs a REAL MongoDB:
 *   SAFEPAY_REAL_MONGO_URI=mongodb://127.0.0.1:27017/jobblo-perfq-test npx jest perfQueries
 */
const mongoose = require('mongoose');
const Service = require('../models/Service');
const User = require('../models/User');
const Order = require('../models/Order');
const Favorite = require('../models/Favorite');
const cache = require('../utils/cache');
const { memo } = require('../utils/memo');
const { foldLocationStats } = require('../controllers/locationFilterController');
const { computeDashboardStats } = require('../controllers/exploreController');
const { SORT_OPTIONS } = require('../utils/serviceSort');

describe('memo single-flight', () => {
  test('concurrent misses run the computation once, then it is served from the cache', async () => {
    cache._local.clear();
    let runs = 0;
    const compute = () => new Promise((r) => setTimeout(() => r({ n: ++runs }), 20));
    const all = await Promise.all(Array.from({ length: 50 }, () => memo('perfq:k', 30, compute)));
    expect(runs).toBe(1);
    expect(all.every((v) => v.n === 1)).toBe(true);
    expect(await memo('perfq:k', 30, compute)).toEqual({ n: 1 });
    expect(runs).toBe(1);
  });

  test('a failed computation is not cached and the next call retries', async () => {
    cache._local.clear();
    await expect(memo('perfq:err', 30, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await memo('perfq:err', 30, () => 7)).toBe(7);
  });
});

test('foldLocationStats counts each level like the three old $ne:null aggregations', () => {
  const groups = [
    { _id: { c: '03', m: '0301', a: 'A1' }, count: 2 },
    { _id: { c: '03', m: '0301' }, count: 3 },
    { _id: { c: '11', m: null, a: null }, count: 1 },
    { _id: { m: '1103' }, count: 4 },
  ];
  expect(foldLocationStats(groups)).toEqual({
    counties: { '03': 5, 11: 1 },
    municipalities: { '0301': 5, 1103: 4 },
    areas: { A1: 2 },
  });
});

const uri = process.env.SAFEPAY_REAL_MONGO_URI;
const run = uri && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/[\w-]+-test(\?.*)?$/.test(uri) ? describe : describe.skip;

/** Every stage name in a winning plan, e.g. ['LIMIT', 'FETCH', 'IXSCAN']. */
const stages = (ex) => {
  const out = [];
  const walk = (s) => s && (out.push(s.stage), walk(s.inputStage), (s.inputStages || []).forEach(walk));
  walk(ex.queryPlanner.winningPlan.queryPlan || ex.queryPlanner.winningPlan);
  return out;
};

run('hot queries use an index (real MongoDB)', () => {
  const PUB = { $in: ['open', 'active'] };
  beforeAll(async () => {
    await mongoose.connect(uri, { dbName: 'jobblo-test-perfq' });
    const users = Array.from({ length: 200 }, (_, i) => ({
      _id: new mongoose.Types.ObjectId(),
      name: `U${i}`,
      reviewCount: i % 3,
      averageRating: (i % 5) + 0.3,
      isDeleted: i % 50 === 0,
    }));
    await User.collection.insertMany(users);
    const st = ['open', 'active', 'completed', 'cancelled'];
    await Service.collection.insertMany(
      Array.from({ length: 2000 }, (_, i) => ({
        userId: users[i % 200]._id,
        title: `J${i}`,
        price: (i * 37) % 5000,
        categories: [['Maling', 'Flytting', 'Rengjøring', 'Transport'][i % 4]],
        status: st[i % 4],
        urgent: i % 10 === 0,
        createdAt: new Date(Date.now() - i * 6e4),
      }))
    );
    await Order.collection.insertMany(Array.from({ length: 500 }, (_, i) => ({ serviceId: new mongoose.Types.ObjectId(), customerId: users[i % 200]._id, providerId: users[(i + 7) % 200]._id, status: 'paid', createdAt: new Date() })));
    await Favorite.collection.insertMany(Array.from({ length: 500 }, (_, i) => ({ user: users[i % 200]._id, service: new mongoose.Types.ObjectId() })));
    await Promise.all([Service, Order, Favorite].map((M) => M.createIndexes()));
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  // Every advertised sort, with and without a category filter: no in-memory SORT stage.
  for (const { value, sort } of SORT_OPTIONS) {
    for (const [label, extra] of [['all', {}], ['category', { categories: { $in: ['Maling'] } }], ['urgent', { urgent: true }]]) {
      if (label === 'urgent' && value !== 'newest') continue;
      test(`list ${value} / ${label} is index-sorted`, async () => {
        const ex = await Service.find({ status: PUB, ...extra }).sort(sort).limit(25).explain('executionStats');
        expect(stages(ex)).not.toContain('SORT');
        expect(stages(ex)).not.toContain('COLLSCAN');
        expect(ex.executionStats.totalDocsExamined).toBeLessThanOrEqual(26);
      });
    }
  }

  test('urgent count does not fetch every public listing', async () => {
    const ex = await mongoose.connection.db.command({ explain: { count: 'services', query: { status: PUB, urgent: true } }, verbosity: 'executionStats' });
    expect(ex.executionStats.totalDocsExamined).toBe(0);
  });

  test('order and favorite lookups by party / job use an index', async () => {
    const u = await User.findOne().lean();
    for (const q of [
      Order.find({ $or: [{ customerId: u._id }, { providerId: u._id }] }).sort({ createdAt: -1 }),
      Order.find({ serviceId: { $in: [new mongoose.Types.ObjectId()] } }),
      Favorite.find({ user: u._id }),
      Favorite.findOne({ user: u._id, service: new mongoose.Types.ObjectId() }),
    ]) {
      expect(stages(await q.explain('queryPlanner'))).not.toContain('COLLSCAN');
    }
  });

  test('dashboard stats aggregate equals the old hydrate-and-average result', async () => {
    const raters = await User.find({ reviewCount: { $gt: 0 }, isDeleted: { $ne: true } }).lean();
    const old = Math.round((raters.reduce((s, u) => s + u.averageRating, 0) / raters.length) * 10) / 10;
    expect(await computeDashboardStats()).toEqual({
      activeJobs: await Service.countDocuments({ status: PUB }),
      totalUsers: await User.countDocuments({ isDeleted: { $ne: true } }),
      averageRating: old,
    });
  });
});
