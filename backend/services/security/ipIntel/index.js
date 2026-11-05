/**
 * IP intelligence, provider-agnostic: one classification per IP with where it came from and
 * when — never a verdict. A hosting or foreign address is not malicious, and a VPN is not fraud;
 * the risk rules weigh these as context.
 *
 * Providers answer null when they know nothing (off, timed out, failed); each has its own
 * timeout, so a slow one never holds the rest. Results are cached 24 h (1 h when nothing was
 * known). This runs in the security queue worker, never on the request path.
 *
 * Adding MaxMind (local GeoIP2 Anonymous IP database, nothing leaves the server) = one more
 * file in ./providers with the same lookup(ip) shape, listed in PROVIDERS.
 */
const cache = require('../../../utils/cache');
const { isLocal } = require('../../monitoring/ipGeo');

const PROVIDERS = [require('./providers/torExitList'), require('./providers/ipApi')];
const TIMEOUT_MS = Number(process.env.IPINTEL_TIMEOUT_MS) || 3000;
const TTL_SEC = 24 * 3600;
const MISS_TTL_SEC = 3600;
const KEY = (ip) => `ipintel:v1:${ip}`;

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms).unref?.())]);

/** Pure: provider answers → one classification. Unit-tested. */
function merge(answers, now = new Date()) {
  const got = answers.filter((a) => a && a.result);
  const sources = got.map((a) => a.name);
  const pick = (field) => got.map((a) => a.result[field]).find((v) => v != null) ?? null;
  const base = {
    country: pick('country'),
    countryCode: pick('countryCode'),
    asn: pick('asn'),
    isp: pick('isp'),
    sources,
    checkedAt: now,
  };
  const any = (field) => got.some((a) => a.result[field] === true);
  if (any('tor')) return { ...base, class: 'tor', confidence: 'high' };
  if (any('vpnProxy')) return { ...base, class: 'vpn_proxy', confidence: 'medium' };
  if (any('hosting')) return { ...base, class: 'hosting', confidence: 'medium' };
  if (any('mobile')) return { ...base, class: 'mobile', confidence: 'medium' };
  // "Residential" only means a network provider answered with none of the flags above.
  const networkAnswered = got.some((a) => a.result.countryCode);
  if (networkAnswered) return { ...base, class: 'residential', confidence: 'low' };
  return { ...base, class: 'unknown', confidence: 'low' };
}

/** Classification of one IP. Never throws. */
async function classify(ip, { providers = PROVIDERS, timeoutMs = TIMEOUT_MS, ...opts } = {}) {
  if (!ip) return merge([]);
  if (isLocal(ip)) return { ...merge([]), class: 'private', confidence: 'high' };
  const hit = await cache.get(KEY(ip)).catch(() => null);
  if (hit) return { ...hit, checkedAt: new Date(hit.checkedAt) };
  const answers = await Promise.all(
    providers.map(async (p) => {
      try {
        const result = await withTimeout(p.lookup(ip, opts), timeoutMs);
        return result ? { name: p.name, result } : null;
      } catch (err) {
        console.error(`[ip-intel] ${p.name} failed:`, err.code || err.message);
        return null;
      }
    })
  );
  const net = merge(answers);
  await cache.set(KEY(ip), net, net.class === 'unknown' ? MISS_TTL_SEC : TTL_SEC).catch(() => {});
  return net;
}

module.exports = { classify, merge, PROVIDERS };
