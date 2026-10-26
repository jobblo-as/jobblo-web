const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/**
 * Password handling for accounts that have no password.
 *
 * `User.password` is `required: true`, so an OAuth-created account has to put
 * *something* in the field. What went in was a placeholder that looked like a
 * credential:
 *
 *   config/passport.js          password: 'oauth-user'      // a literal constant
 *   controllers/vippsController password: crypto.randomBytes(16).toString('hex')
 *   controllers/iduraAuth…      password: 'oauth-user'      // (route disabled)
 *
 * None of those is a bcrypt hash, and `bcrypt.compare(plaintext, notAHash)` returns
 * false rather than throwing (verified against bcryptjs 2.4.3), so none of them can
 * be used to log in *today*. The problem is that they are one careless change away
 * from being live credentials:
 *
 *   - 'oauth-user' is a constant shared by every Google account on the platform. The
 *     obvious "we should hash these" migration — bcrypt.hash(user.password) — would
 *     hand every one of those accounts the working password `oauth-user`.
 *   - the Vipps value is random, but it is still a plaintext secret sitting in the
 *     database, and a migration that hashed it would create a real password nobody
 *     asked for.
 *
 * The fix is to store something that is a valid bcrypt hash — so nothing downstream
 * has to special-case it — of a value nobody knows and nobody kept. 32 random bytes
 * are hashed and discarded. There is no plaintext that verifies against the result,
 * which is what "unusable" means here. Users who want a password use the existing
 * forgot-password flow, which sets a real one.
 */

/** Cost factor used everywhere else in the codebase (authController, adminController). */
const BCRYPT_ROUNDS = 12;

/**
 * bcryptjs is pure JS on the main thread: ~0.3-0.9 s of CPU per cost-12 compare, sliced into
 * ~100 ms chunks. Unbounded, N concurrent logins interleave so that EVERY one finishes only
 * after ~N x cost (50 logins: all ~39 s), each event-loop turn holds N chunks (GET / took
 * 9-30 s), and the MongoDB driver's heartbeats time out, failing unrelated queries with
 * MongoServerSelectionError. Measured with the load-break harness, 600 logins: 1 succeeded.
 *
 * So at most MAX_ACTIVE hashes run at once and the rest wait FIFO: logins complete one by one
 * at the same total throughput, and the loop stays responsive. Past MAX_WAITING the call
 * fails fast with code PASSWORD_HASH_BUSY (sendServerError answers 503 + Retry-After)
 * instead of hanging until the socket dies.
 * ponytail: one core per process for hashing; upgrade path is a worker_threads pool (or
 * native bcrypt on the libuv pool) if one process must sustain more than ~2-3 logins/s.
 */
const MAX_ACTIVE = 2;
const MAX_WAITING = 64;
let active = 0;
const waiting = [];
const counts = { done: 0, busy: 0, maxWaiting: 0 }; // since process start, for the developer console
function limited(fn) {
  return (...args) =>
    new Promise((resolve, reject) => {
      const run = () => {
        active += 1;
        Promise.resolve().then(() => fn(...args))
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            counts.done += 1;
            const next = waiting.shift();
            if (next) next();
          });
      };
      if (active < MAX_ACTIVE) return run();
      if (waiting.length >= MAX_WAITING) {
        counts.busy += 1;
        return reject(Object.assign(new Error('Password hashing is busy'), { code: 'PASSWORD_HASH_BUSY' }));
      }
      waiting.push(run);
      counts.maxWaiting = Math.max(counts.maxWaiting, waiting.length);
    });
}
/** Drop-in for bcrypt.compare / bcrypt.hash, bounded as above. */
const comparePassword = limited((plain, hash) => bcrypt.compare(plain, hash));
const hashPassword = limited((plain, rounds = BCRYPT_ROUNDS) => bcrypt.hash(plain, rounds));

/**
 * A bcrypt hash of 32 random bytes that are immediately thrown away.
 *
 * Returns a normal 60-character bcrypt hash, so `bcrypt.compare` treats it like any
 * other stored password and simply never matches.
 */
async function createUnusablePassword() {
  // 64 hex characters — comfortably under bcrypt's 72-byte input truncation, so the
  // full random value contributes to the digest.
  const secret = crypto.randomBytes(32).toString('hex');
  return hashPassword(secret);
}

/**
 * Is this stored value actually a bcrypt hash?
 *
 * Used by the login path as a defence in depth: a stored value that is not a hash
 * cannot have come from `bcrypt.hash`, so it is a placeholder or corrupted data and
 * must never be treated as a credential — whatever a future bcrypt version decides
 * to do when asked to compare against it.
 */
function isBcryptHash(value) {
  return typeof value === 'string' && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value);
}

/** Queue state of this process (developer console → Workers). */
const passwordQueueStats = () => ({ active, waiting: waiting.length, ...counts, maxActive: MAX_ACTIVE, maxQueue: MAX_WAITING });

module.exports = { passwordQueueStats, createUnusablePassword, isBcryptHash, comparePassword, hashPassword, BCRYPT_ROUNDS, MAX_ACTIVE, MAX_WAITING };
