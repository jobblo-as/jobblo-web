/** Shared, pure helpers for the risk rules. */
const { isPublicIp } = require('../../../monitoring/fraud');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const t = (d) => (d ? new Date(d).getTime() : 0);
const within = (d, ms, now) => now - t(d) <= ms;

/** How sure we are that the rows belong to one installation. App ids are client-made. */
const baseConfidence = (device) =>
  device?.platform === 'app' ? 'possible' : device?.platform === 'web' ? 'likely' : 'possible';

/** IP intelligence confidence → alert confidence. */
const networkConfidence = (c) =>
  c === 'high' ? 'confirmed' : c === 'medium' ? 'likely' : 'possible';

/** Public observations only: private, loopback and NAT addresses are shared by everyone. */
const publicObs = (observations) => observations.filter((o) => isPublicIp(o.ip));

const uniq = (values) => [...new Set(values.filter(Boolean).map(String))];

const span = (rows, field = 'lastSeen') => {
  const times = rows.map((r) => t(r[field])).filter(Boolean);
  return {
    firstSeen: new Date(Math.min(...times)),
    lastSeen: new Date(Math.max(...times)),
  };
};

const ipEvidence = (o) => ({
  label: `${o.ip} · ${o.network?.class || 'unknown'}${o.network?.countryCode ? ` · ${o.network.countryCode}` : ''}${o.network?.asn ? ` · ${o.network.asn}` : ''}`,
  at: o.lastSeen,
  ref: { type: 'ip', id: o.ip },
});

module.exports = {
  MIN,
  HOUR,
  DAY,
  t,
  within,
  baseConfidence,
  networkConfidence,
  publicObs,
  uniq,
  span,
  ipEvidence,
};
