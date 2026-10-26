const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { createSession } = require('../utils/tokenUtils');
const { setAuthCookies } = require('./auth/authHelpers');
const { resolveOAuthLogin } = require('../utils/oauthLinking');
const { createUnusablePassword } = require('../utils/passwordUtils');
const { noStore } = require('../utils/oauthReturn');

/**
 * Native Sign in with Apple (iOS app): POST /api/auth/apple/native
 *   { identityToken, rawNonce, fullName?: { givenName?, familyName? } } -> { accessToken } + auth cookies
 *
 * The app gets the identity token straight from iOS (no browser, no redirect), so the only
 * proof here is the token itself: RS256 signed by a key in Apple's JWKS, iss = Apple,
 * aud = our bundle id, unexpired, and `nonce` = sha256(rawNonce) so a token lifted from
 * somewhere cannot be replayed without the nonce the app generated for that one attempt.
 *
 * Account linking is the shared policy in utils/oauthLinking.js, exactly as Google/Vipps:
 * an existing Apple identity logs in; a new one creates an account when the e-mail is free;
 * an e-mail already in use is refused (never linked by e-mail). Private relay addresses
 * (@privaterelay.appleid.com) are real, deliverable addresses and are treated like any other.
 * MFA needs nothing here: middleware/auth.js gates every session from createSession().
 */

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const JWKS_TTL_MS = 60 * 60 * 1000;
/** An unknown `kid` refetches at most this often, so junk tokens cannot hammer Apple. */
const JWKS_MIN_REFRESH_MS = 60 * 1000;

let cache = { keys: new Map(), fetchedAt: 0 };
let inflight = null;

async function fetchAppleKeys() {
  const res = await fetch(APPLE_JWKS_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Apple JWKS HTTP ${res.status}`);
  const body = await res.json();
  const keys = new Map();
  for (const jwk of Array.isArray(body?.keys) ? body.keys : []) {
    if (jwk?.kty === 'RSA' && typeof jwk.kid === 'string') {
      keys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
    }
  }
  cache = { keys, fetchedAt: Date.now() };
}

async function appleKey(kid) {
  const age = Date.now() - cache.fetchedAt;
  const known = cache.keys.has(kid);
  if (known ? age > JWKS_TTL_MS : age > JWKS_MIN_REFRESH_MS) {
    inflight ||= fetchAppleKeys().finally(() => {
      inflight = null;
    });
    try {
      await inflight;
    } catch (err) {
      // A stale key that Apple has not rotated out is still Apple's key.
      if (!known) throw err;
      console.warn('Apple JWKS refresh failed, using cached keys: %s', err.message);
    }
  }
  return cache.keys.get(kid) || null;
}

/** APPLE_BUNDLE_ID, else jobblo-app/app.json ios.bundleIdentifier (present in the monorepo). */
let appJsonBundleId;
function appleAudience() {
  const fromEnv = process.env.APPLE_BUNDLE_ID?.trim();
  if (fromEnv) return fromEnv;
  if (appJsonBundleId === undefined) {
    try {
      const appJson = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', '..', 'jobblo-app', 'app.json'), 'utf8')
      );
      appJsonBundleId = appJson?.expo?.ios?.bundleIdentifier || '';
    } catch {
      appJsonBundleId = '';
    }
  }
  return appJsonBundleId;
}

const sha256Hex = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Throws on anything that is not a fresh Apple token for this app and this nonce. */
async function verifyAppleIdentityToken(identityToken, rawNonce, audience) {
  const decoded = jwt.decode(identityToken, { complete: true });
  if (!decoded || decoded.header?.alg !== 'RS256' || typeof decoded.header.kid !== 'string') {
    throw new Error('not an RS256 JWT with a kid');
  }
  const key = await appleKey(decoded.header.kid);
  if (!key) throw new Error('unknown signing key');

  // Checks signature, alg, iss, aud and exp.
  const claims = jwt.verify(identityToken, key, {
    algorithms: ['RS256'],
    issuer: APPLE_ISSUER,
    audience,
  });

  const expected = Buffer.from(sha256Hex(rawNonce));
  const actual = Buffer.from(typeof claims.nonce === 'string' ? claims.nonce : '');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error('nonce mismatch');
  }
  if (typeof claims.sub !== 'string' || !claims.sub.trim()) throw new Error('no sub');
  return claims;
}

/** Apple sends booleans as `true` or as the string "true". */
function appleBool(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

/** Apple hands the name to the app on the FIRST sign-in only, never in the token. */
function cleanName(value) {
  return typeof value === 'string' ? value.trim().slice(0, 100) : '';
}

async function appleNativeSignIn(req, res) {
  noStore(res);
  const fail = (status, code, message) => res.status(status).json({ code, message });
  const { identityToken, rawNonce, fullName } = req.body || {};

  if (
    typeof identityToken !== 'string' ||
    identityToken.length > 8192 ||
    typeof rawNonce !== 'string' ||
    rawNonce.length < 16 ||
    rawNonce.length > 256
  ) {
    return fail(400, 'invalid_request', 'Apple-innloggingen mislyktes. Prøv igjen.');
  }

  const audience = appleAudience();
  if (!audience) {
    console.error('Apple sign-in: APPLE_BUNDLE_ID is not set and app.json is not readable');
    return fail(503, 'apple_unavailable', 'Apple-innlogging er ikke tilgjengelig akkurat nå.');
  }

  let claims;
  try {
    claims = await verifyAppleIdentityToken(identityToken, rawNonce, audience);
  } catch (err) {
    console.warn('Apple sign-in: rejected identity token (%s)', err.message);
    return fail(401, 'apple_invalid_token', 'Apple-innloggingen mislyktes. Prøv igjen.');
  }

  try {
    const decision = await resolveOAuthLogin({
      provider: 'apple',
      providerId: claims.sub,
      email: claims.email,
      emailVerified: appleBool(claims.email_verified),
    });

    let user;
    switch (decision.outcome) {
      case 'login':
        user = decision.user;
        break;
      case 'account_exists':
        return fail(
          409,
          'apple_account_exists',
          'Det finnes allerede en konto med denne e-postadressen. Logg inn med e-post og passord først.'
        );
      case 'create':
        if (!decision.email) {
          return fail(
            400,
            'apple_no_email',
            'Apple delte ingen e-postadresse, og den trengs for å opprette en konto.'
          );
        }
        user = await User.create({
          name: cleanName(fullName?.givenName) || 'Apple-bruker',
          lastName: cleanName(fullName?.familyName) || undefined,
          email: decision.email,
          password: await createUnusablePassword(),
          verified: false,
          role: 'user',
          oauthProviders: [{ provider: 'apple', providerId: claims.sub.trim() }],
          // Apple asserting the address is the proof sign-up otherwise asks a code for.
          ...(appleBool(claims.email_verified) === true && { emailVerifiedAt: new Date() }),
        });
        break;
      default:
        // invalid_identity cannot happen past verify (sub checked); linking is not offered here.
        return fail(401, 'apple_invalid_token', 'Apple-innloggingen mislyktes. Prøv igjen.');
    }

    if (user.isDeleted || ['inactive', 'deactivated'].includes(user.accountStatus)) {
      return fail(403, 'account_inactive', 'Kontoen er ikke aktiv.');
    }

    const { accessToken, refreshToken } = await createSession(req, user._id);
    setAuthCookies(res, accessToken, refreshToken);
    return res.json({ accessToken });
  } catch (err) {
    console.error('Apple sign-in failed: %s', err.message);
    return fail(500, 'apple_failed', 'Apple-innloggingen mislyktes. Prøv igjen.');
  }
}

module.exports = {
  appleNativeSignIn,
  verifyAppleIdentityToken,
  _resetAppleKeyCache: () => {
    cache = { keys: new Map(), fetchedAt: 0 };
  },
};
