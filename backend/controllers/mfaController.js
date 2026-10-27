const mfa = require('../services/auth/mfa');
const stepUp = require('../services/developer/stepUp');
const { logActivity } = require('../services/admin/activityService');
const { serverError } = require('../utils/serverError');

const MFA_FAILS_PER_DAY = 20;
const mfaFails = require('./auth/authHelpers').windowCounter('mfafail', 24 * 60 * 60 * 1000);

/** Authenticator-app 2FA endpoints. The session may be unverified here (see middleware/auth.js). */

const audit = (req, userId, description, metadata = {}) =>
  logActivity({
    adminId: req.user._id,
    action: 'other',
    targetModel: 'User',
    targetId: userId,
    description,
    metadata: { area: 'auth.mfa', ...metadata },
    ip: req.ip,
    userAgent: req.get('user-agent') || 'unknown',
  });

exports.status = async (req, res) => {
  const Session = require('../models/Session');
  const session = await Session.findById(req.sessionId).select('mfaVerifiedAt').lean();
  res.json({
    required: mfa.requiresMfa(req.user),
    enabled: Boolean(req.user.mfaEnabledAt),
    verified: Boolean(session?.mfaVerifiedAt),
  });
};

/**
 * Enrolment needs a code emailed to the account first. With the password alone, anyone could
 * register THEIR authenticator on an admin or developer who had not set one up yet (new,
 * promoted, or after a reset) and own the second factor (security review H9).
 */
exports.sendSetupCode = async (req, res) => {
  if (req.user.mfaEnabledAt)
    return res
      .status(409)
      .json({
        error: 'An authenticator is already set up.',
        message: 'An authenticator is already set up.',
      });
  try {
    await stepUp.sendCode(req.user);
    audit(req, req.user._id, 'Requested an email code to set up the authenticator app');
    res.json({
      sentTo: require('../services/monitoring/securityEvents').maskEmail(req.user.email),
    });
  } catch (err) {
    err.status
      ? res.status(err.status).json({ error: err.message, message: err.message })
      : serverError(res, err);
  }
};

exports.setup = async (req, res) => {
  try {
    await stepUp.verifyCode(req.user, req.sessionId, req.body?.emailCode);
  } catch (err) {
    audit(req, req.user._id, 'Authenticator setup refused: email code missing or wrong');
    return res
      .status(err.status || 400)
      .json({ error: err.message, message: err.message, code: 'MFA_SETUP_EMAIL_CODE' });
  }
  try {
    res.json(await mfa.startSetup(req.user._id));
  } catch (err) {
    err.status
      ? res.status(err.status).json({ error: err.message, message: err.message })
      : serverError(res, err);
  }
};

exports.verify = async (req, res) => {
  const { code, backupCode } = req.body || {};
  if (!code && !backupCode)
    return res
      .status(400)
      .json({
        error: 'Code required',
        message: 'Enter the 6-digit code from your authenticator app.',
      });
  try {
    const wasEnabled = Boolean(req.user.mfaEnabledAt);
    const r = await mfa.verify(req.user._id, req.sessionId, { code, backupCode });
    if (!r.ok) {
      audit(req, req.user._id, 'Two-factor code rejected', { backup: Boolean(backupCode) });
      // The route limiter allows 6 per 15 min forever. Past MFA_FAILS_PER_DAY the session that is
      // guessing ends (the password was right, so the owner is told); each further miss ends it again.
      const fails = await mfaFails.incr(String(req.user._id));
      if (fails >= MFA_FAILS_PER_DAY) {
        await require('../models/Session').deleteOne({ _id: req.sessionId, userId: req.user._id });
        if (fails === MFA_FAILS_PER_DAY) {
          audit(req, req.user._id, `Session ended after ${fails} wrong two-factor codes in 24 h`);
          require('../utils/emailService')
            .sendSecurityAlertEmail(
              req.user.email,
              'Mange feil tofaktorkoder på Jobblo-kontoen din',
              `Noen har skrevet riktig passord til Jobblo-kontoen din, men feil kode fra autentiseringsappen ${fails} ganger det siste døgnet. Økten er logget ut. Var det ikke deg, bytt passord nå.`
            )
            .catch(() => {});
        }
        return res
          .status(401)
          .json({
            error: 'Session ended',
            message: 'For mange feil koder. Du er logget ut.',
            code: 'MFA_SESSION_ENDED',
          });
      }
      // 400, not 401: the session is fine, the code is not — a 401 makes clients refresh and resend it.
      return res
        .status(400)
        .json({
          error: 'Invalid code',
          message: backupCode
            ? 'That backup code is not valid or was already used.'
            : 'Wrong or expired code. Check the time on your phone and try the newest code.',
          code: 'MFA_INVALID',
        });
    }
    audit(
      req,
      req.user._id,
      wasEnabled
        ? backupCode
          ? `Signed in with a backup code (${r.backupCodesLeft} left)`
          : 'Two-factor code accepted'
        : 'Authenticator app set up'
    );
    res.json({ verified: true, backupCodes: r.backupCodes, backupCodesLeft: r.backupCodesLeft });
  } catch (err) {
    err.status
      ? res.status(err.status).json({ error: err.message, message: err.message })
      : serverError(res, err);
  }
};

/** Super Admin: remove another user's authenticator (lost phone). They re-enrol at next sign-in. */
exports.resetForUser = async (req, res) => {
  const { id } = req.params;
  if (!require('mongoose').isValidObjectId(id))
    return res.status(400).json({ error: 'Invalid user id' });
  if (String(id) === String(req.user._id))
    return res
      .status(403)
      .json({ error: 'Ask another Super Admin to reset your own authenticator.' });
  const target = await require('../models/User')
    .findById(id)
    .select('email role mfaEnabledAt')
    .lean();
  if (!target) return res.status(404).json({ error: 'User not found' });
  await mfa.reset(id);
  audit(req, id, `Reset authenticator app for ${target.email} (all sessions signed out)`, {
    role: target.role,
    hadAuthenticator: Boolean(target.mfaEnabledAt),
  });
  res.json({ message: 'Authenticator removed; the user sets up a new one at next sign-in.' });
};
