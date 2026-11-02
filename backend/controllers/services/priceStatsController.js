const Service = require('../../models/Service');
const Order = require('../../models/Order');
const cache = require('../../utils/cache');
const { realPrices } = require('../../config/jobblo-pricing-config.json');
const { knownJobType } = require('../../utils/aiSmartFill');

/**
 * "Pris basert på lignende oppdrag" for the app's post-a-job flow: low / median / high of what
 * completed jobs in the same category were actually agreed for (the order's agreedPrice, not the
 * listing's asking price), in the same county when there are enough of them,
 * otherwise nationwide. Low/high are percentiles (25th/75th, jobblo-pricing-config.json), so one
 * 1 kr or 100 000 kr job does not set the range (FINN shows raw min/max: 10 kr … 43 400 kr).
 * Below `realPrices.minJobs` completed jobs the AI's table range is shown instead.
 */
const MIN_SAMPLES = realPrices.minJobs;
const MAX_SAMPLES = 500;

/** Pure: whole kroner, null when there are too few prices to say anything. */
function priceStats(prices) {
  const xs = prices.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (xs.length < MIN_SAMPLES) return { count: xs.length, low: null, median: null, high: null };
  const at = (q) => xs[Math.min(xs.length - 1, Math.max(0, Math.round(q * (xs.length - 1))))];
  return {
    count: xs.length,
    low: Math.round(at(realPrices.lowPercentile / 100)),
    median: Math.round(at(0.5)),
    high: Math.round(at(realPrices.highPercentile / 100)),
  };
}

/**
 * Completed jobs matching `filter` (categories, jobType, countyCode), newest first, joined to
 * their completed order's agreedPrice. Starts from the job side so the category index narrows
 * it first: joining every completed order before filtering took p95 7 s at 500 parallel users.
 * Approving the work marks the job `completed` (SafePayCheckoutController).
 */
function completedPricesPipeline(filter) {
  return [
    { $match: { ...filter, status: 'completed' } },
    { $sort: { updatedAt: -1 } },
    { $limit: MAX_SAMPLES },
    {
      $lookup: {
        from: Order.collection.name,
        localField: '_id',
        foreignField: 'serviceId',
        as: 'order',
      },
    },
    { $unwind: '$order' },
    { $match: { 'order.status': 'completed', 'order.agreedPrice': { $gt: 0 } } },
    { $project: { _id: 0, agreedPrice: '$order.agreedPrice' } },
  ];
}

async function pricesFor(filter) {
  const rows = await Service.aggregate(completedPricesPipeline(filter));
  return rows.map((r) => r.agreedPrice);
}

/**
 * Real prices (rule 9): for a known job type only that job type's completed jobs — a category's
 * mix (stairs at 10 000 kr) says nothing about laminate — otherwise the category's. The county
 * first when it alone has enough. Null fields when nothing has enough.
 */
async function computeRealPriceStats({ category, jobType, countyCode }) {
  const base = jobType ? { categories: category, jobType } : { categories: category };
  const tries = [countyCode && [{ ...base, countyCode }, 'county'], [base, 'country']].filter(
    Boolean
  );
  let stats;
  for (const [filter, scope] of tries) {
    stats = { ...priceStats(await pricesFor(filter)), scope };
    if (stats.median !== null) return stats;
  }
  return stats;
}

// ponytail: up to 10 min stale (a newly completed job shows up late); fine for a price hint.
const STATS_TTL_SEC = 600;
const pending = new Map();

/** computeRealPriceStats, cached; parallel misses for the same key share one query. */
async function realPriceStats(args) {
  const key = `price-stats:${args.category}|${args.jobType || ''}|${args.countyCode || ''}`;
  const cached = await cache.get(key);
  if (cached) return cached;
  if (!pending.has(key))
    pending.set(
      key,
      computeRealPriceStats(args)
        .then(async (stats) => {
          await cache.set(key, stats, STATS_TTL_SEC);
          return stats;
        })
        .finally(() => pending.delete(key))
    );
  return pending.get(key);
}

exports.getPriceStats = async (req, res) => {
  const category =
    typeof req.query.category === 'string' ? req.query.category.trim().slice(0, 80) : '';
  const countyCode =
    typeof req.query.countyCode === 'string' && /^\d{2}$/.test(req.query.countyCode)
      ? req.query.countyCode
      : '';
  const jobType = typeof req.query.jobType === 'string' ? knownJobType(req.query.jobType) : '';
  if (!category) return res.status(400).json({ error: 'category er påkrevd.' });
  try {
    return res.json(await realPriceStats({ category, jobType, countyCode }));
  } catch (err) {
    console.error('[price-stats]', err.message);
    return res.status(500).json({ error: 'Kunne ikke hente prisforslag.' });
  }
};
exports.priceStats = priceStats;
exports.completedPricesPipeline = completedPricesPipeline;
exports.realPriceStats = realPriceStats;
