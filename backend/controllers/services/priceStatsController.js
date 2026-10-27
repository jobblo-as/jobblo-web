const Service = require('../../models/Service');

/**
 * "Pris basert på lignende oppdrag" for the app's post-a-job flow: low / median / high of what
 * jobs in the same category were agreed for, in the same county when there are enough of them,
 * otherwise nationwide. Low/high are the 10th/90th percentile, so one 1 kr or 100 000 kr job does
 * not set the range (FINN shows raw min/max: 10 kr … 43 400 kr).
 */
const MIN_SAMPLES = 5;
const MAX_SAMPLES = 500;
// Jobs whose price was actually agreed or paid, not just asked.
const AGREED = ['paid', 'in_progress', 'waiting_for_approval', 'completed'];

/** Pure: whole kroner, null when there are too few prices to say anything. */
function priceStats(prices) {
  const xs = prices.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (xs.length < MIN_SAMPLES) return { count: xs.length, low: null, median: null, high: null };
  const at = (q) => xs[Math.min(xs.length - 1, Math.max(0, Math.round(q * (xs.length - 1))))];
  return { count: xs.length, low: Math.round(at(0.1)), median: Math.round(at(0.5)), high: Math.round(at(0.9)) };
}

async function pricesFor(filter) {
  const rows = await Service.find({ status: { $in: AGREED }, price: { $gt: 0 }, ...filter })
    .sort({ updatedAt: -1 })
    .limit(MAX_SAMPLES)
    .select('price')
    .lean();
  return rows.map((r) => r.price);
}

exports.getPriceStats = async (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category.trim().slice(0, 80) : '';
  const countyCode = typeof req.query.countyCode === 'string' && /^\d{2}$/.test(req.query.countyCode) ? req.query.countyCode : '';
  if (!category) return res.status(400).json({ error: 'category er påkrevd.' });
  try {
    if (countyCode) {
      const local = priceStats(await pricesFor({ categories: category, countyCode }));
      if (local.median !== null) return res.json({ ...local, scope: 'county' });
    }
    return res.json({ ...priceStats(await pricesFor({ categories: category })), scope: 'country' });
  } catch (err) {
    console.error('[price-stats]', err.message);
    return res.status(500).json({ error: 'Kunne ikke hente prisforslag.' });
  }
};
exports.priceStats = priceStats;
