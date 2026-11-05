/**
 * Risk rule thresholds. Defaults here; a developer can override any of them (GlobalConfig key
 * "security.riskConfig", merged per rule), so tuning needs no deploy.
 */
const CONFIG_KEY = 'security.riskConfig';

const DEFAULTS = {
  /** A — one installation across several networks in a short time. */
  multiIp: { windowMin: 60, minNetworks: 4 },
  /** B — a normal network, then a VPN/proxy or Tor one. */
  vpnTransition: { windowDays: 7 },
  /** C — several accounts on one installation. */
  multiAccount: { windowDays: 30, minAccounts: 3 },
  /** D — failed sign-ins, worse together with changing networks. */
  loginAbuse: { windowMin: 10, minFailures: 5 },
  /** E — requests the rate limiter refused. */
  requestAbuse: { windowMin: 15, minRateLimited: 20 },
  /** F — account/payout changes from a new installation-IP pair or a VPN. */
  sensitiveOps: { newPairHours: 24 },
  /** Score bands (0–100). */
  bands: { medium: 25, high: 50, critical: 75 },
};

/** Pure: defaults + overrides, one level deep; non-numbers in overrides are ignored. */
function mergeConfig(overrides) {
  const out = {};
  for (const [section, values] of Object.entries(DEFAULTS)) {
    const o = overrides && typeof overrides[section] === 'object' ? overrides[section] : {};
    out[section] = { ...values };
    for (const [k, v] of Object.entries(o))
      if (k in values && typeof v === 'number' && Number.isFinite(v) && v >= 0) out[section][k] = v;
  }
  return out;
}

async function getConfig() {
  try {
    const doc = await require('../../../models/GlobalConfig').findOne({ key: CONFIG_KEY }).lean();
    return mergeConfig(doc?.value);
  } catch {
    return mergeConfig(null);
  }
}

module.exports = { CONFIG_KEY, DEFAULTS, mergeConfig, getConfig };
