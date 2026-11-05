/**
 * ip-api.com, the provider the IP page already uses (services/monitoring/ipGeo.networkFor).
 *
 * Off in production unless IPINTEL_IPAPI=on: its free tier is for non-commercial use only and
 * plain HTTP, so every lookup sends a user's IP unencrypted to a third party outside the EEA.
 * Its "proxy" flag does not tell a VPN from a proxy, so it maps to vpn_proxy.
 */
const { networkFor } = require('../../../monitoring/ipGeo');

const enabled = () =>
  process.env.IPINTEL_IPAPI === 'on' ||
  (process.env.IPINTEL_IPAPI !== 'off' && process.env.NODE_ENV !== 'production');

module.exports = {
  name: 'ip-api',
  enabled,
  async lookup(ip, opts = {}) {
    if (!enabled()) return null;
    const net = await networkFor(ip, opts);
    if (!net || !net.countryCode) return null; // failed or unknown: say nothing
    return {
      vpnProxy: net.proxy === true,
      hosting: net.hosting === true,
      mobile: net.mobile === true,
      country: net.country,
      countryCode: net.countryCode,
      asn: net.as ? String(net.as).split(' ')[0] : null,
      isp: net.isp || net.org || null,
    };
  },
};
