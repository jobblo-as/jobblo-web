const Order = require('../../models/Order');
const Payment = require('../../models/Payment');
const Payout = require('../../models/Payout');
const { getStripeConfiguration, getStripeForMode } = require('../../config/stripe');
const { reconcileConnectedAccountsBatch } = require('../stripe/financialHistory');
const Dispute = require('../../models/Dispute');
const SafePayHistory = require('../../models/SafePayHistory');
const Notification = require('../../models/Notification');
const { logApplicationError } = require('../../utils/errorLogger');
const { notify } = require('../../services/notifications');

/**
 * The lifecycle automation the product design already assumed existed.
 *
 * There was no scheduler in this codebase at all — no cron, no queue, not even a
 * setInterval. A comment in the old payout service referred to "the system-cron"
 * that would retry failed payouts; it was never built. The consequences were all
 * money-shaped: a customer who stopped responding left the provider's payment frozen
 * in `ready_for_review` forever, a failed transfer waited for someone to notice by
 * hand, and abandoned checkouts accumulated with no cleanup.
 *
 * Every job here must be safe to run twice. They are all either compare-and-swap
 * updates or calls into services that are already idempotent, so a double run cannot
 * double-pay, double-refund or double-complete.
 */

/** Business timings, configurable rather than scattered as literals. */
function config() {
  return {
    // How long a customer has to review before the money is released to the provider.
    autoReleaseDays: Number(process.env.SAFEPAY_AUTO_RELEASE_DAYS || 14),
    // A warning goes out this many days before the auto-release.
    warnBeforeDays: Number(process.env.SAFEPAY_AUTO_RELEASE_WARN_DAYS || 3),
    // Checkout sessions Stripe will never complete.
    abandonedOrderHours: Number(process.env.SAFEPAY_ABANDONED_ORDER_HOURS || 72),
  };
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

/**
 * Sweeps read least-recently-tried first and stamp what they read, so an order that is
 * skipped or throws every run moves to the back instead of filling the batch forever.
 */
async function stampAutoAttempt(orders) {
  if (orders.length === 0) return;
  await Order.updateMany(
    { _id: { $in: orders.map((o) => o._id) } },
    { $set: { lastAutoAttemptAt: new Date() } },
    { timestamps: false }
  );
}

/**
 * Moves a paid-out order from `ready_for_review` to `completed` and tells both sides.
 * Compare-and-swap, so it is a no-op for any order a customer or a dispute already moved.
 */
async function completeAutoReleasedOrder(order, autoReleaseDays = config().autoReleaseDays) {
  const moved = await Order.findOneAndUpdate(
    { _id: order._id, status: 'ready_for_review' },
    {
      $set: { status: 'completed' },
      $push: {
        history: {
          action: 'auto_released',
          userId: null,
          timestamp: new Date(),
          data: { reason: `Automatisk frigitt etter ${autoReleaseDays} dager uten svar` },
        },
      },
    },
    { new: true }
  );
  if (!moved) return false;
  await Payment.updateOne({ orderId: order._id }, { $set: { status: 'released' } });
  await notify({
    userId: order.customerId,
    type: 'payment',
    content: `Oppdraget ble automatisk godkjent etter ${autoReleaseDays} dager, og betalingen er utbetalt.`,
    orderId: order._id,
    event: 'order_completed',
    payload: { orderId: String(order._id), automatic: true },
  });
  await notify({
    userId: order.providerId,
    type: 'payment',
    content: 'Betalingen din er frigitt automatisk.',
    orderId: order._id,
    event: 'payout_sent',
    payload: { orderId: String(order._id), automatic: true },
  });
  return true;
}

/**
 * Orders the customer never got round to approving.
 *
 * Releases to the provider after the review window. This is the single most
 * important job here: without it a provider's only recourse against an unresponsive
 * customer is to open a dispute and wait for a human, which does not scale.
 *
 * Idempotent because releasePayoutToProvider is keyed on `payout_order_<orderId>`
 * and the status move is a compare-and-swap out of `ready_for_review`.
 */
async function autoReleaseStaleReviews() {
  const { autoReleaseDays } = config();
  const cutoff = daysAgo(autoReleaseDays);
  const releasePayoutToProvider = require('../payout/releasePayoutToProvider');

  const candidates = await Order.find({
    status: 'ready_for_review',
    readyForReviewAt: { $lte: cutoff },
  })
    .sort({ lastAutoAttemptAt: 1, _id: 1 })
    .select('_id customerId providerId serviceId agreedPrice chatId')
    .limit(50)
    .lean();
  await stampAutoAttempt(candidates);

  let released = 0;

  for (const order of candidates) {
    try {
      // Never move money on a disputed order. A dispute closed inside the window (a
      // no_action ruling returns the order with its OLD readyForReviewAt) restarts it.
      const dispute = await Dispute.findOne({
        orderId: order._id,
        $or: [
          { status: { $nin: ['resolved', 'closed', 'cancelled'] } },
          { closedAt: { $gt: cutoff } },
        ],
      }).select('_id');
      if (dispute) continue;

      // `released` too: retryFailedPayouts may already have paid a failed auto-release.
      // Skipping it left the order `ready_for_review` (and disputable) for good; the call
      // below then just returns the existing transfer.
      const payment = await Payment.findOne({ orderId: order._id });
      if (!payment || !['completed', 'released'].includes(payment.status)) continue;

      const gross = order.agreedPrice || 0;
      if (gross <= 0) continue;
      const fee = Math.round(gross * 0.03);

      await releasePayoutToProvider({
        orderId: order._id,
        providerId: order.providerId,
        customerId: order.customerId,
        serviceId: order.serviceId,
        grossAmount: gross,
        platformFee: fee,
        releaseSource: 'admin_override',
        releasedBy: null,
        stripePaymentIntentId: payment.stripePaymentIntentId,
        stripeCheckoutSessionId: payment.stripeSessionId,
      });

      // Only now is completion money-safe.
      if (await completeAutoReleasedOrder(order, autoReleaseDays)) released += 1;
    } catch (err) {
      await logApplicationError({
        error: err,
        requestPath: 'scheduler/autoReleaseStaleReviews',
        httpMethod: 'POST',
        httpStatus: 500,
        errorCode: 'AUTO_RELEASE_FAILED',
        source: 'scheduler',
        metadata: { orderId: String(order._id) },
      });
    }
  }

  return { scanned: candidates.length, released };
}

/** Tell the customer before the window closes, so auto-release is never a surprise. */
async function warnBeforeAutoRelease() {
  const { autoReleaseDays, warnBeforeDays } = config();
  const warnAfter = daysAgo(Math.max(autoReleaseDays - warnBeforeDays, 0));

  const candidates = await Order.find({
    status: 'ready_for_review',
    readyForReviewAt: { $lte: warnAfter },
    autoReleaseWarnedAt: null,
  })
    .select('_id customerId')
    .limit(100);

  let warned = 0;
  for (const order of candidates) {
    // CAS on the warn marker, so a second run cannot send a second warning.
    const claimed = await Order.findOneAndUpdate(
      { _id: order._id, autoReleaseWarnedAt: null },
      { $set: { autoReleaseWarnedAt: new Date() } }
    );
    if (!claimed) continue;

    await notify({
      userId: order.customerId,
      type: 'order',
      content: `Du har ${warnBeforeDays} dager på deg til å godkjenne oppdraget. Etter det frigis betalingen automatisk.`,
      orderId: order._id,
    });
    warned += 1;
  }

  return { warned };
}

/**
 * Transfers that failed, and transfers whose outcome is unknown. releasePayoutToProvider
 * refuses to create a second transfer for an order, and for an unknown outcome it only
 * looks the transfer up at Stripe (recording it if it happened), so retrying is safe.
 * `reconciliation_required` used to be skipped here, and nothing else ever retried it.
 */
async function retryFailedPayouts() {
  const releasePayoutToProvider = require('../payout/releasePayoutToProvider');

  // Least-recently-tried first: an unsorted .limit(25) re-read the same 25 permanently
  // failing payouts every run and starved everything behind them.
  // A failed DISPUTE payout is left to the admin's resolve: paying it here skipped the
  // dispute's refund leg and raced an admin changing the outcome (provider paid AND
  // customer refunded). Its unknown-outcome case still comes here, for the lookup only.
  const failed = await Payout.find({
    status: { $in: ['failed', 'reconciliation_required'] },
    $or: [{ releaseSource: { $ne: 'dispute_release' } }, { status: 'reconciliation_required' }],
  })
    .sort({ lastAttemptedAt: 1, _id: 1 })
    .select(
      'orderId providerId customerId serviceId grossAmount platformFee releaseSource releasedBy disputeId'
    )
    .limit(25)
    .lean();

  let retried = 0;
  for (const payout of failed) {
    try {
      const payment = await Payment.findOne({ orderId: payout.orderId });
      await releasePayoutToProvider({
        orderId: payout.orderId,
        providerId: payout.providerId,
        customerId: payout.customerId,
        serviceId: payout.serviceId,
        grossAmount: payout.grossAmount,
        platformFee: payout.platformFee,
        // Retry the payout as what it is; it used to be relabelled `admin_override`.
        releaseSource: ['customer_approve', 'dispute_release'].includes(payout.releaseSource)
          ? payout.releaseSource
          : 'admin_override',
        releasedBy: payout.releasedBy ?? null,
        disputeId: payout.disputeId,
        stripePaymentIntentId: payment?.stripePaymentIntentId,
        stripeCheckoutSessionId: payment?.stripeSessionId,
      });
      // Only auto-release pays out of `ready_for_review` (approval and disputes move the
      // order first), so finish that order now instead of leaving it open to a dispute.
      await completeAutoReleasedOrder({
        _id: payout.orderId,
        customerId: payout.customerId,
        providerId: payout.providerId,
      });
      retried += 1;
    } catch (err) {
      // Expected for a provider who still has not finished Connect onboarding —
      // logged, not escalated, so it does not drown the error log.
      console.error('retryFailedPayouts: order %s still failing: %s', payout.orderId, err.message);
      // Rotate it to the back of the queue (several failures throw before any write).
      await Payout.updateOne(
        { _id: payout._id, status: { $in: ['failed', 'reconciliation_required'] } },
        { $set: { lastAttemptedAt: new Date() } }
      );
    }
  }

  return { scanned: failed.length, retried };
}

/**
 * Checkout sessions that were started and never paid. Frees the listing so the owner
 * can award it again — before this, an abandoned contract blocked the job.
 */
async function cleanupAbandonedOrders() {
  const { releaseListingAfterCancel } = require('../order/releaseListing');
  const { abandonedOrderHours } = config();
  const cutoff = new Date(Date.now() - abandonedOrderHours * 60 * 60 * 1000);

  const abandoned = await Order.find({
    status: 'awaiting_payment',
    paymentStatus: { $ne: 'paid' },
    createdAt: { $lte: cutoff },
  })
    .sort({ lastAutoAttemptAt: 1, _id: 1 })
    .select(
      '_id serviceId providerId chatId checkoutSessionId checkoutSessionStatus checkoutAttemptId checkoutMode'
    )
    .limit(100)
    .lean();
  await stampAutoAttempt(abandoned);

  let cancelled = 0;
  let reopened = 0;

  for (const order of abandoned) {
    try {
      let terminalStripeSession = false;
      if (order.checkoutSessionId) {
        if (
          order.checkoutSessionId.startsWith('PENDING_') ||
          !['test', 'live'].includes(order.checkoutMode)
        ) {
          continue;
        }
        try {
          const stripe = await getStripeForMode(order.checkoutMode === 'test');
          const stripeSession = await stripe.checkout.sessions.retrieve(order.checkoutSessionId);
          if (
            stripeSession.id !== order.checkoutSessionId ||
            stripeSession.livemode !== (order.checkoutMode === 'live')
          ) {
            continue;
          }
          if (stripeSession.payment_status === 'paid') {
            const { confirmPaidSession } = require('../../controllers/SafePayCheckoutController');
            const confirmation = await confirmPaidSession(stripeSession);
            if (!confirmation.ok) {
              await logApplicationError({
                error: new Error('Paid abandoned checkout could not be reconciled'),
                requestPath: 'scheduler/cleanupAbandonedOrders',
                httpMethod: 'POST',
                httpStatus: 500,
                errorCode: 'ABANDONED_PAYMENT_RECONCILIATION_FAILED',
                source: 'scheduler',
                metadata: { orderId: String(order._id) },
              });
            }
            continue;
          }
          if (stripeSession.status !== 'expired' || stripeSession.payment_status !== 'unpaid') {
            continue;
          }
          terminalStripeSession = true;
        } catch (err) {
          await logApplicationError({
            error: err,
            requestPath: 'scheduler/cleanupAbandonedOrders',
            httpMethod: 'POST',
            httpStatus: 500,
            errorCode: 'ABANDONED_CHECKOUT_LOOKUP_FAILED',
            source: 'scheduler',
            metadata: { orderId: String(order._id) },
          });
          continue;
        }
      } else if (order.checkoutSessionStatus === 'pending' || order.checkoutAttemptId) {
        // A Stripe create call may have succeeded even if its response was lost.
        continue;
      }

      // A Stripe-backed attempt is cancellable only after Stripe confirms expiration.
      const moved = await Order.findOneAndUpdate(
        {
          _id: order._id,
          status: 'awaiting_payment',
          paymentStatus: { $ne: 'paid' },
          ...(order.checkoutSessionId
            ? {
                checkoutSessionId: order.checkoutSessionId,
                checkoutSessionStatus: order.checkoutSessionStatus,
                checkoutAttemptId: order.checkoutAttemptId,
              }
            : {
                checkoutSessionId: { $in: [null, ''] },
                checkoutSessionStatus: { $nin: ['pending', 'open'] },
                checkoutAttemptId: { $in: [null, ''] },
              }),
          ...(order.checkoutSessionId && terminalStripeSession
            ? { checkoutSessionStatus: { $in: ['open', 'expired', 'failed', 'complete'] } }
            : {}),
        },
        {
          $set: {
            status: 'cancelled',
            ...(order.checkoutSessionId ? { checkoutSessionStatus: 'expired' } : {}),
          },
          $push: {
            history: {
              action: 'auto_cancelled',
              userId: null,
              timestamp: new Date(),
              data: { reason: `Ikke betalt innen ${abandonedOrderHours} timer` },
            },
          },
        }
      );
      if (!moved) continue;
      cancelled += 1;

      // Put the listing back on the market and the auto-declined applicants back in it.
      if (await releaseListingAfterCancel(moved)) reopened += 1;
    } catch (err) {
      // One bad order must not abort the rest of the sweep.
      await logApplicationError({
        error: err,
        requestPath: 'scheduler/cleanupAbandonedOrders',
        httpMethod: 'POST',
        httpStatus: 500,
        errorCode: 'ABANDONED_ORDER_CLEANUP_FAILED',
        source: 'scheduler',
        metadata: { orderId: String(order._id) },
      });
    }
  }

  return { cancelled, reopened };
}

/**
 * The safety net: find orders that reached a terminal state while still holding
 * money, and disputes whose money movement never finished.
 *
 * Reports rather than repairs — an automated fix here could compound a mistake.
 * Everything it finds goes to the admin error log.
 */
async function reconcileMoneyState() {
  // Newest first, inside a window: unsorted, the same 200 oldest orders were re-checked
  // every run and nothing newer was ever looked at.
  // ponytail: past 500 terminal paid orders per 30 days the oldest in the window go
  // unchecked; a cursor or a `reconciledAt` rotation is the upgrade.
  const terminalWithMoney = await Order.find({
    status: { $in: ['completed', 'cancelled'] },
    paymentStatus: 'paid',
    updatedAt: { $gte: daysAgo(30) },
  })
    .sort({ updatedAt: -1 })
    .select('_id status')
    .limit(500)
    .lean();

  const problems = [];

  for (const order of terminalWithMoney) {
    const [payment, payout] = await Promise.all([
      Payment.findOne({ orderId: order._id }).select('status').lean(),
      Payout.findOne({ orderId: order._id }).select('status').lean(),
    ]);

    if (!payment) continue;
    if (['refunded', 'released'].includes(payment.status)) continue;
    if (payout && ['released_internal', 'processing', 'transferred'].includes(payout.status)) {
      continue;
    }

    problems.push({
      orderId: String(order._id),
      orderStatus: order.status,
      paymentStatus: payment.status,
    });
  }

  const stuckDisputes = await Dispute.find({
    'resolution.moneyState': { $in: ['pending', 'failed'] },
  })
    .select('_id orderId resolution.outcome resolution.moneyState')
    .limit(50)
    .lean();

  if (problems.length > 0 || stuckDisputes.length > 0) {
    await logApplicationError({
      error: new Error(
        `Reconciliation found ${problems.length} terminal order(s) with unsettled money and ${stuckDisputes.length} dispute(s) with unfinished money movement`
      ),
      requestPath: 'scheduler/reconcileMoneyState',
      httpMethod: 'POST',
      httpStatus: 500,
      errorCode: 'MONEY_RECONCILIATION_MISMATCH',
      source: 'scheduler',
      metadata: {
        orders: problems.slice(0, 25),
        disputes: stuckDisputes.slice(0, 25).map((d) => ({
          disputeId: String(d._id),
          orderId: String(d.orderId),
          outcome: d.resolution?.outcome,
          moneyState: d.resolution?.moneyState,
        })),
      },
    });
  }

  return { unsettledOrders: problems.length, stuckDisputes: stuckDisputes.length };
}

async function reconcileStripeFinancialHistory() {
  const config = await getStripeConfiguration();
  const stripe = await getStripeForMode(config.testMode);
  return reconcileConnectedAccountsBatch(stripe, !config.testMode, { limit: 10 });
}

async function cancelExpiredUnconnectedSafePayOrders() {
  const { cancelUnconnectedPaidOrders } = require('../safepay/providerConnectTimeout');
  return cancelUnconnectedPaidOrders();
}

async function cancelExpiredSubscriptionRecoveries() {
  const recovery = require('../subscriptions/v2RecoveryPolicy');
  return recovery.cancelExpiredRecoveries();
}

async function dispatchSubscriptionRecoveryEmails() {
  const recovery = require('../subscriptions/v2RecoveryPolicy');
  return recovery.dispatchRecoveryEmails();
}

/**
 * Hast runs out: clear «Haster» on jobs whose paid mark (urgentUntil) has passed.
 * ponytail: hourly (every minute for a short HAST_DURATION_MINUTES), so a mark can outlive
 * its time by up to one interval; marks set before
 * expiry existed have no urgentUntil and are left alone.
 */
async function expireUrgentMarks(now = new Date()) {
  const Service = require('../../models/Service');
  const res = await Service.updateMany(
    { urgent: true, urgentUntil: { $lte: now } },
    { $set: { urgent: false } }
  );
  return { expired: res.modifiedCount || 0 };
}

/** Prepaid Hast never used for a job: refund it (services/urgentPurchase). */
async function refundUnusedUrgent() {
  return require('../urgentPurchase').refundUnusedPurchases();
}

async function recordSafePayConnectReadiness() {
  const { recordReadyProvidersBeforeDeadline } = require('../safepay/providerConnectTimeout');
  return recordReadyProvidersBeforeDeadline();
}

module.exports = {
  autoReleaseStaleReviews,
  warnBeforeAutoRelease,
  retryFailedPayouts,
  cleanupAbandonedOrders,
  reconcileMoneyState,
  reconcileStripeFinancialHistory,
  cancelExpiredUnconnectedSafePayOrders,
  cancelExpiredSubscriptionRecoveries,
  dispatchSubscriptionRecoveryEmails,
  recordSafePayConnectReadiness,
  expireUrgentMarks,
  refundUnusedUrgent,
  config,
};
