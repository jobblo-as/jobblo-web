const User = require('../models/User');
const Session = require('../models/Session');
const { verifyToken, deviceNameFrom } = require('../utils/tokenUtils');
const { withDefaults } = require('../utils/lean');

const LAST_USED_EVERY_MS = 60 * 1000;

/** A deactivated or deleted account may hold no live access (HTTP here, sockets in chat.socket.js). */
const isInactiveAccount = (user) =>
  user.accountStatus === 'inactive' || user.accountStatus === 'deactivated' || Boolean(user.isDeleted);

/**
 * Middleware to authenticate JWT tokens
 * Extracts and verifies JWT token from cookies or Authorization header
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const authenticate = async (req, res, next) => {
  try {
    // Bearer header first, cookie as fallback. React Native sends its native cookie jar on
    // every request, so after a logout that failed offline the jar still holds user A's
    // cookie while the header carries user B's token: cookie-first answered B as A.
    const authHeader = req.headers.authorization || '';
    const token =
      (authHeader.startsWith('Bearer ') && authHeader.slice(7).trim()) || req.cookies?.accessToken || req.cookies?.token;

    if (!token) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please log in',
        code: 'TOKEN_MISSING',
      });
    }

    // Verify token
    // Purpose-checked: a refresh token (cookie or Bearer) is rejected here.
    let decoded;
    try {
      decoded = verifyToken(token, 'access');
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'Token expired',
          message: 'Please log in again or refresh token',
          code: 'TOKEN_EXPIRED',
        });
      }
      throw err;
    }

    // CRITICAL: Check if the session still exists in DB using the session ID (sid) from token
    const sessionId = decoded.sid;
    if (!sessionId) {
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Session information missing from token',
      });
    }

    const sessionExists = await Session.findOne({
      _id: sessionId,
      userId: decoded.id,
    }).lean();

    if (!sessionExists) {
      // Clear cookies if session is invalid or revoked
      res.clearCookie('accessToken');
      res.clearCookie('refreshToken');
      return res.status(401).json({
        error: 'Session revoked',
        message: 'Your session has been terminated or is invalid',
        code: 'SESSION_REVOKED',
      });
    }

    // Update session lastUsed. The app's device model is filled in here too, so sessions
    // created before the app sent it, or by an OAuth login in the browser, get it as well.
    // At most once a minute per session: this ran a write on every authenticated request.
    const touch = {};
    if (!(Date.now() - new Date(sessionExists.lastUsed || 0).getTime() < LAST_USED_EVERY_MS)) touch.lastUsed = new Date();
    const deviceName = deviceNameFrom(req);
    if (deviceName && sessionExists.deviceName !== deviceName) touch.deviceName = deviceName;
    if (Object.keys(touch).length) await Session.updateOne({ _id: sessionExists._id }, { $set: touch });

    // Lean (hydrating the whole user was most of this middleware's CPU). Every reader of
    // req.user only reads it (mfa.js reloads by id before saving); `id` and the schema
    // defaults a document carried are put back so it reads the same.
    const lean = await User.findById(decoded.id).select('-password').lean();
    const user = lean && { ...withDefaults(User, lean, { populatedUsers: [] }), id: String(lean._id) };

    if (!user) {
      return res.status(401).json({
        error: 'User not found',
        message: 'Invalid authentication token',
      });
    }

    if (isInactiveAccount(user)) {
      return res.status(403).json({
        error: 'Account inactive',
        message: 'Kontoen din er deaktivert.',
        code: 'account_inactive',
      });
    }

    // Superadmins and developers must pass the authenticator code on this session before
    // anything else works — whichever way they signed in. Only the 2FA screens, their own
    // profile (so the app knows who they are) and logout stay open.
    if (require('../services/auth/mfa').requiresMfa(user) && !sessionExists.mfaVerifiedAt) {
      const path = String(req.originalUrl || '').split('?')[0];
      if (!/^\/api\/auth\/(mfa(\/|$)|profile$|logout$)/.test(path)) {
        return res.status(403).json({
          error: 'Two-factor authentication required',
          message: user.mfaEnabledAt ? 'Enter the code from your authenticator app.' : 'Set up an authenticator app to continue.',
          code: 'MFA_REQUIRED',
          setup: !user.mfaEnabledAt,
        });
      }
      req.mfaPending = true;
    }

    // Attach user to request object
    req.user = user;
    req.userId = user._id.toString();
    req.sessionId = sessionId;

    next();
  } catch (error) {
    // Already handled special cases above, only handle others here
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Authentication token is malformed',
      });
    }
    return res.status(500).json({
      error: 'Authentication error',
      message: 'Could not verify your sign-in. Try again.',
    });
  }
};

/**
 * Authenticate when the caller happens to be signed in, but never block them.
 *
 * For routes that serve logged-out visitors *and* want to recognise a member —
 * e.g. support tickets, where someone who cannot log in is the person most
 * likely to need help. A missing, expired or revoked token simply means the
 * request continues anonymously with `req.userId` unset.
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
const optionalAuthenticate = (req, res, next) => {
  const hasToken =
    req.cookies?.accessToken ||
    req.cookies?.token ||
    (req.headers.authorization || '').startsWith('Bearer ');

  if (!hasToken) return next();

  // Reuse `authenticate` verbatim rather than re-implementing token handling,
  // but swallow the rejection it would have sent so a bad token degrades to
  // "anonymous" instead of "denied". Exactly one `next()` runs either way.
  const silentRes = {
    status: () => silentRes,
    json: () => next(),
    clearCookie: () => silentRes,
  };

  authenticate(req, silentRes, next);
};

/**
 * Middleware factory: allow only the given roles.
 * Must be used AFTER authenticate middleware.
 *
 * @param {...string} roles - Roles allowed through
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Please authenticate first',
    });
  }

  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      error: 'Access denied',
      message: roles.includes('developer') ? 'Developer privileges required' : 'Admin privileges required',
    });
  }

  next();
};

const requireAdmin = requireRole('superAdmin');
const requireDeveloper = requireRole('developer', 'superAdmin');

/**
 * After authenticate: refuse (403 EMAIL_NOT_VERIFIED) an account whose e-mail was never
 * proven. On payout onboarding and BankID, so a stranger who registered someone else's
 * address cannot attach their own payout account or identity to it (A5).
 */
const requireVerifiedEmail = (req, res, next) => {
  const { emailUnverified, EMAIL_NOT_VERIFIED } = require('../controllers/auth/authHelpers');
  return emailUnverified(req.user) ? res.status(403).json(EMAIL_NOT_VERIFIED) : next();
};

module.exports = { authenticate, optionalAuthenticate, requireAdmin, requireDeveloper, requireRole, isInactiveAccount, requireVerifiedEmail };
