const mongoose = require('mongoose');

const pushTokenSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true, index: true },
    // fcm: Android's native FCM token. expo: an Expo push token (iOS), sent via Expo's push service,
    // which holds the APNs key EAS made for the app.
    provider: { type: String, enum: ['fcm', 'expo'], default: 'fcm', index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    platform: { type: String, enum: ['ios', 'android'], required: true },
    deviceId: { type: String, trim: true },
    // The login session that registered it: logout deactivates the session's tokens server-side.
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', index: true },
    active: { type: Boolean, default: true, index: true },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PushToken', pushTokenSchema);
