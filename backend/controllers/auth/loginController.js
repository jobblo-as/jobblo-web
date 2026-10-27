const User = require('../../models/User');
const Session = require('../../models/Session');
const PushToken = require('../../models/PushToken');
const { isBcryptHash, comparePassword, hashPassword } = require('../../utils/passwordUtils');
const { generateTokens, verifyToken, createSession } = require('../../utils/tokenUtils');
const { sendOtpEmail } = require('../../utils/emailService');
const {
  windowCounter,
  CURRENT_TERMS_VERSION,
  sanitizeUser,
  sendServerError,
  validateRegisterInput,
  setAuthCookies,
  clearAuthCookies,
  emailUnverified,
  issueOtp,
  checkOtp,
  validatePasswordStrength,
  CLEAR_RESET_STATE,
} = require('./authHelpers');

/** Register (+ e-mail verification), login, logout and refresh-token rotation. */

/**
 * E-mail verification. Sign-up signs in straight away; the address is proven later from the
 * profile page (POST /email/send-code + /email/verify). Nothing is locked meanwhile: a proven
 * address is what account recovery relies on (first password reset of an unproven account
 * clears its sessions and providers, see passwordController).
 */
const VERIFY_EMAIL = 'verify-email';
const MAX_VERIFY_MAILS_PER_HOUR = 5;
const verifyMails = windowCounter('verifymail', 60 * 60 * 1000);
const normalizeEmail = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();
const EMAIL_TAKEN = { error: 'E-post er allerede registrert' };

/**
 * Mail a fresh 'verify-email' code. At most MAX_VERIFY_MAILS_PER_HOUR per address; queued,
 * so it returns without waiting for SMTP. False when the hourly cap stopped it.
 */
async function mailVerification(user) {
  if ((await verifyMails.incr(user.email)) > MAX_VERIFY_MAILS_PER_HOUR) return false;
  const otp = await issueOtp(user._id, VERIFY_EMAIL);
  await sendOtpEmail(user.email, otp, user.name, VERIFY_EMAIL);
  return true;
}

/**
 * Compared against when the account is missing or has no password, so a wrong e-mail
 * costs the same bcrypt time as a wrong password and response time does not reveal
 * which accounts exist. Hash of a throwaway string at the cost new passwords use (12).
 */
const DUMMY_HASH = '$2a$12$S3ecbRlwjQycSILm9J9UueiT3RlgHtXzg2nYm6/LV1ZITIYKglwju';

/**
 * Per-account lockout. LOCKOUT_PER_CLIENT failures for one e-mail from one IP within
 * LOCKOUT_MS block that pair, so a stranger cannot lock the owner out from their own
 * network; LOCKOUT_PER_EMAIL failures from anywhere block the e-mail (a botnet spread
 * over many IPs) for every client that has itself failed for it, so a client with no
 * failures (the owner, typing the right password) still gets in. Applies to unknown
 * e-mails too, so a lockout reveals nothing.
 */
const LOCKOUT_PER_CLIENT = 10;
const LOCKOUT_PER_EMAIL = 100;
const LOCKOUT_MS = 15 * 60 * 1000;
const clientFails = windowCounter('loginfail', LOCKOUT_MS);
const emailFails = windowCounter('loginfail-email', LOCKOUT_MS);
const clientKey = (req, email) => `${email}|${req.ip || ''}`;

exports.register = async (req, res) => {
  let createdUserId = null;

  try {
    const {
      name,
      lastName,
      email,
      password,
      role = 'user',
      companyName,
      orgNumber,
      acceptedTerms,
    } = req.body;

    const normalizedEmail = String(email || '')
      .trim()
      .toLowerCase();

    const validationError = validateRegisterInput({
      name,
      email: normalizedEmail,
      password,
      role,
      companyName,
      orgNumber,
      acceptedTerms,
    });

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    // ponytail: a taken address says so (accepted trade-off of signing in at sign-up:
    // account enumeration through this endpoint, limited by authLimiter). A neutral answer
    // would need the old "verify before sign-in" step back.
    if (await User.findOne({ email: normalizedEmail }).select('_id'))
      return res.status(400).json(EMAIL_TAKEN);

    const hashedPassword = await hashPassword(password);

    const user = await User.create({
      name: role === 'company' ? String(companyName).trim() : String(name || '').trim(),
      lastName: role === 'user' ? String(lastName || '').trim() : undefined,
      email: normalizedEmail,
      password: hashedPassword,
      role,
      companyName: role === 'company' ? String(companyName).trim() : undefined,
      orgNumber: role === 'company' ? String(orgNumber).trim() : undefined,
      acceptedTerms: true,
      termsVersion: CURRENT_TERMS_VERSION,
      termsAcceptedAt: new Date(),
      planType: role === 'company' ? 'business' : 'private',
    });

    createdUserId = user._id;

    const { accessToken, refreshToken } = await createSession(req, user._id);
    setAuthCookies(res, accessToken, refreshToken);

    // In the background: a mail failure must not undo a finished sign-up. "Send kode" on the
    // profile page sends a new one.
    mailVerification(user).catch((err) =>
      console.error('Sign-up verification mail failed: %s', err.message)
    );

    return res.status(201).json({ user: sanitizeUser(user), accessToken });
  } catch (error) {
    if (createdUserId) {
      await Promise.allSettled([
        User.deleteOne({ _id: createdUserId }),
        Session.deleteMany({ userId: createdUserId }),
      ]);
    }

    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }

    if (error.code === 11000) {
      return res.status(400).json(EMAIL_TAKEN); // lost a race on the unique index: same answer as above
    }

    return sendServerError(res, error, 'Register failed');
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email || '')
      .trim()
      .toLowerCase();

    if (!normalizedEmail || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const [byClient, byEmail] = await Promise.all([
      clientFails.get(clientKey(req, normalizedEmail)),
      emailFails.get(normalizedEmail),
    ]);
    if (byClient >= LOCKOUT_PER_CLIENT || (byClient > 0 && byEmail >= LOCKOUT_PER_EMAIL)) {
      return res.status(429).json({
        error: 'Too many failed attempts',
        message: 'For mange mislykkede forsøk. Prøv igjen om 15 minutter.',
        code: 'ACCOUNT_LOCKED',
      });
    }

    const user = await User.findOne({ email: normalizedEmail }).select('+password');

    /**
     * Refuse anything in `password` that is not actually a bcrypt hash.
     *
     * OAuth-created accounts used to carry a placeholder there -- the literal string
     * 'oauth-user' for Google and Idura, a random hex string for Vipps. Neither can be
     * used to log in today, because `bcrypt.compare` returns false when the stored
     * value will not parse as a hash (verified against bcryptjs 2.4.3), so this guard
     * changes no behaviour for any existing account.
     *
     * It is here so that stays true. 'oauth-user' was a constant shared by every Google
     * account on the platform, and the obvious "we should hash these" migration would
     * have handed all of them the working password `oauth-user`. New OAuth accounts get
     * a real hash of random bytes nobody kept (utils/passwordUtils.js); this line makes
     * the remaining legacy rows fail closed rather than depending on a library's
     * behaviour with malformed input.
     */
    const hasHash = Boolean(user) && isBcryptHash(user.password);
    const matches = await comparePassword(String(password), hasHash ? user.password : DUMMY_HASH);

    if (!hasHash || !matches) {
      await Promise.all([
        clientFails.incr(clientKey(req, normalizedEmail)),
        emailFails.incr(normalizedEmail),
      ]);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    await clientFails.reset(clientKey(req, normalizedEmail)); // the e-mail-wide count stays: it measures the attack

    if (
      user.isDeleted ||
      user.accountStatus === 'inactive' ||
      user.accountStatus === 'deactivated'
    ) {
      return res.status(403).json({
        error: 'Account inactive',
        message: 'Kontoen din er deaktivert.',
        code: 'account_inactive',
      });
    }

    const { accessToken, refreshToken } = await createSession(req, user._id);

    setAuthCookies(res, accessToken, refreshToken);

    return res.json({
      user: sanitizeUser(user),
      accessToken,
    });
  } catch (error) {
    return sendServerError(res, error, 'Login failed');
  }
};

/**
 * POST /api/auth/email/send-code (signed in) — mail a code to the account's own address.
 * 409 when it is already confirmed, 429 when the hourly mail cap is reached.
 */
exports.sendEmailCode = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('_id name email emailVerifiedAt createdAt');
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!emailUnverified(user))
      return res
        .status(409)
        .json({ error: 'E-posten er allerede bekreftet', code: 'EMAIL_ALREADY_VERIFIED' });
    if (!(await mailVerification(user))) {
      return res
        .status(429)
        .json({ error: 'For mange koder sendt. Prøv igjen om en time.', code: 'rate_limited' });
    }
    return res.json({ message: 'Vi har sendt en kode til ' + user.email + '.' });
  } catch (error) {
    return sendServerError(res, error, 'Send e-mail code failed');
  }
};

/** POST /api/auth/email/verify { code } (signed in) — confirm the address; touches nothing else. */
exports.confirmEmailCode = async (req, res) => {
  try {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!/^\d{6}$/.test(code))
      return res.status(400).json({ error: 'Skriv inn den 6-sifrede koden' });
    const user = await User.findById(req.userId).select('_id emailVerifiedAt createdAt');
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (!emailUnverified(user)) return res.json({ emailVerified: true });

    if (!(await checkOtp({ _id: user._id }, code, req.ip, VERIFY_EMAIL))) {
      return res.status(400).json({ error: 'Ugyldig eller utløpt kode' });
    }
    await User.updateOne(
      { _id: user._id },
      { $set: { emailVerifiedAt: new Date() }, ...CLEAR_RESET_STATE }
    );
    return res.json({ emailVerified: true });
  } catch (error) {
    return sendServerError(res, error, 'Verify e-mail code failed');
  }
};

/**
 * ponytail: legacy, for app/web builds from the "verify before sign-in" period; the current
 * clients use /email/send-code + /email/verify. Remove once no such build is in use.
 *
 * POST /api/auth/verify-email { email, code, password } — finish sign-up and sign in
 * (same tokens and cookies login gives; the 2FA gate in middleware/auth.js still applies).
 *
 * The code proves the mailbox; the password makes sure the account ends up with one the
 * mailbox owner knows. When it is not the stored one (someone else registered this address
 * first, or the owner signed up again with another password) it becomes the account's
 * password, and whatever the first registrant could have linked is dropped.
 */
exports.verifyEmail = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const { code, password } = req.body || {};
    if (!email || !code || typeof password !== 'string') {
      return res.status(400).json({ error: 'E-post, kode og passord er påkrevd' });
    }
    const passwordError = validatePasswordStrength(password);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const pending = await checkOtp({ email }, String(code), req.ip, VERIFY_EMAIL);
    const user = pending && (await User.findById(pending._id).select('+password'));
    // Only an account still waiting for proof: this endpoint can set the password, so a
    // verified account must never be reachable through it (password reset is the way there).
    if (!user || !emailUnverified(user))
      return res.status(400).json({ error: 'Ugyldig eller utløpt kode' });

    const samePassword =
      isBcryptHash(user.password) && (await comparePassword(password, user.password));
    const $set = {
      emailVerifiedAt: new Date(),
      ...(!samePassword && { password: await hashPassword(password), oauthProviders: [] }),
    };
    await User.updateOne({ _id: user._id }, { $set, ...CLEAR_RESET_STATE });
    if (!samePassword) await Session.deleteMany({ userId: user._id });
    user.set($set);

    if (require('../../middleware/auth').isInactiveAccount(user)) {
      return res.status(403).json({
        error: 'Account inactive',
        message: 'Kontoen din er deaktivert.',
        code: 'account_inactive',
      });
    }

    const { accessToken, refreshToken } = await createSession(req, user._id);
    setAuthCookies(res, accessToken, refreshToken);
    return res.json({ user: sanitizeUser(user), accessToken });
  } catch (error) {
    return sendServerError(res, error, 'Verify email failed');
  }
};

/** ponytail: legacy (see verifyEmail). POST /api/auth/resend-verification { email } — same answer whether or not a code went out. */
exports.resendVerification = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Vennligst oppgi en gyldig e-postadresse' });
    }
    const user = await User.findOne({ email }).select('_id name email emailVerifiedAt createdAt');
    if (emailUnverified(user)) await mailVerification(user);
    return res.json({
      message: 'Hvis e-postadressen venter på bekreftelse, har vi sendt en ny kode dit.',
    });
  } catch (error) {
    return sendServerError(res, error, 'Resend verification failed');
  }
};

exports.logout = async (req, res) => {
  try {
    const refreshToken = cookieString(req, 'refreshToken');

    const ended = [];
    if (refreshToken) {
      const session = await Session.findOneAndDelete({
        $or: [{ refreshToken }, { oldRefreshToken: refreshToken }],
      });
      if (session) ended.push(session._id);
    }
    // Clients that send a Bearer token (the mobile app) may not carry the refresh cookie;
    // the token's own session is ended too, so "Logg ut" always ends it server-side.
    if (req.sessionId && req.userId) {
      await Session.deleteOne({ _id: req.sessionId, userId: req.userId });
      ended.push(req.sessionId);
    }
    // The phone must stop getting this user's notifications even when the app's own
    // deactivation call failed: switch off the push tokens these sessions registered.
    if (ended.length) {
      await PushToken.updateMany({ sessionId: { $in: ended } }, { $set: { active: false } });
    }

    clearAuthCookies(res);

    return res.json({ message: 'Logged out successfully' });
  } catch (error) {
    return sendServerError(res, error, 'Logout failed');
  }
};

/** A string cookie or null — never an object a query would read as an operator. */
const cookieString = (req, name) =>
  typeof req.cookies?.[name] === 'string' ? req.cookies[name] : null;

/** How long a just-rotated-out refresh token still works (concurrent refreshes, lost responses). */
const ROTATION_GRACE_MS = 60 * 1000;
const rotatedJustNow = (session) =>
  Boolean(session?.rotatedAt) &&
  Date.now() - new Date(session.rotatedAt).getTime() < ROTATION_GRACE_MS;

exports.refreshToken = async (req, res) => {
  try {
    const refreshToken = cookieString(req, 'refreshToken');

    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token missing' });
    }

    let session = await Session.findOne({ refreshToken });

    if (!session) {
      session = await Session.findOne({ oldRefreshToken: refreshToken });

      if (session && !rotatedJustNow(session)) {
        // A rotated-out token used after the grace window: two parties hold this session's
        // tokens, and we cannot tell which one is the owner. End it (its sockets too).
        await Session.deleteOne({ _id: session._id });
        session = null;
      }
      if (!session) {
        clearAuthCookies(res);

        return res.status(401).json({
          error: 'Invalid session or expired grace period',
          code: 'SESSION_REVOKED',
        });
      }
    }

    let decoded;

    try {
      // Purpose-checked: an access token in the refreshToken cookie is rejected. The
      // token must also belong to the session row it was found in.
      decoded = verifyToken(refreshToken, 'refresh');
      if (
        String(decoded.sid) !== String(session._id) ||
        String(decoded.id) !== String(session.userId)
      ) {
        throw new Error('session mismatch');
      }
    } catch (error) {
      await Session.deleteOne({
        $or: [{ refreshToken }, { oldRefreshToken: refreshToken }],
      });

      clearAuthCookies(res);

      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const user = await User.findById(decoded.id).select('_id accountStatus isDeleted');

    if (!user) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'User not found' });
    }

    if (
      user.accountStatus === 'inactive' ||
      user.accountStatus === 'deactivated' ||
      user.isDeleted
    ) {
      clearAuthCookies(res);
      return res.status(403).json({
        error: 'Account inactive',
        message: 'Kontoen din er deaktivert.',
        code: 'account_inactive',
      });
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user._id, session._id);

    // Only the current token rotates. A token rotated out seconds ago (two tabs refreshing
    // at once) gets the session's current token back: rotating again used to orphan the
    // token the other tab had just received.
    let current =
      session.refreshToken === refreshToken
        ? await Session.findOneAndUpdate(
            { _id: session._id, refreshToken },
            {
              oldRefreshToken: refreshToken,
              refreshToken: newRefreshToken,
              rotatedAt: new Date(),
              lastUsed: new Date(),
            },
            { new: true }
          )
        : session;
    // Lost the race to a concurrent refresh with the same token: that one rotated it.
    if (!current)
      current = await Session.findOne({ _id: session._id, oldRefreshToken: refreshToken });

    if (!current || !(current.refreshToken === newRefreshToken || rotatedJustNow(current))) {
      clearAuthCookies(res);

      return res.status(401).json({
        error: 'Session could not be refreshed',
        code: 'SESSION_REVOKED',
      });
    }

    setAuthCookies(res, accessToken, current.refreshToken);

    return res.json({ message: 'Token refreshed', accessToken });
  } catch (error) {
    return sendServerError(res, error, 'Refresh token failed');
  }
};
