const rateLimit = require('express-rate-limit');

/**
 * Every rate limiter is built here. With REDIS_URL the counts live in Redis (one prefix per
 * limiter), so a limit is a limit across all API instances instead of per process; without
 * it, the in-memory store as before. If Redis is unreachable requests pass (fail open) rather
 * than every request failing — a missing rate limit for a minute beats an outage. Credential
 * limiters (auth, otp-*, mfa-verify) pass `passOnStoreError: false` and fail closed instead:
 * an outage must not hand a password / code guesser an unlimited budget.
 */
// Every limiter by name, for the Rate Limit Monitor (limits, and resetKey to unblock a client).
const LIMITERS = new Map();

function makeLimiter(name, options) {
  const redis = require('../config/redis');
  const client = redis.getRedis();
  let limiter;
  if (!client) limiter = rateLimit(options);
  else {
    const { RedisStore } = require('rate-limit-redis');
    // The store loads its Lua scripts once, at startup. If Redis is down then, that promise stays
    // rejected and the limiter fails open forever, even after Redis is back. A script's SHA is
    // just its SHA-1, so answer SCRIPT LOAD locally on failure; the first EVALSHA after Redis
    // returns gets NOSCRIPT, and the store reloads the script itself.
    const sha1 = (text) => require('node:crypto').createHash('sha1').update(text).digest('hex');
    const sendCommand = (command, ...args) => {
      const sent = client.call(command, ...args);
      return command === 'SCRIPT' && args[0] === 'LOAD' ? sent.catch(() => sha1(args[1])) : sent;
    };
    const store = new RedisStore({ sendCommand, prefix: `${redis.PREFIX}:rl:${name}:` });
    limiter = rateLimit({ ...options, store, passOnStoreError: options.passOnStoreError ?? true });
  }
  LIMITERS.set(name, {
    name,
    windowMs: options.windowMs,
    max: typeof options.max === 'number' ? options.max : null,
    failedOnly: Boolean(options.skipSuccessfulRequests),
    limiter,
  });
  return limiter;
}

// General API rate limiter
const apiLimiter = makeLimiter('api', {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 429,
    message: 'Too many requests from this IP, please try again after 15 minutes',
  },
});

// Stricter limiter for auth routes (login/register).
//
// This counts only FAILED attempts. It used to count every request — 10 per IP
// per hour, successes included — which punished the wrong people: a household,
// an office or a café shares one public IP, so ten ordinary sign-ins locked out
// everyone behind it for an hour. Behind a CDN or load balancer that is the
// entire user base sharing one address (see also `app.set('trust proxy')`).
//
// `skipSuccessfulRequests` keeps the control aimed at what it is actually for:
// someone guessing passwords fails, and burns the budget; someone who knows
// their password never touches it.
const authLimiter = makeLimiter('auth', {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // failed attempts only
  skipSuccessfulRequests: true,
  passOnStoreError: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 429,
    message: 'For mange mislykkede forsøk. Prøv igjen om 15 minutter.',
  },
});

// OTP send limiter — max 3 OTP requests per 15 minutes per IP
// Prevents spam/abuse of email sending
const otpSendLimiter = makeLimiter('otp-send', {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3,
  passOnStoreError: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'For mange forsøk. Vent 15 minutter før du prøver igjen.',
  },
});

// OTP verify limiter — max 5 attempts per 10 minutes per IP
// Prevents brute-force guessing of the 6-digit code
const otpVerifyLimiter = makeLimiter('otp-verify', {
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,
  passOnStoreError: false,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'For mange forsøk. Vent 10 minutter før du prøver igjen.',
  },
});

// Admin API rate limiter — 200 requests per IP per 15 minutes
const adminLimiter = makeLimiter('admin', {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'For mange forespørsler. Prøv igjen om 15 minutter.',
  },
});

const financeSyncLimiter = makeLimiter('finance-sync', {
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Avstemming er begrenset. Prøv igjen senere.',
  },
});

module.exports = {
  makeLimiter,
  LIMITERS,
  apiLimiter,
  authLimiter,
  otpSendLimiter,
  otpVerifyLimiter,
  adminLimiter,
  financeSyncLimiter,
};
