const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    refreshToken: {
      type: String,
      required: true,
      unique: true,
    },
    oldRefreshToken: {
      type: String,
      default: null,
    },
    // When refreshToken last replaced oldRefreshToken. The reuse grace window is measured
    // from here; it used to use updatedAt, which every authenticated request bumps.
    rotatedAt: {
      type: Date,
      default: null,
    },
    ip: {
      type: String,
      required: true,
    },
    location: {
      type: String, // e.g. 'Oslo, Norway'
      default: 'Unknown',
    },
    userAgent: {
      type: String,
      required: true,
    },
    device: {
      type: String, // e.g. 'Windows Desktop'
      required: true,
    },
    // Model reported by the mobile app (X-Device-Name), e.g. 'iPhone 15 Pro'. Browsers
    // do not expose one, so web sessions keep this null. Display only, never trusted.
    deviceName: {
      type: String,
      default: null,
    },
    browser: {
      type: String, // e.g. 'Chrome'
      required: true,
    },
    os: {
      type: String, // e.g. 'Windows 10'
      required: true,
    },
    lastUsed: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // TTL index for automatic cleanup
    },
    // Set when the authenticator code was checked on this session (superAdmin/developer only).
    mfaVerifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Every way a session ends deletes its row (logout, revocation, password change or reset,
// deactivation, refresh-token reuse). Disconnect that session's sockets here, once, so no
// caller can forget. Query hooks only; ids are read before the delete, since it does not
// return them.
const DELETE_OPS = ['deleteOne', 'deleteMany', 'findOneAndDelete'];
sessionSchema.pre(
  DELETE_OPS,
  { document: false, query: true },
  async function collectEndedSessions() {
    try {
      const q = this.model.find(this.getFilter()).select('_id').lean();
      if (this.op !== 'deleteMany') q.limit(1);
      this._endedSessionIds = (await q).map((s) => s._id);
    } catch (err) {
      console.error('Session delete hook: lookup failed', err.message);
    }
  }
);
sessionSchema.post(
  DELETE_OPS,
  { document: false, query: true },
  async function disconnectEndedSessions() {
    const ids = this._endedSessionIds;
    require('../sockets/rooms').disconnectSessions(ids);
    // Push tokens were only switched off by /auth/logout, so a revoked or stolen phone
    // (revoke others, password change/reset, deactivation, refresh theft) kept getting notifications.
    if (!ids?.length) return;
    try {
      await require('./PushToken').updateMany(
        { sessionId: { $in: ids } },
        { $set: { active: false } }
      );
    } catch (err) {
      console.error('Session delete hook: push token deactivation failed', err.message);
    }
  }
);

module.exports = mongoose.model('Session', sessionSchema);
