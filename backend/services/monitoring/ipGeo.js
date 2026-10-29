/**
 * Country (and city) for the IPs on the developer IP page. ip-api.com is the provider login
 * already uses for a session's location (utils/tokenUtils getGeoLocation); its batch endpoint
 * takes up to 100 IPs in one request. Each answer is cached 24 h per IP, so a page refresh
 * makes no outside call, and only the IPs on the page in view are ever looked up.
 *
 * ponytail: the free ip-api tier is http-only and 15 batch requests/minute; past that the
 * lookup fails and the page shows no country (nothing breaks). A local GeoIP database
 * (MaxMind GeoLite2) is the upgrade if the page gets heavy use.
 */
const axios = require('axios');
const cache = require('../../utils/cache');

const TTL_SEC = 24 * 3600;
const MISS_TTL_SEC = 3600;
const BATCH = 100;

/** Loopback and private ranges: no public location to look up. */
const isLocal = (ip) =>
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fc|fd|fe80:)/i.test(ip) ||
  ip === 'localhost';

/** ip → { country, countryCode, city } (null fields when unknown). Never throws. */
async function geoFor(ips, { post = axios.post } = {}) {
  const out = new Map();
  const missing = [];
  for (const ip of new Set(ips)) {
    if (isLocal(ip)) {
      out.set(ip, { country: 'Local network', countryCode: null, city: null });
      continue;
    }
    const hit = await cache.get(`ipgeo:${ip}`);
    if (hit) out.set(ip, hit);
    else missing.push(ip);
  }
  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH);
    try {
      const { data } = await post(
        'http://ip-api.com/batch?fields=status,country,countryCode,city,query',
        chunk,
        { timeout: 2500 }
      );
      for (const r of Array.isArray(data) ? data : []) {
        if (!chunk.includes(r?.query)) continue;
        const geo =
          r.status === 'success'
            ? {
                country: r.country || null,
                countryCode: r.countryCode || null,
                city: r.city || null,
              }
            : { country: null, countryCode: null, city: null };
        out.set(r.query, geo);
        await cache.set(`ipgeo:${r.query}`, geo, geo.country ? TTL_SEC : MISS_TTL_SEC);
      }
    } catch (err) {
      // Lookup down or rate limited: these rows simply show no country this time.
      console.error('[ip-geo] lookup failed:', err.code || err.message);
    }
  }
  return out;
}

module.exports = { geoFor, isLocal };
