jest.mock('../models/Service', () => ({ aggregate: jest.fn() }));
jest.mock('../models/Order', () => ({ collection: { name: 'orders' } }));
const Service = require('../models/Service');
const {
  priceStats,
  completedPricesPipeline,
  realPriceStats,
  getPriceStats,
} = require('../controllers/services/priceStatsController');

// jobblo-pricing-config.json realPrices: 20+ jobs, 25th–75th percentile.
const range = (n) => Array.from({ length: n }, (_, i) => (i + 1) * 100);

test('too few prices (under 20) → nothing to suggest', () => {
  expect(priceStats(range(19))).toEqual({
    count: 19,
    low: null,
    median: null,
    high: null,
  });
});

test('25th / 50th / 75th percentile: one extreme job does not set the range', () => {
  const prices = [1, ...range(19).slice(1), 100000];
  expect(priceStats(prices)).toEqual({ count: 20, low: 600, median: 1100, high: 1500 });
});

test('zero, negative and non-numbers are ignored', () => {
  expect(priceStats([0, -5, NaN, 500, 600, 700, 800, 900]).count).toBe(5);
});

test('real prices: agreed price of completed orders, filtered by their job', () => {
  const p = completedPricesPipeline({ categories: 'Maling', countyCode: '03' });
  expect(p[0]).toEqual({ $match: { categories: 'Maling', countyCode: '03', status: 'completed' } });
  expect(p).toContainEqual({
    $match: { 'order.status': 'completed', 'order.agreedPrice': { $gt: 0 } },
  });
  expect(p.at(-1)).toEqual({ $project: { _id: 0, agreedPrice: '$order.agreedPrice' } });
});

test('a known job type uses only its own completed jobs, never the category mix', async () => {
  const filters = [];
  Service.aggregate.mockImplementation(async (pipeline) => {
    filters.push(pipeline[0].$match);
    return [];
  });
  const stats = await realPriceStats({
    category: 'Oppussing',
    jobType: 'Legge laminat',
    countyCode: '03',
  });
  expect(stats.median).toBeNull();
  expect(filters).toEqual([
    { categories: 'Oppussing', jobType: 'Legge laminat', countyCode: '03', status: 'completed' },
    { categories: 'Oppussing', jobType: 'Legge laminat', status: 'completed' },
  ]);
});

test('500 parallel asks run one query, and the next ask is served from the cache', async () => {
  Service.aggregate.mockReset();
  Service.aggregate.mockResolvedValue(range(25).map((agreedPrice) => ({ agreedPrice })));
  const all = await Promise.all(
    Array.from({ length: 500 }, () => realPriceStats({ category: 'Transport' }))
  );
  expect(Service.aggregate).toHaveBeenCalledTimes(1);
  expect(all.every((st) => st.median === 1300)).toBe(true);
  await realPriceStats({ category: 'Transport' });
  expect(Service.aggregate).toHaveBeenCalledTimes(1);
});

test('price-stats: operator objects and arrays in the query never reach the database', async () => {
  Service.aggregate.mockReset();
  Service.aggregate.mockResolvedValue([]);
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await getPriceStats(
    { query: { category: 'Hagearbeid', jobType: { $ne: '' }, countyCode: ['03'] } },
    res
  );
  expect(Service.aggregate.mock.calls[0][0][0].$match).toEqual({
    categories: 'Hagearbeid',
    status: 'completed',
  });
  await getPriceStats({ query: { category: { $gt: '' } } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
});
