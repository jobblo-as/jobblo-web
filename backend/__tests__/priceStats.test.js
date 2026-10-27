const { priceStats } = require('../controllers/services/priceStatsController');

test('too few prices → nothing to suggest', () => {
  expect(priceStats([1000, 2000, 3000, 4000])).toEqual({ count: 4, low: null, median: null, high: null });
});

test('10th / 50th / 90th percentile: one extreme job does not set the range', () => {
  const prices = [1, 1500, 1800, 2000, 2200, 2500, 2600, 3000, 3200, 100000];
  expect(priceStats(prices)).toEqual({ count: 10, low: 1500, median: 2500, high: 3200 });
});

test('zero, negative and non-numbers are ignored', () => {
  expect(priceStats([0, -5, NaN, 500, 600, 700, 800, 900]).count).toBe(5);
});
