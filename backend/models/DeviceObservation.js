const mongoose = require('mongoose');

/**
 * One installation seen from one IP: a single upserted row per (deviceKey, ip), counted, not a
 * row per request. `network` is filled later by the IP intelligence worker and says where the
 * classification came from and when. Removed 90 days after the pair was last seen.
 */
const deviceObservationSchema = new mongoose.Schema(
  {
    deviceKey: { type: String, required: true },
    ip: { type: String, required: true },
    /** /24 (IPv4) or /48 (IPv6): addresses that move within one network count once. */
    ipPrefix: { type: String, default: null },
    /** The account last seen on this pair, and its session. */
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', default: null },
    firstSeen: { type: Date, required: true },
    lastSeen: { type: Date, required: true },
    hits: { type: Number, default: 0 },
    /** Counts of the security-relevant events seen on this pair (login, login_failed, …). */
    events: { type: Map, of: Number, default: {} },
    network: {
      class: {
        type: String,
        enum: ['tor', 'vpn_proxy', 'hosting', 'mobile', 'residential', 'private', 'unknown'],
        default: 'unknown',
      },
      country: { type: String, default: null },
      countryCode: { type: String, default: null },
      asn: { type: String, default: null },
      isp: { type: String, default: null },
      confidence: { type: String, enum: ['high', 'medium', 'low'], default: 'low' },
      sources: { type: [String], default: [] },
      checkedAt: { type: Date, default: null },
    },
  },
  { versionKey: false }
);

deviceObservationSchema.index({ deviceKey: 1, ip: 1 }, { unique: true });
deviceObservationSchema.index({ deviceKey: 1, lastSeen: -1 });
deviceObservationSchema.index({ ip: 1, lastSeen: -1 });
deviceObservationSchema.index({ userId: 1, lastSeen: -1 });
deviceObservationSchema.index({ lastSeen: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

module.exports = mongoose.model('DeviceObservation', deviceObservationSchema);
