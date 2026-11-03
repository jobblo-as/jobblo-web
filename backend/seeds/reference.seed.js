// What the app needs before any user exists (categories have their own seed): global config
// (STRIPE_TEST_MODE on) and the homepage content. No location tree: addresses come from the map
// (Kartverket address search), not from a seeded county/municipality list.
const { load } = require('./load');

module.exports = () =>
  load(['globalconfigs', 'heros', 'homeheros', 'jobbloshops', 'upcomingfeatures']);
