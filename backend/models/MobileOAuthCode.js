const mongoose = require('mongoose');

/**
 * One-time code handed to the mobile app after a Google/Vipps sign-in (utils/oauthReturn.js).
 *
 * The deep link carries this code instead of an access token: any Android app can register
 * the `jobblo` scheme and receive the link, so what it carries must be useless without the
 * PKCE verifier that only the app that started the sign-in holds. Only the code's SHA-256 is
 * stored. Single use (deleted on exchange); the TTL index removes the ones never exchanged.
 */
const mobileOAuthCodeSchema = new mongoose.Schema({
  codeHash: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  /** base64url(SHA-256(code_verifier)), sent by the app when it started the flow (S256). */
  codeChallenge: { type: String, required: true },
  expiresAt: { type: Date, required: true },
});

mobileOAuthCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('MobileOAuthCode', mobileOAuthCodeSchema);
