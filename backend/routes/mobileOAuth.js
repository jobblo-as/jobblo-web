const express = require('express');
const passport = require('passport');
const { optionalAuthenticate } = require('../middleware/auth');
const { makeLimiter } = require('../middleware/rateLimiter');
const {
  oauthDestination,
  noStore,
  readCodeChallenge,
  signedInDestination,
  exchangeMobileCode,
} = require('../utils/oauthReturn');
const vippsController = require('../controllers/vippsController');
const appleAuth = require('../controllers/appleAuthController');
const { appleStartLimiter } = appleAuth;

const router = express.Router();

// Read by the Google state store (config/passport.js), which binds it to the OAuth
// state. Identity comes only from the authenticated session, never from the query.
function setGoogleLinkIntent(req) {
  if ((req.query.link === '1' || req.query.intent === 'link') && req.userId && req.sessionId) {
    req.googleLinkRequest = { userId: req.userId, sessionId: req.sessionId };
  }
}

async function googleStart(req, res, next) {
  noStore(res);
  setGoogleLinkIntent(req);
  req.oauthCodeChallenge = readCodeChallenge(req);
  return passport.authenticate('google-mobile', {
    scope: ['profile', 'email'],
  })(req, res, next);
}

function googleCallback(req, res, next) {
  passport.authenticate('google-mobile', { session: false }, async (err, user, info) => {
    if (err) {
      console.error('Google callback error:', err.message);
      return res.redirect(oauthDestination({ req, platform: 'mobile', error: 'google_failed' }));
    }
    if (!user) {
      return res.redirect(
        oauthDestination({ req, platform: 'mobile', error: info?.code || 'google_failed' })
      );
    }

    if (
      user.isDeleted ||
      user.accountStatus === 'inactive' ||
      user.accountStatus === 'deactivated'
    ) {
      return res.redirect(oauthDestination({ req, platform: 'mobile', error: 'account_inactive' }));
    }

    try {
      return res.redirect(
        await signedInDestination({
          req,
          res,
          platform: 'mobile',
          userId: user._id,
          codeChallenge: req.googleOAuthIntent?.codeChallenge,
        })
      );
    } catch (sessionError) {
      console.error('Google callback session error:', sessionError.message);
      return res.redirect(oauthDestination({ req, platform: 'mobile', error: 'google_failed' }));
    }
  })(req, res, next);
}

router.get('/google', optionalAuthenticate, googleStart);
// optionalAuthenticate so a link callback can be checked against the session that started it.
router.get('/google/callback', optionalAuthenticate, googleCallback);
router.get('/vipps', optionalAuthenticate, (req, res) =>
  vippsController.redirectToVipps(req, res, { platform: 'mobile' })
);
// optionalAuthenticate so a link callback can be checked against the session that started it.
router.get('/vipps/callback', optionalAuthenticate, (req, res) =>
  vippsController.vippsCallback(req, res, { platform: 'mobile' })
);

// Sign in with Apple for Android (Apple's web flow; iOS uses POST /api/auth/apple/native).
// 503 until APPLE_SERVICES_ID and APPLE_REDIRECT_URI are set. The callback is in app.js.
router.get('/apple', appleStartLimiter, (req, res) => appleAuth.appleWebStart(req, res, 'mobile'));

// The app redeems the one-time code from the deep link with its PKCE verifier.
// Counts failures only; codes are 256-bit and single use, so this is defence in depth.
const exchangeLimiter = makeLimiter('oauth-exchange', {
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'rate_limited', message: 'For mange forsøk. Vent litt og prøv igjen.' },
});
router.post('/exchange', exchangeLimiter, exchangeMobileCode);

module.exports = router;
module.exports.googleStart = googleStart;
module.exports.googleCallback = googleCallback;
