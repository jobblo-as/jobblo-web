// Test jobs (~50): 5–6 in each of the 9 categories, Oslo 26 · Bergen 7 · Bærum 6 · Drammen 6 ·
// Akershus 5. Short and longer descriptions, fixed price / hourly / open bidding inside the
// pricing config's ranges, 22 with an Unsplash photo, some with dates and some flexible.
// Needs users.seed (every job's poster is one of those users).
const { load } = require('./load');

module.exports = () => load(['services']);
