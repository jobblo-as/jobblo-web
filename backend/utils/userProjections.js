/**
 * Central projection / field allow-lists for User documents.
 * One guard — use these from every endpoint that touches a User response.
 *
 * Why explicit allow-lists instead of `.select('-password -bankAccountNumber ...')`?
 * A deny-list silently leaks every new sensitive field added later.
 * An allow-list shows *only* what we audited as safe for that audience.
 */

const SAFE_BASE = [
  '_id',
  'name',
  'lastName',
  'avatarUrl',
  'bannerUrl',
  'email',
  'phone',
  'role',
  'companyName',
  'orgNumber',
  'orgType',
  'website',
  'country',
  'address',
  'postNumber',
  'postSted',
  'averageRating',
  'reviewCount',
  'completedJobs',
  'earnings',
  'skills',
  'bio',
  'gender',
  'birthDate',
  'experience',
  'hourlyRate',
  'availabilityText',
  'locations',
  'portfolio',
  'previousProjects',
  'subscription',
  'monthlyContactUsage',
  'subscriptionStatus',
  'coins',
  'totalSpent',
  'totalEarned',
  'responseRate',
  'averageResponseTime',
  'repeatCustomersCount',
  'hireRate',
  'accountStatus',
  'providerStripeStatus',
  'isSafePayUser',
  'safePayActivatedAt',
  'membership',
  'verifiedWorkEmail',
  'addresses',
  'notificationPreferences',
  'onboardingStatus',
  'onboardingStep',
  'settings',
  'acceptedTerms',
  'termsVersion',
  'termsAcceptedAt',
  'googleId',
  'createdAt',
  'updatedAt',
  'lastLogin',
  'language',
  'lastContactReset',
  'isDeleted',
  // Stripe Connect *status* metadata is safe (not credentials).
  'stripeConnectAccountId',
  'payoutOnboardingStatus',
  'payoutEnabled',
  'chargesEnabled',
  'detailsSubmitted',
  'connectAccountCreatedAt',
  'payoutOnboardingLastRefreshedAt',
  'payoutMethod',
  'payoutVerified',
  // Loaded so it can be REDUCED to a display-safe summary below. The raw subdocument
  // never reaches a response — sanitizeUserPublic/Owner replace it. See
  // identityVerificationSummary for exactly which three fields survive.
  'identityVerification',
  // stripeCustomerId is safe to self/owner only; but our public list hides it below.
];

const SENSITIVE_STRIP = [
  'password',
  'bankAccountNumber',
  'iban',
  'bicSwift',
  'vippsHandle',
  '__v',
  'resetPasswordToken',
  'resetPasswordExpires',
  'otpHash',
  'otpExpires',
  'stripeCustomerId',
];

/**
 * What ANOTHER user may see: the public profile, search results, top lists.
 *
 * Its own allow-list, not "SAFE_BASE minus a few": that version sent every other logged-in
 * user the email, home address, birth date, earnings, last login, settings and Stripe ids
 * (security review C3). A new User field is private until it is added here on purpose.
 */
const PUBLIC_FIELDS = [
  '_id',
  'name',
  'lastName',
  'avatarUrl',
  'bannerUrl',
  'role',
  'companyName',
  'orgNumber',
  'orgType',
  'website',
  'postSted',
  'locations',
  'averageRating',
  'reviewCount',
  'completedJobs',
  'skills',
  'bio',
  'experience',
  'hourlyRate',
  'availabilityText',
  'portfolio',
  'previousProjects',
  'subscription',
  'responseRate',
  'averageResponseTime',
  'repeatCustomersCount',
  'hireRate',
  'isSafePayUser',
  'createdAt',
  // Reduced to the three badge fields by applyIdentitySummary; never sent raw.
  'identityVerification',
];

/** Response-only values endpoints add next to the stored fields. */
const PUBLIC_COMPUTED = [
  'id',
  'counts',
  'nearby',
  'postedJobsCount',
  'averageResponseTimeMinutes',
  'totalJobRequests',
  'completionRate',
  'jobsThisMonth',
  'reviews',
];

/** Safe for: public / other-user endpoints. Always prefer this over a hand-rolled select. */
const PUBLIC_USER_SELECT = PUBLIC_FIELDS.join(' ');

/**
 * Safe for: owner viewing THEIR OWN profile (slightly more fields + metadata).
 * Bank account numbers/IBAN/vipps handles are still EXCLUDED — they are now
 * stored with select:false and the UI should use Stripe Connect instead of
 * raw credentials; but if needed for admin audit, fetch explicitly.
 */
const OWN_USER_SELECT = [
  ...SAFE_BASE,
  'phone',
  'email',
  'stripeCustomerId',
  'emailVerifiedAt',
].join(' ');

// ── E-mail verification ───────────────────────────────────────────────────────
// Accounts created before this date predate verification at sign-up and count as
// verified, so no existing account is locked out. Must not be later than the deploy
// that turned verification on (accounts created before it would skip verification).
const EMAIL_PROOF_CUTOFF = new Date(process.env.EMAIL_PROOF_CUTOFF || '2026-10-26T00:00:00Z');

/**
 * True when nothing has proven that whoever created this account controls its e-mail
 * (no emailed code, password reset or provider-verified sign-in yet). Reads
 * emailVerifiedAt and createdAt, falling back to the ObjectId's creation time; an account
 * with neither counts as unverified.
 */
const emailUnverified = (user) => {
  if (!user || user.emailVerifiedAt) return false;
  const created = user.createdAt || user._id?.getTimestamp?.();
  return !created || new Date(created) >= EMAIL_PROOF_CUTOFF;
};

/**
 * BankID verification, reduced to what a badge needs.
 *
 * `identityVerification` holds the OIDC `sub`, Idura's `uniqueuserid`, the asserted
 * name, a birth year and the `acr`. None of that belongs in an API response: it is
 * identity data being sent so a page can draw a tick. The three derived fields below
 * are everything the UI actually renders, and they are safe to show to any viewer —
 * "this person verified with BankID" is the whole point of the badge.
 *
 * `identityVerified` is deliberately NOT `user.verified`. That older flag is set by
 * several unrelated paths (admin action, and the removed Idura controller which set it
 * on a bare e-mail match), so treating it as proof of BankID would put a BankID badge
 * on accounts that never completed BankID. It requires a real Idura identity: the
 * provider AND a subject, which only a validated id_token can produce.
 */
function identityVerificationSummary(user) {
  const iv = user?.identityVerification;
  const verified = iv?.provider === 'idura' && Boolean(iv?.subject);

  return {
    identityVerified: verified,
    identityVerificationProvider: verified ? iv.provider : null,
    identityVerifiedAt: verified ? iv.verifiedAt || null : null,
  };
}

/** Swap the raw subdocument for the summary. Mutates the plain object in place. */
function applyIdentitySummary(o) {
  const summary = identityVerificationSummary(o);
  delete o.identityVerification;
  return Object.assign(o, summary);
}

/**
 * Sanitize a user doc to PUBLIC SAFE projection (works for lean() + full docs).
 * Idempotent — safe to call multiple times. Does NOT mutate the original object.
 */
function sanitizeUserPublic(user) {
  if (!user) return user;
  const o = typeof user.toObject === 'function' ? user.toObject() : { ...user };
  for (const k of Object.keys(o)) {
    // Public fields, plus values computed per response (stats, distance) — nothing else, so a
    // query that selected more (e.g. email for sorting) still cannot leak it.
    if (!PUBLIC_FIELDS.includes(k) && !PUBLIC_COMPUTED.includes(k)) delete o[k];
  }
  return applyIdentitySummary(o);
}

/**
 * Sanitize a user doc for OWNER viewing (bank/private fields STILL excluded).
 */
function sanitizeUserOwner(user) {
  if (!user) return user;
  const o = typeof user.toObject === 'function' ? user.toObject() : { ...user };
  for (const f of SENSITIVE_STRIP) delete o[f];
  // Force remove bank/iban/vipps even if someone used +bankAccountNumber.
  delete o.bankAccountNumber;
  delete o.iban;
  delete o.bicSwift;
  delete o.vippsHandle;
  // E-mail proof for the profile's "E-post" row (legacy pre-cutoff accounts count as confirmed).
  // Separate from BankID (`verified` / identityVerification), which this never touches.
  o.emailVerified = !emailUnverified(user);
  return applyIdentitySummary(o);
}

module.exports = {
  identityVerificationSummary,
  PUBLIC_FIELDS,
  PUBLIC_USER_SELECT,
  OWN_USER_SELECT,
  SENSITIVE_STRIP,
  EMAIL_PROOF_CUTOFF,
  emailUnverified,
  sanitizeUserPublic,
  sanitizeUserOwner,
};
