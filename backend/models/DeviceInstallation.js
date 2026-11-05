const mongoose = require('mongoose');

/**
 * One browser installation (web cookie jb_did) or one app installation (X-Install-Id), as a
 * pseudonymous key — never the raw identifier (services/security/deviceId.js). It is not a
 * physical device: two browsers on one laptop are two installations, and a cleared or copied
 * cookie is a new or a shared one. Removed 180 days after it was last seen.
 */
const deviceInstallationSchema = new mongoose.Schema(
  {
    deviceKey: { type: String, required: true, unique: true },
    platform: { type: String, enum: ['web', 'app'], required: true },
    /** Browser and OS family only ("Chrome 131 · Windows 10"), not the full user agent. */
    uaFamily: { type: String, default: null, maxlength: 120 },
    firstSeen: { type: Date, required: true },
    lastSeen: { type: Date, required: true },
    /** Accounts seen on it; capped at MAX_USERS (more is a signal in itself, Phase 4). */
    userIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    /** Filled by the risk engine (Phase 4). */
    riskScore: { type: Number, default: null },
    riskBand: { type: String, enum: ['low', 'medium', 'high', 'critical', null], default: null },
  },
  { versionKey: false }
);

deviceInstallationSchema.index({ userIds: 1 });
deviceInstallationSchema.index({ lastSeen: -1 });
deviceInstallationSchema.index({ lastSeen: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });

deviceInstallationSchema.statics.MAX_USERS = 20;

module.exports = mongoose.model('DeviceInstallation', deviceInstallationSchema);
