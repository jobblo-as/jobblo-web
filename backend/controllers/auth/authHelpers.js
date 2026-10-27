const User = require('../../models/User');
const crypto = require('crypto');
const {
  SENSITIVE_STRIP,
  EMAIL_PROOF_CUTOFF,
  emailUnverified,
} = require('../../utils/userProjections');
const { comparePassword, isBcryptHash } = require('../../utils/passwordUtils');

/** Shared auth helpers: password rules, emailed codes, cookies, sanitizers, register validation. */

/**
 * Mirrors the client-side rule in frontend/src/utils/validationLogic.ts.
 *
 * The backend only ever checked length >= 8, so anything that wasn't the browser
 * form — curl, a script, a mobile client — could create "aaaaaaaa" accounts. The
 * strength requirement is only real if the server enforces it too.
 */
const validatePasswordStrength = (password) => {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Passordet må være minst 8 tegn.';
  }
  if (!/[a-zæøå]/.test(password)) return 'Passordet må inneholde minst én liten bokstav.';
  if (!/[A-ZÆØÅ]/.test(password)) return 'Passordet må inneholde minst én stor bokstav.';
  if (!/\d/.test(password)) return 'Passordet må inneholde minst ett tall.';
  return null;
};

// ── Emailed 6-digit codes (forgot password, change password) ──────────────────
const MAX_OTP_ATTEMPTS = 5;
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const newOtp = () => String(crypto.randomInt(100000, 1000000));
const CLEAR_RESET_STATE = {
  $unset: {
    passwordResetToken: 1,
    passwordResetExpires: 1,
    passwordResetAttempts: 1,
    passwordResetSessionToken: 1,
    passwordResetSessionExpires: 1,
    otpPurpose: 1,
  },
};

/**
 * Fixed-window counters for per-account limits: in Redis when it is up (shared across
 * instances), else in this process's memory, like the rate limiters. Redis errors fail open.
 */
function windowCounter(name, windowMs) {
  const redis = require('../../config/redis');
  const local = new Map(); // key -> { count, resetAt }
  const redisKey = (key) => `${redis.PREFIX}:${name}:${sha256(key)}`;
  const client = () => {
    const c = redis.getRedis();
    return c && c.status === 'ready' ? c : null;
  };
  return {
    async get(key) {
      const c = client();
      if (c) return Number(await c.get(redisKey(key)).catch(() => 0)) || 0;
      const entry = local.get(key);
      return entry && entry.resetAt > Date.now() ? entry.count : 0;
    },
    async incr(key) {
      const c = client();
      if (c) {
        const k = redisKey(key);
        const count = await c.incr(k).catch(() => null);
        if (count === 1) await c.pexpire(k, windowMs).catch(() => {});
        return count || 0;
      }
      const now = Date.now();
      // ponytail: the memory fallback is per process and pruned only past 10k keys; Redis is the real store.
      if (local.size > 10000) for (const [k, v] of local) if (v.resetAt <= now) local.delete(k);
      const entry = local.get(key);
      if (entry && entry.resetAt > now) return ++entry.count;
      local.set(key, { count: 1, resetAt: now + windowMs });
      return 1;
    },
    async reset(key) {
      local.delete(key);
      const c = client();
      if (c) await c.del(redisKey(key)).catch(() => {});
    },
  };
}

// Wrong code guesses per hour, across codes: issueOtp resets the per-code attempts, so
// without this a fresh code every few guesses made per-account guessing unlimited. Counted
// per account + IP; the higher per-account ceiling (rotating IPs) only stops clients that
// have themselves missed, so nobody can fill it to lock the owner out of their own reset.
const MAX_OTP_GUESSES_PER_HOUR = 20;
const MAX_OTP_GUESSES_PER_ACCOUNT = 100;
const otpGuesses = windowCounter('otpguess', 60 * 60 * 1000);
const otpGuessesAccount = windowCounter('otpguess-account', 60 * 60 * 1000);

/**
 * Store a fresh code for the user (replacing any older one) and return it to email.
 * `purpose` keeps codes apart: an e-mail verification code ('verify-email') never passes a
 * password-reset check and vice versa. No purpose = the password flows.
 */
async function issueOtp(userId, purpose) {
  const otp = newOtp();
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        passwordResetToken: sha256(otp),
        passwordResetExpires: new Date(Date.now() + 10 * 60 * 1000),
        passwordResetAttempts: 0,
        ...(purpose && { otpPurpose: purpose }),
      },
      $unset: {
        passwordResetSessionToken: 1,
        passwordResetSessionExpires: 1,
        ...(!purpose && { otpPurpose: 1 }),
      },
    }
  );
  return otp;
}

/**
 * Check a guess against the user's pending code. Every guess atomically spends one of
 * MAX_OTP_ATTEMPTS on the ACCOUNT (an IP limit alone falls to rotating IPs), and the
 * last miss deletes the code, so a 6-digit code cannot be brute-forced.
 */
async function checkOtp(userFilter, otp, ip = '', purpose = null) {
  const account = String(userFilter._id ?? userFilter.email);
  const client = `${account}|${ip}`;
  const [byClient, byAccount] = await Promise.all([
    otpGuesses.get(client),
    otpGuessesAccount.get(account),
  ]);
  if (
    byClient >= MAX_OTP_GUESSES_PER_HOUR ||
    (byClient > 0 && byAccount >= MAX_OTP_GUESSES_PER_ACCOUNT)
  )
    return null;

  const counted = await User.findOneAndUpdate(
    {
      ...userFilter,
      passwordResetToken: { $type: 'string' },
      passwordResetExpires: { $gt: new Date() },
      passwordResetAttempts: { $not: { $gte: MAX_OTP_ATTEMPTS } },
      otpPurpose: purpose, // null also matches codes stored before purposes existed
    },
    { $inc: { passwordResetAttempts: 1 } },
    { new: true }
  ).select('+passwordResetToken +passwordResetAttempts');
  if (!counted) return null;

  const given = Buffer.from(sha256(otp));
  const stored = Buffer.from(counted.passwordResetToken);
  if (given.length === stored.length && crypto.timingSafeEqual(given, stored)) return counted;

  await Promise.all([otpGuesses.incr(client), otpGuessesAccount.incr(account)]);
  if (counted.passwordResetAttempts >= MAX_OTP_ATTEMPTS) {
    await User.updateOne(
      { _id: counted._id, passwordResetToken: counted.passwordResetToken },
      CLEAR_RESET_STATE
    );
  }
  return null;
}

/**
 * Check a signed-in user's current password (e-mail change, self-delete, change password).
 * A stolen session must not be able to brute-force it there: past MAX_CURRENT_PASSWORD_FAILS
 * wrong passwords in 15 minutes it throws code PASSWORD_ATTEMPTS (sendServerError -> 429).
 * `user` needs `_id` and `password` (+password). Accounts without a password always fail.
 */
const MAX_CURRENT_PASSWORD_FAILS = 10;
const currentPasswordFails = windowCounter('curpwfail', 15 * 60 * 1000);
async function verifyCurrentPassword(user, password) {
  const key = String(user._id);
  if ((await currentPasswordFails.get(key)) >= MAX_CURRENT_PASSWORD_FAILS) {
    throw Object.assign(new Error('Too many wrong passwords'), { code: 'PASSWORD_ATTEMPTS' });
  }
  if (typeof password !== 'string' || !password || !isBcryptHash(user.password)) return false;
  const ok = await comparePassword(password, user.password);
  if (!ok) await currentPasswordFails.incr(key);
  return ok;
}

// E-mail verification: EMAIL_PROOF_CUTOFF and emailUnverified live in utils/userProjections.js
// (the owner profile reports `emailVerified`), re-exported here for the auth code.

const isProduction = process.env.NODE_ENV === 'production';

// SameSite=Lax everywhere: the web app and the API are same-site (jobblo.no, nginx serves
// /api), and every OAuth callback is a top-level GET, which Lax still sends. None only
// widened CSRF exposure. The app's native cookie jar ignores SameSite.
const accessCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  maxAge: 60 * 60 * 1000, // 1 hour
};

const refreshCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

const clearCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
};

const allowedRoles = ['user', 'company'];
const CURRENT_TERMS_VERSION = '2026-01-08';

const sanitizeUser = (user) => {
  if (!user) return null;
  const userObject = typeof user.toObject === 'function' ? user.toObject() : { ...user };
  for (const key of SENSITIVE_STRIP) delete userObject[key];
  delete userObject.bankAccountNumber;
  delete userObject.iban;
  delete userObject.bicSwift;
  delete userObject.vippsHandle;
  // E-mail proof only; BankID is `verified` / identityVerification, which this never touches.
  userObject.emailVerified = !emailUnverified(user);
  return userObject;
};

const sanitizeSession = (session, currentSessionId) => {
  const sessionObject = typeof session.toObject === 'function' ? session.toObject() : session;

  delete sessionObject.refreshToken;
  delete sessionObject.oldRefreshToken;
  delete sessionObject.__v;

  return {
    ...sessionObject,
    isCurrent: sessionObject._id?.toString() === currentSessionId?.toString(),
  };
};

const sendServerError = (res, error, context = 'Server error') => {
  // Overload, not a fault: the bounded password-hash queue is full (utils/passwordUtils.js).
  if (error?.code === 'PASSWORD_HASH_BUSY') {
    res.set('Retry-After', '5');
    return res.status(503).json({ error: 'Server busy, try again shortly', code: 'SERVER_BUSY' });
  }
  if (error?.code === 'PASSWORD_ATTEMPTS') {
    return res
      .status(429)
      .json({
        error: 'For mange feil passord. Prøv igjen om 15 minutter.',
        code: 'PASSWORD_ATTEMPTS',
      });
  }
  console.error(context, error);

  return res.status(500).json({
    error: isProduction ? 'Something went wrong' : error.message,
  });
};

const validateRegisterInput = ({
  name,
  email,
  password,
  role,
  companyName,
  orgNumber,
  acceptedTerms,
}) => {
  // If role is company, we use companyName as the primary name
  const effectiveName = role === 'company' ? companyName : name;

  if (!effectiveName || !email || !password) {
    return 'Name, email and password are required';
  }

  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Valid email is required';
  }

  const passwordError = validatePasswordStrength(password);
  if (passwordError) return passwordError;

  if (role && !allowedRoles.includes(role)) {
    return 'Invalid role';
  }

  if (role === 'company') {
    if (!companyName) {
      return 'Company name is required';
    }

    if (!orgNumber || !/^\d{9}$/.test(String(orgNumber))) {
      return 'Organization number must be exactly 9 digits';
    }
  }

  if (acceptedTerms !== true) {
    return 'Du må godta Brukervilkårene for å opprette konto.';
  }

  return null;
};

const setAuthCookies = (res, accessToken, refreshToken) => {
  res.cookie('accessToken', accessToken, accessCookieOptions);
  res.cookie('refreshToken', refreshToken, refreshCookieOptions);
};

exports.validateRegisterInput = validateRegisterInput;
// Read by the developer console's privacy page (users on outdated terms).
exports.CURRENT_TERMS_VERSION = CURRENT_TERMS_VERSION;

const clearAuthCookies = (res) => {
  res.clearCookie('accessToken', clearCookieOptions);
  res.clearCookie('refreshToken', clearCookieOptions);
};

Object.assign(exports, {
  EMAIL_PROOF_CUTOFF,
  emailUnverified,
  windowCounter,
  validatePasswordStrength,
  MAX_OTP_ATTEMPTS,
  sha256,
  newOtp,
  CLEAR_RESET_STATE,
  issueOtp,
  checkOtp,
  verifyCurrentPassword,
  isProduction,
  accessCookieOptions,
  refreshCookieOptions,
  clearCookieOptions,
  allowedRoles,
  CURRENT_TERMS_VERSION,
  sanitizeUser,
  sanitizeSession,
  sendServerError,
  validateRegisterInput,
  setAuthCookies,
  clearAuthCookies,
});
