const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { createSession } = require('../utils/tokenUtils');
const { setAuthCookies } = require('./auth/authHelpers');
const { resolveOAuthLogin } = require('../utils/oauthLinking');
const { createUnusablePassword } = require('../utils/passwordUtils');
const {
  noStore,
  oauthDestination,
  platformStateSecret,
  readCodeChallenge,
  signedInDestination,
} = require('../utils/oauthReturn');

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
 *
 * Android and the website have no native Sign in with Apple, so they use Apple's WEB flow
 * (appleWebStart / appleWebCallback below): the same token checks with aud = the Services ID,
 * the same account rules (appleAccount), then the existing Google/Vipps endings.
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

/**
 * Throws on anything that is not a fresh Apple token for `audience` (the bundle id for the iOS
 * app, the Services ID for the web flow) whose `nonce` claim is exactly `expectedNonce`.
 */
async function verifyAppleIdentityToken(identityToken, expectedNonce, audience) {
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

  const expected = Buffer.from(typeof expectedNonce === 'string' ? expectedNonce : '');
  const actual = Buffer.from(typeof claims.nonce === 'string' ? claims.nonce : '');
  if (
    !expected.length ||
    expected.length !== actual.length ||
    !crypto.timingSafeEqual(expected, actual)
  ) {
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
    claims = await verifyAppleIdentityToken(identityToken, sha256Hex(rawNonce), audience);
  } catch (err) {
    console.warn('Apple sign-in: rejected identity token (%s)', err.message);
    return fail(401, 'apple_invalid_token', 'Apple-innloggingen mislyktes. Prøv igjen.');
  }

  try {
    const account = await appleAccount(claims, fullName);
    if (account.code) return fail(account.status, account.code, account.message);
    const { accessToken, refreshToken } = await createSession(req, account.user._id);
    setAuthCookies(res, accessToken, refreshToken);
    return res.json({ accessToken });
  } catch (err) {
    console.error('Apple sign-in failed: %s', err.message);
    return fail(500, 'apple_failed', 'Apple-innloggingen mislyktes. Prøv igjen.');
  }
}

/**
 * The account rules for a verified Apple token, shared by the native and the web flows:
 * `{ user }` to sign in, or `{ status, code, message }` for a refusal.
 */
async function appleAccount(claims, fullName) {
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
      return {
        status: 409,
        code: 'apple_account_exists',
        message:
          'Det finnes allerede en konto med denne e-postadressen. Logg inn med e-post og passord først.',
      };
    case 'create':
      if (!decision.email) {
        return {
          status: 400,
          code: 'apple_no_email',
          message: 'Apple delte ingen e-postadresse, og den trengs for å opprette en konto.',
        };
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
      return {
        status: 401,
        code: 'apple_invalid_token',
        message: 'Apple-innloggingen mislyktes. Prøv igjen.',
      };
  }

  if (user.isDeleted || ['inactive', 'deactivated'].includes(user.accountStatus)) {
    return { status: 403, code: 'account_inactive', message: 'Kontoen er ikke aktiv.' };
  }
  return { user };
}

// ── Web flow (Android app and the website) ────────────────────────────────────
//
// GET  /api/auth/mobile/apple?code_challenge=…&code_challenge_method=S256   (Android app)
// GET  /api/auth/web/apple                                                  (website)
//        -> 302 https://appleid.apple.com/auth/authorize (response_mode=form_post)
// POST /api/auth/apple/callback = APPLE_REDIRECT_URI (Apple posts state, id_token, code, user?)
//        mobile -> 303 /api/auth/mobile-return?state=success&code=<one-time code> -> jobblo://
//        web    -> auth cookies + 303 FRONTEND_URL/oauth-success, exactly like Google web
//
// Apple's form_post is a cross-site POST, so the SameSite=Lax session cookie never arrives on
// the callback. What the callback needs rides in `state` instead: a 10-minute HS256 JWT with
// its own audience (so it is never mistaken for, or accepted as, a session token) carrying the
// platform, the nonce Apple must echo inside its signed id_token, and
//   - mobile: the app's PKCE challenge; the one-time code is useless without the verifier.
//   - web: sha256 of a random value held in an httpOnly SameSite=None cookie set at the start
//     (sent on Apple's cross-site POST because it is None). Without that binding, someone
//     could replay their OWN Apple form_post from their own page into a victim's browser and
//     sign the victim in as them (login CSRF).
//
// No client secret: Apple's `code` is never exchanged. The id_token in the same POST is Apple's
// signed proof of the identity (JWKS signature, iss, aud = Services ID, exp, nonce), so neither
// the .p8 key nor a client-secret JWT is needed.

const APPLE_AUTHORIZE_URL = 'https://appleid.apple.com/auth/authorize';
const APPLE_STATE_AUDIENCE = 'jobblo:apple-web-state';
const APPLE_STATE_TTL_S = 10 * 60;
const WEB_BINDING_COOKIE = 'jobblo_apple_web';
const WEB_BINDING_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'none',
  path: '/api/auth/apple/callback',
};

/** Both set (the redirect URI over https, as Apple requires), or the web flow is off. */
function appleWebConfig() {
  const clientId = process.env.APPLE_SERVICES_ID?.trim();
  const redirectUri = process.env.APPLE_REDIRECT_URI?.trim();
  return clientId && redirectUri && /^https:\/\//i.test(redirectUri)
    ? { clientId, redirectUri }
    : null;
}

/** The decoded state when THIS server signed it in the last 10 minutes, else null. */
function readAppleState(value, secret) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const s = jwt.verify(value, secret, { algorithms: ['HS256'], audience: APPLE_STATE_AUDIENCE });
    if (typeof s.n !== 'string' || !s.n) return null;
    if (s.p === 'mobile' && typeof s.cc === 'string' && s.cc) return s;
    if (s.p === 'web' && typeof s.b === 'string' && s.b) return s;
    return null;
  } catch {
    return null;
  }
}

/** Apple posts `user` (a JSON string) on the first authorization only; anything odd is ignored. */
function appleWebName(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return undefined;
  try {
    const name = JSON.parse(raw)?.name;
    return { givenName: name?.firstName, familyName: name?.lastName };
  } catch {
    return undefined;
  }
}

function appleWebStart(req, res, platform) {
  noStore(res);
  const config = appleWebConfig();
  const secret = platformStateSecret();
  if (!config || !secret) {
    return res
      .status(503)
      .json({
        code: 'apple_unavailable',
        message: 'Apple-innlogging er ikke tilgjengelig akkurat nå.',
      });
  }

  const nonce = crypto.randomBytes(32).toString('hex');
  const claims = { p: platform, n: nonce };
  if (platform === 'mobile') {
    // A new flow: every build that calls it sends PKCE, so there is no token fallback to keep.
    claims.cc = readCodeChallenge(req);
    if (!claims.cc) return res.redirect(oauthDestination({ req, platform, error: 'apple_failed' }));
  } else {
    const binding = crypto.randomBytes(32).toString('base64url');
    claims.b = sha256Hex(binding);
    res.cookie(WEB_BINDING_COOKIE, binding, {
      ...WEB_BINDING_COOKIE_OPTIONS,
      maxAge: APPLE_STATE_TTL_S * 1000,
    });
  }

  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code id_token',
    scope: 'name email',
    response_mode: 'form_post',
    state: jwt.sign(claims, secret, {
      algorithm: 'HS256',
      audience: APPLE_STATE_AUDIENCE,
      expiresIn: APPLE_STATE_TTL_S,
    }),
    nonce,
  });
  // %20 as Apple's own JS writes it; no value holds a literal '+' (that would be %2B).
  return res.redirect(`${APPLE_AUTHORIZE_URL}?${query.toString().replace(/\+/g, '%20')}`);
}

const sameHash = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

async function appleWebCallback(req, res) {
  noStore(res);
  const body = req.body || {};
  const secret = platformStateSecret();
  const state = secret ? readAppleState(body.state, secret) : null;
  // Without a valid state the platform is unknown; the website is the safe place to land.
  const platform = state?.p === 'mobile' ? 'mobile' : 'web';
  // 303: the browser follows a POST's redirect with a GET.
  const back = (error) => res.redirect(303, oauthDestination({ req, platform, error }));

  const binding = req.cookies?.[WEB_BINDING_COOKIE];
  if (binding !== undefined) res.clearCookie(WEB_BINDING_COOKIE, WEB_BINDING_COOKIE_OPTIONS);

  const config = appleWebConfig();
  if (!config) return back('apple_failed');
  if (typeof body.error === 'string') {
    return back(body.error === 'user_cancelled_authorize' ? 'apple_cancelled' : 'apple_failed');
  }
  if (!state) {
    console.warn('Apple web sign-in: missing, forged or expired state');
    return back('apple_invalid_state');
  }
  if (
    platform === 'web' &&
    !(typeof binding === 'string' && sameHash(sha256Hex(binding), state.b))
  ) {
    console.warn('Apple web sign-in: state not bound to this browser');
    return back('apple_invalid_state');
  }
  if (typeof body.id_token !== 'string' || body.id_token.length > 8192)
    return back('apple_invalid_token');

  let claims;
  try {
    claims = await verifyAppleIdentityToken(body.id_token, state.n, config.clientId);
  } catch (err) {
    console.warn('Apple web sign-in: rejected identity token (%s)', err.message);
    return back('apple_invalid_token');
  }

  try {
    const account = await appleAccount(claims, appleWebName(body.user));
    if (account.code) return back(account.code);
    if (platform === 'mobile') {
      return res.redirect(
        303,
        await signedInDestination({
          req,
          res,
          platform,
          userId: account.user._id,
          codeChallenge: state.cc,
        })
      );
    }
    const { accessToken, refreshToken } = await createSession(req, account.user._id);
    setAuthCookies(res, accessToken, refreshToken);
    return res.redirect(303, oauthDestination({ req, platform, accessToken }));
  } catch (err) {
    console.error('Apple web sign-in failed: %s', err.message);
    return back('apple_failed');
  }
}

// Once each, shared by the mobile and web start routes and the callback (app.js). Every answer
// is a redirect (< 400), so these count all requests, not failures only.
const appleLimit = (name, max) =>
  require('../middleware/rateLimiter').makeLimiter(name, {
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { code: 'rate_limited', message: 'For mange forsøk. Vent litt og prøv igjen.' },
  });

module.exports = {
  appleNativeSignIn,
  appleWebStart,
  appleWebCallback,
  appleStartLimiter: appleLimit('apple-web-start', 30),
  appleCallbackLimiter: appleLimit('apple-web-callback', 30),
  verifyAppleIdentityToken,
  _resetAppleKeyCache: () => {
    cache = { keys: new Map(), fetchedAt: 0 };
  },
};
