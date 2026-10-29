const mongoose = require('mongoose');

/**
 * What happened at sign-in and password reset, per IP (services/monitoring/securityEvents
 * recordAuth): a login that worked or failed, a "forgot password" code sent, a password set.
 * Kept apart from SecurityEvent on purpose: every alert, report and risk score counts that
 * collection, and an ordinary successful login is not a security signal.
 * The email is stored masked (k***@example.no), as for failed logins.
 */
const authEventSchema = new mongoose.Schema({
  at: { type: Date, required: true },
  type: {
    type: String,
    required: true,
    enum: [
      'login',
      'login_failed',
      'password_reset_requested',
      'password_reset',
      'password_reset_failed',
    ],
  },
  ip: { type: String, default: null },
  email: { type: String, default: null },
  userAgent: { type: String, default: null },
});

authEventSchema.index({ ip: 1, at: -1 });
// Kept 90 days (security events: 30), long enough to look back at an account's sign-ins.
authEventSchema.index({ at: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

module.exports = mongoose.model('AuthEvent', authEventSchema);
