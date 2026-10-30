/**
 * "Hast" (39 kr) for one job. Same shape as services/subscriptions/v2ExtraContacts.js: nothing
 * is urgent until Stripe confirms the payment (signed webhook or a server-side session read).
 *
 * Two ways in: the web pays on "Nesten ferdig" BEFORE publishing (no serviceId; Stripe returns
 * to the form, and publishing consumes the paid purchase), and the app pays for a job it has
 * just published (serviceId; the job turns urgent when the payment is confirmed).
 */
const mongoose = require('mongoose');
const UrgentPurchase = require('../models/UrgentPurchase');
const Service = require('../models/Service');
const User = require('../models/User');
const { getStripeConfiguration, getStripeForMode } = require('../config/stripe');
const { resolveStripeCustomer } = require('./stripe/customers');
const { logApplicationError } = require('../utils/errorLogger');

// ponytail: fixed price, mirrored in frontend components/CreateJobForm/PackageStep.tsx. Move to the
// admin plans page if it ever needs changing without a deploy.
const URGENT_PRICE_NOK = 39;
// How long Hast lasts: HAST_DURATION_MINUTES, else 3 days (live). A few minutes makes the expiry testable locally.
const DEFAULT_URGENT_MINUTES = 3 * 24 * 60;
const urgentDurationMs = () => {
  const minutes = Number(process.env.HAST_DURATION_MINUTES);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_URGENT_MINUTES) * 60 * 1000;
};
/** The urgent mark for a job, from now for the configured duration. */
const urgentMark = (now = new Date()) => ({
  urgent: true,
  urgentUntil: new Date(now.getTime() + urgentDurationMs()),
});
const CHECKOUT_MINUTES = 30; // Stripe's minimum Checkout lifetime
const OPEN_STATUSES = ['open', 'pending'];

class UrgentPurchaseError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code, message) => new UrgentPurchaseError(status, code, message);
/** Same page, query aside (Stripe may echo `{CHECKOUT_SESSION_ID}` back substituted or not). */
const samePage = (a, b) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return (
      x.origin === y.origin &&
      x.pathname === y.pathname &&
      x.searchParams.get('state') === y.searchParams.get('state')
    );
  } catch {
    return false;
  }
};
const idOf = (value) => (typeof value === 'string' ? value : value?.id);
const frontendUrl = () =>
  (process.env.FRONTEND_URL || 'http://localhost:5173').trim().replace(/\/+$/, '');

/** POST /api/stripe/create-urgent-payment { serviceId? } — the job's owner, or prepaid without one. */
async function createUrgentCheckout({ userId, serviceId, returnUrls }, overrides = {}) {
  const deps = {
    Model: UrgentPurchase,
    now: () => new Date(),
    getStripeConfiguration,
    getStripeForMode,
    resolveStripeCustomer,
    ...overrides,
  };
  const prepaid = serviceId === undefined || serviceId === null || serviceId === '';
  let service = null;
  if (!prepaid) {
    if (!mongoose.Types.ObjectId.isValid(String(serviceId)))
      throw fail(400, 'SERVICE_REQUIRED', 'A valid job is required.');
    service = await Service.findById(serviceId).select('userId status title urgent').lean();
    if (!service) throw fail(404, 'SERVICE_NOT_FOUND', 'Oppdraget finnes ikke.');
    if (String(service.userId) !== String(userId))
      throw fail(403, 'NOT_OWNER', 'Du kan bare kjøpe Hast for dine egne oppdrag.');
    if (!OPEN_STATUSES.includes(service.status))
      throw fail(400, 'SERVICE_CLOSED', 'Oppdraget er ikke åpent lenger.');
    if (service.urgent) throw fail(409, 'ALREADY_URGENT', 'Oppdraget er allerede merket Haster.');
  }

  // Paid already and not used yet (e.g. the app reloaded before publishing): no second charge.
  if (prepaid) {
    const unused = await deps.Model.findOne({ userId, status: 'paid', serviceId: null })
      .select('_id')
      .lean();
    if (unused)
      return { alreadyPaid: true, purchaseId: String(unused._id), priceNok: URGENT_PRICE_NOK };
  }

  // Prepaid: back to the same form ("Nesten ferdig"), which reloads its saved draft.
  // `returnUrls`: the app's bridge back into the app (SafePayCheckoutController).
  const successUrl = returnUrls
    ? returnUrls.success
    : prepaid
      ? `${frontendUrl()}/Publish-job?hast=paid&session_id={CHECKOUT_SESSION_ID}`
      : `${frontendUrl()}/jobs/${serviceId}?urgent=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = returnUrls
    ? returnUrls.cancel
    : prepaid
      ? `${frontendUrl()}/Publish-job?hast=cancelled`
      : `${frontendUrl()}/jobs/${serviceId}?urgent=cancelled`;

  const config = await deps.getStripeConfiguration();
  if (!config.keyModeValid)
    throw fail(503, 'STRIPE_UNAVAILABLE', 'Betaling er ikke tilgjengelig nå.');
  const stripe = await deps.getStripeForMode(config.testMode);
  const user = await User.findById(userId);
  const customerId = await deps.resolveStripeCustomer(stripe, user, config.testMode);

  const now = deps.now();
  // Free the user's single open-checkout slot from a session that has already expired.
  await deps.Model.updateMany(
    { userId, status: 'pending', expiresAt: { $lte: now } },
    { $set: { status: 'expired' } }
  );

  // The Checkout from a moment ago, closed without paying: open the same one again instead of
  // refusing for 30 minutes. Only for the same job and the same way back (web form vs app).
  const open = await deps.Model.findOne({ userId, status: 'pending' }).lean();
  if (open?.checkoutSessionId) {
    const previous = await stripe.checkout.sessions
      .retrieve(open.checkoutSessionId)
      .catch(() => null);
    const sameJob = String(open.serviceId || '') === (prepaid ? '' : String(serviceId));
    if (
      previous?.status === 'open' &&
      previous.url &&
      sameJob &&
      samePage(previous.success_url, successUrl)
    )
      return { url: previous.url, sessionId: previous.id, priceNok: URGENT_PRICE_NOK };
    if (previous?.status === 'complete') {
      // Paid while we were not looking: record it rather than charge again.
      await confirmUrgentSession(previous, deps.Model);
      return { alreadyPaid: true, purchaseId: String(open._id), priceNok: URGENT_PRICE_NOK };
    }
    // Another job or way back: close that Checkout so it can no longer be paid, then start anew.
    if (previous?.status === 'open')
      await stripe.checkout.sessions.expire(previous.id).catch(() => {});
    await deps.Model.updateOne(
      { _id: open._id, status: 'pending' },
      { $set: { status: 'expired' } }
    );
  }
  let purchase;
  try {
    purchase = await deps.Model.create({
      userId,
      serviceId: prepaid ? null : serviceId,
      stripeMode: config.mode,
      amountMinor: URGENT_PRICE_NOK * 100,
      expiresAt: new Date(now.getTime() + (CHECKOUT_MINUTES + 1) * 60 * 1000),
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    throw fail(
      409,
      'URGENT_CHECKOUT_OPEN',
      'Du har allerede en åpen betaling for Hast. Fullfør eller vent til den utløper.'
    );
  }

  const metadata = {
    type: 'urgent',
    purchaseId: String(purchase._id),
    userId: String(userId),
    serviceId: prepaid ? '' : String(serviceId),
    stripeMode: config.mode,
  };
  let session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer: customerId,
        client_reference_id: String(userId),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'nok',
              unit_amount: purchase.amountMinor,
              product_data: {
                name: 'Hast – oppdraget merkes «Haster»',
                description: String(service?.title || 'Nytt oppdrag på Jobblo').slice(0, 200),
              },
            },
          },
        ],
        metadata,
        payment_intent_data: { metadata },
        expires_at: Math.floor(now.getTime() / 1000) + CHECKOUT_MINUTES * 60,
        success_url: successUrl,
        cancel_url: cancelUrl,
      },
      { idempotencyKey: `jobblo-urgent:${purchase._id}` }
    );
  } catch (error) {
    await deps.Model.updateOne(
      { _id: purchase._id, status: 'pending' },
      { $set: { status: 'expired' } }
    );
    console.error('[urgent] checkout creation failed:', error.code || error.type || error.message);
    throw fail(503, 'STRIPE_UNAVAILABLE', 'Kunne ikke starte betalingen. Prøv igjen.');
  }
  await deps.Model.updateOne({ _id: purchase._id }, { $set: { checkoutSessionId: session.id } });
  return { url: session.url, sessionId: session.id, priceNok: URGENT_PRICE_NOK };
}

/**
 * Mark a purchase paid and its job urgent from a VERIFIED Stripe Checkout session (signed
 * webhook, or the status endpoint's own server-side retrieve). Idempotent.
 */
async function confirmUrgentSession(
  session,
  Model = UrgentPurchase,
  ServiceModel = Service,
  TransactionModel = require('../models/Transaction')
) {
  const metadata = session?.metadata || {};
  if (
    metadata.type !== 'urgent' ||
    !mongoose.Types.ObjectId.isValid(String(metadata.purchaseId || ''))
  ) {
    return { handled: 'urgent_invalid_metadata' };
  }
  const purchase = await Model.findById(metadata.purchaseId).lean();
  if (
    !purchase ||
    purchase.checkoutSessionId !== session.id ||
    String(purchase.userId) !== String(metadata.userId) ||
    String(purchase.serviceId ?? '') !== String(metadata.serviceId ?? '') ||
    session.mode !== 'payment' ||
    session.amount_total !== purchase.amountMinor ||
    String(session.currency || '').toLowerCase() !== purchase.currency ||
    session.livemode !== (purchase.stripeMode === 'live')
  ) {
    console.error('[urgent] session does not match its purchase; manual review', {
      sessionId: session?.id,
      purchaseId: metadata.purchaseId,
    });
    // The customer may have paid for nothing: raise an incident, not just a log line.
    await logApplicationError({
      error: new Error('Urgent Checkout session does not match its purchase'),
      requestPath: 'stripe/urgent',
      httpMethod: 'POST',
      httpStatus: 500,
      errorCode: 'URGENT_PAYMENT_MISMATCH',
      source: 'stripe',
      metadata: {
        sessionId: session?.id,
        purchaseId: String(metadata.purchaseId),
        paymentStatus: session?.payment_status,
      },
    });
    return { handled: 'urgent_mismatch' };
  }
  if (session.payment_status !== 'paid') return { handled: 'urgent_unpaid' };

  // The admin's Transactions page. Upsert by session first: a retried webhook (or a write that
  // failed and made Stripe retry) never makes a second row, and none is missed.
  await TransactionModel.updateOne(
    { stripeSessionId: session.id },
    {
      $setOnInsert: {
        userId: purchase.userId,
        serviceId: purchase.serviceId || null,
        planId: 'hast',
        planType: 'urgent',
        planName: 'Hast',
        amount: purchase.amountMinor / 100,
        currency: purchase.currency,
        livemode: session.livemode,
        status: 'succeeded',
        type: 'urgent',
      },
    },
    { upsert: true }
  );

  // `expired` too: a payment that completed right at the session's expiry was still taken.
  const updated = await Model.findOneAndUpdate(
    { _id: purchase._id, status: { $in: ['pending', 'expired'] } },
    {
      $set: {
        status: 'paid',
        paidAt: new Date(),
        paymentIntentId: idOf(session.payment_intent) || null,
      },
    },
    { new: true }
  );
  if (!updated) return { handled: 'urgent_already_paid' };
  // ponytail: no refund once the job is published (Hast delivered), also if it is deleted.
  if (purchase.serviceId)
    await ServiceModel.updateOne({ _id: purchase.serviceId }, { $set: urgentMark() });
  return { handled: 'urgent_paid' };
}

async function expireUrgentSession(session, Model = UrgentPurchase) {
  await Model.updateOne(
    { checkoutSessionId: session.id, status: 'pending' },
    { $set: { status: 'expired' } }
  );
  return { handled: 'urgent_expired' };
}

/** GET /api/stripe/urgent-status/:sessionId — owner only; re-checks Stripe while pending. */
async function getUrgentStatus({ userId, sessionId }, overrides = {}) {
  const deps = { Model: UrgentPurchase, getStripeForMode, ...overrides };
  if (typeof sessionId !== 'string' || !/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(sessionId)) {
    throw fail(404, 'URGENT_NOT_FOUND', 'Betalingen ble ikke funnet.');
  }
  let purchase = await deps.Model.findOne({ checkoutSessionId: sessionId, userId }).lean();
  if (!purchase) throw fail(404, 'URGENT_NOT_FOUND', 'Betalingen ble ikke funnet.');
  if (purchase.status === 'pending') {
    const stripe = await deps.getStripeForMode(purchase.stripeMode === 'test');
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status === 'expired') await expireUrgentSession(session, deps.Model);
    else await confirmUrgentSession(session, deps.Model);
    purchase = await deps.Model.findById(purchase._id).lean();
  }
  return {
    status: purchase.status,
    purchaseId: String(purchase._id),
    serviceId: purchase.serviceId ? String(purchase.serviceId) : null,
  };
}

// One setting for both: a published job keeps «Haster» this long, and a Hast paid but never
// used for a job (not published, or its draft deleted) is refunded after the same time.
const unusedRefundMs = urgentDurationMs;

/**
 * Refund every prepaid Hast nobody used (paid, no job) once unusedRefundMs has passed. A
 * purchase is claimed first (paid → refunding), so publishing can no longer use it and two
 * runs never refund it twice; Stripe's idempotency key covers a retry after a lost answer.
 * After a refund the user simply pays again for a new Hast.
 */
async function refundUnusedPurchases(
  { now = new Date() } = {},
  {
    Model = UrgentPurchase,
    TransactionModel = require('../models/Transaction'),
    stripeFor = getStripeForMode,
  } = {}
) {
  const due = await Model.find({
    status: 'paid',
    serviceId: null,
    paidAt: { $lte: new Date(now.getTime() - unusedRefundMs()) },
  })
    .select('_id')
    .limit(50)
    .lean();
  let refunded = 0;
  for (const { _id } of due) {
    const purchase = await Model.findOneAndUpdate(
      { _id, status: 'paid', serviceId: null },
      { $set: { status: 'refunding' } },
      { new: true }
    );
    if (!purchase) continue; // published or refunded meanwhile
    try {
      const stripe = await stripeFor(purchase.stripeMode === 'test');
      const refund = await stripe.refunds.create(
        {
          payment_intent: purchase.paymentIntentId,
          metadata: { type: 'urgent_unused', purchaseId: String(purchase._id) },
        },
        { idempotencyKey: `jobblo-urgent-refund:${purchase._id}` }
      );
      await Model.updateOne(
        { _id: purchase._id },
        { $set: { status: 'refunded', refundedAt: now, refundId: refund.id } }
      );
      await TransactionModel.updateOne(
        { stripeSessionId: purchase.checkoutSessionId },
        {
          $set: {
            status: 'refunded',
            refunded: true,
            refundedAt: now,
            refundReason: 'Oppdraget ble ikke publisert, så Hast ble ikke brukt.',
          },
        }
      );
      refunded += 1;
    } catch (err) {
      // Back to paid: the next run tries again with the same idempotency key.
      await Model.updateOne(
        { _id: purchase._id, status: 'refunding' },
        { $set: { status: 'paid' } }
      );
      console.error('[urgent] unused Hast refund failed:', err.code || err.type || err.message);
    }
  }
  return { refunded };
}

/**
 * Publishing with a prepaid Hast: claim the user's paid, unused purchase for the new job, once
 * (atomic). True when the job may be marked urgent.
 */
async function consumeUrgentPurchase(
  { userId, purchaseId, serviceId },
  Model = UrgentPurchase,
  TransactionModel = require('../models/Transaction')
) {
  if (!mongoose.Types.ObjectId.isValid(String(purchaseId || ''))) return false;
  const claimed = await Model.findOneAndUpdate(
    { _id: purchaseId, userId, status: 'paid', serviceId: null },
    { $set: { status: 'consumed', serviceId, consumedAt: new Date() } },
    { new: true }
  );
  if (!claimed) return false;
  // Its transaction now names the job it paid for.
  await TransactionModel.updateOne(
    { stripeSessionId: claimed.checkoutSessionId, serviceId: null },
    { $set: { serviceId } }
  ).catch((err) => console.error('[urgent] transaction job link failed:', err.message));
  return true;
}

module.exports = {
  URGENT_PRICE_NOK,
  urgentDurationMs,
  urgentMark,
  unusedRefundMs,
  refundUnusedPurchases,
  UrgentPurchaseError,
  createUrgentCheckout,
  confirmUrgentSession,
  expireUrgentSession,
  getUrgentStatus,
  consumeUrgentPurchase,
};
