const mongoose = require('mongoose');

/**
 * Auth / access security signals, derived from API responses by
 * services/monitoring/securityEvents.js. Kept 30 days.
 * `email` is masked (a***@domain) — enough to spot credential stuffing, not to identify.
 */
const securityEventSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    type: {
      type: String,
      required: true,
      enum: [
        'login_failed',
        'rate_limited',
        'ip_blocked',
        'permission_denied',
        'unauthenticated',
        'token_expired',
        'token_invalid',
        'session_revoked',
        'otp_failed',
        // Installation signals (services/security/observations)
        'device_new_ip',
        'device_new_account',
      ],
    },
    ip: { type: String, default: null },
    method: { type: String, default: null },
    route: { type: String, default: null },
    status: { type: Number, default: null },
    code: { type: String, default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    email: { type: String, default: null },
    emailHash: { type: String, default: null }, // HMAC of the full email: counts distinct accounts without storing them
    userAgent: { type: String, default: null },
    /** Pseudonymous installation (services/security/deviceId), when the request had one. */
    deviceKey: { type: String, default: null },
  },
  { versionKey: false }
);

securityEventSchema.index({ at: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
securityEventSchema.index({ type: 1, at: -1 });
securityEventSchema.index({ ip: 1, at: -1 });
securityEventSchema.index(
  { deviceKey: 1, at: -1 },
  { partialFilterExpression: { deviceKey: { $type: 'string' } } }
);

module.exports = mongoose.model('SecurityEvent', securityEventSchema);
