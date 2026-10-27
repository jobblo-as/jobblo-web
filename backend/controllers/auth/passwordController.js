const User = require('../../models/User');
const Session = require('../../models/Session');
const IdentityClaim = require('../../models/IdentityClaim');
const { hashPassword } = require('../../utils/passwordUtils');
const crypto = require('crypto');
const { sendOtpEmail } = require('../../utils/emailService');
const {
  validatePasswordStrength,
  sha256,
  CLEAR_RESET_STATE,
  issueOtp,
  checkOtp,
  verifyCurrentPassword,
  sendServerError,
  emailUnverified,
} = require('./authHelpers');

/** Password change and reset with emailed one-time codes. */

/**
 * POST /api/auth/change-password/send-otp
 * Authenticated user — verify current password then send OTP to their email.
 */
exports.changePasswordSendOtp = async (req, res) => {
  try {
    const userId = req.user?._id || req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { currentPassword } = req.body;
    if (!currentPassword) {
      return res.status(400).json({ error: 'Nåværende passord er påkrevd' });
    }

    const user = await User.findById(userId).select('+password');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isValid = await verifyCurrentPassword(user, currentPassword);
    if (!isValid) {
      return res.status(400).json({ error: 'Nåværende passord er feil' });
    }

    const otp = await issueOtp(userId);
    await sendOtpEmail(user.email, otp, user.name);

    return res.json({ message: 'Kode sendt til e-posten din.' });
  } catch (error) {
    return sendServerError(res, error, 'Change password send OTP failed');
  }
};

/**
 * POST /api/auth/change-password/send-otp-no-password
 * Authenticated user — forgot current password flow.
 * Sends OTP without requiring current password (identity already confirmed via session).
 */
exports.changePasswordSendOtpNoPassword = async (req, res) => {
  try {
    const userId = req.user?._id || req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const otp = await issueOtp(userId);
    await sendOtpEmail(user.email, otp, user.name);

    return res.json({
      message: 'Kode sendt til e-posten din.',
      // Return masked email so frontend can show hint
      maskedEmail: user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3'),
    });
  } catch (error) {
    return sendServerError(res, error, 'Change password send OTP (no password) failed');
  }
};

/**
 * POST /api/auth/change-password/verify-otp
 * Verify OTP and change the password in one step.
 */
exports.changePasswordVerifyOtp = async (req, res) => {
  try {
    const userId = req.user?._id || req.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { otp, newPassword } = req.body;

    if (!otp || !newPassword) {
      return res.status(400).json({ error: 'Kode og nytt passord er påkrevd' });
    }

    const newPasswordError = validatePasswordStrength(newPassword);
    if (newPasswordError) {
      return res.status(400).json({ error: newPasswordError });
    }

    const user = await checkOtp({ _id: userId }, otp, req.ip);
    if (!user) {
      return res.status(400).json({ error: 'Ugyldig eller utløpt kode' });
    }

    const hashedPassword = await hashPassword(newPassword, 12);

    await User.updateOne(
      { _id: userId },
      { $set: { password: hashedPassword, emailVerifiedAt: new Date() }, ...CLEAR_RESET_STATE }
    );
    // Sign out every other device: a password change is how people lock out an intruder.
    await Session.deleteMany({ userId, _id: { $ne: req.sessionId } });

    return res.json({ message: 'Passordet er oppdatert.' });
  } catch (error) {
    return sendServerError(res, error, 'Change password verify OTP failed');
  }
};

/**
 * POST /api/auth/forgot-password
 * Generates a 6-digit OTP and emails it to the user.
 * Answers the same for known and unknown addresses, so it cannot be used to find out
 * who has an account.
 */
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = String(email || '')
      .trim()
      .toLowerCase();

    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Vennligst oppgi en gyldig e-postadresse' });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (user) {
      const otp = await issueOtp(user._id);
      await sendOtpEmail(user.email, otp, user.name); // queued: returns without waiting for SMTP
    } else {
      // Same database round trip as issueOtp, matching nothing, so the response time does not
      // reveal whether an account exists (the email itself is already sent from a queue).
      await User.updateOne(
        { _id: new (require('mongoose').Types.ObjectId)() },
        { $set: { passwordResetAttempts: 0 } }
      );
    }

    return res.json({
      message: 'Hvis det finnes en konto med denne e-postadressen, har vi sendt en kode dit.',
    });
  } catch (error) {
    return sendServerError(res, error, 'Forgot password failed');
  }
};

/**
 * POST /api/auth/verify-otp
 * Verifies the 6-digit OTP. Returns a short-lived reset token on success
 * that must be used immediately with reset-password.
 */
exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const normalizedEmail = String(email || '')
      .trim()
      .toLowerCase();

    if (!normalizedEmail || !otp) {
      return res.status(400).json({ error: 'E-post og kode er påkrevd' });
    }

    const user = await checkOtp({ email: normalizedEmail }, otp, req.ip);
    if (!user) {
      return res.status(400).json({ error: 'Ugyldig eller utløpt kode' });
    }

    // Code is valid and is now spent; hand out a short-lived (5 min) random reset token
    // in its own field.
    const resetToken = crypto.randomBytes(32).toString('hex');
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordResetSessionToken: sha256(resetToken),
          passwordResetSessionExpires: new Date(Date.now() + 5 * 60 * 1000),
        },
        $unset: { passwordResetToken: 1, passwordResetExpires: 1, passwordResetAttempts: 1 },
      }
    );

    return res.json({
      message: 'Kode bekreftet',
      resetToken, // send raw token to client; client uses it in reset-password
    });
  } catch (error) {
    return sendServerError(res, error, 'Verify OTP failed');
  }
};

/**
 * The first reset of an account whose e-mail was never proven (emailUnverified: no
 * emailVerifiedAt, created after EMAIL_PROOF_CUTOFF; older accounts count as proven): a
 * pre-hijacker may have attached THEIR payout destination and BankID identity before the owner
 * took it over. Those are dropped; the owner sets them up again. Since registration verifies
 * the e-mail and payout onboarding / BankID refuse unverified accounts, this only still bites
 * accounts registered between the cutoff and that deploy; kept as the backstop for them.
 */
const emailUnproven = (user) => {
  if (!emailUnverified(user)) return { cleared: false, $set: {}, $unset: {} };
  return {
    cleared: true,
    $set: {
      payoutEnabled: false,
      chargesEnabled: false,
      detailsSubmitted: false,
      payoutOnboardingStatus: 'none',
      payoutMethod: null,
      payoutVerified: false,
      ...(user.identityVerification?.subject ? { verified: false } : {}),
      ...(user.accountStatus === 'verified' ? { accountStatus: 'active' } : {}),
    },
    $unset: {
      stripeConnectAccountId: 1,
      stripeConnectAccountIdTest: 1,
      connectAccountCreatedAt: 1,
      bankAccountNumber: 1,
      iban: 1,
      bicSwift: 1,
      vippsHandle: 1,
      identityVerification: 1,
    },
  };
};

/**
 * POST /api/auth/reset-password
 * Resets the password using the reset token returned by verify-otp.
 */
exports.resetPassword = async (req, res) => {
  try {
    const { resetToken, password } = req.body;

    if (!resetToken || !password) {
      return res.status(400).json({ error: 'Token og passord er påkrevd' });
    }

    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    // Only the 32-byte token from verify-otp works here, never an emailed code, and it
    // is single-use: the compare-and-set below consumes it.
    const tokenFilter = {
      passwordResetSessionToken: sha256(resetToken),
      passwordResetSessionExpires: { $gt: new Date() },
    };
    const user = await User.findOne(tokenFilter).select(
      '_id emailVerifiedAt createdAt accountStatus identityVerification'
    );
    if (!user) {
      return res.status(400).json({ error: 'Ugyldig eller utløpt sesjonstoken. Start på nytt.' });
    }

    const hashedPassword = await hashPassword(password, 12);
    const firstProof = emailUnproven(user);

    const updated = await User.updateOne(
      { _id: user._id, ...tokenFilter },
      // A reset proves control of the e-mail, not of the linked Google/Vipps identities: an
      // attacker who pre-registered this address and linked their own provider would keep
      // signing in through it. Unlink them all; the owner re-links from the profile. (New
      // sign-ups can no longer link before verifying; this covers older accounts.)
      {
        $set: {
          password: hashedPassword,
          oauthProviders: [],
          emailVerifiedAt: new Date(),
          ...firstProof.$set,
        },
        $unset: { ...CLEAR_RESET_STATE.$unset, ...firstProof.$unset },
      }
    );
    if (updated.modifiedCount !== 1) {
      return res.status(400).json({ error: 'Ugyldig eller utløpt sesjonstoken. Start på nytt.' });
    }
    if (firstProof.cleared) await IdentityClaim.deleteMany({ userId: user._id });

    // Invalidate all sessions for security
    await Session.deleteMany({ userId: user._id });

    return res.json({
      message: firstProof.cleared
        ? 'Passordet er oppdatert. Du kan nå logge inn. Utbetalingskonto og BankID-verifisering må settes opp på nytt.'
        : 'Passordet er oppdatert. Du kan nå logge inn.',
      payoutAndIdentityReset: firstProof.cleared,
    });
  } catch (error) {
    return sendServerError(res, error, 'Reset password failed');
  }
};
