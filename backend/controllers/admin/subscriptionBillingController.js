const SubscriptionV2 = require('../../models/SubscriptionV2');
const SubscriptionPlan = require('../../models/SubscriptionPlan');
const { getStripeWebhookReadiness } = require('../../services/stripe/webhookReadiness');

/**
 * Admin "Fakturering" summary, read from the V2 subscription records (the old Subscription
 * model and its controller were removed in ec0eac85). Read-only. Failed payments are the
 * subscriptions whose renewal payment failed (V2 records the first failure on the row).
 */
exports.getAdminSummary = async (req, res) => {
  try {
    const mode = req.query.mode || 'all';
    if (!['all', 'test', 'live'].includes(mode)) {
      return res.status(400).json({ message: 'Ugyldig Stripe-modus.' });
    }
    const match = mode === 'all' ? {} : { stripeMode: mode };
    const [subscribers, statuses, failing, webhookReadiness] = await Promise.all([
      SubscriptionV2.countDocuments(match),
      SubscriptionV2.aggregate([
        { $match: match },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      SubscriptionV2.find({ ...match, firstPaymentFailureAt: { $ne: null } })
        .select(
          'userId planId stripeMode stripeSubscriptionId recoveryInvoiceId firstPaymentFailureAt'
        )
        .sort({ firstPaymentFailureAt: -1 })
        .limit(50)
        .populate({ path: 'planId', model: SubscriptionPlan, select: 'name price' })
        .lean(),
      getStripeWebhookReadiness(),
    ]);
    const failedInvoices = failing.map((s) => ({
      stripeSessionId: s.recoveryInvoiceId || s.stripeSubscriptionId,
      userId: String(s.userId),
      planName: s.planId?.name || '',
      amount: s.planId?.price || 0,
      currency: 'nok',
      livemode: s.stripeMode === 'live',
      createdAt: s.firstPaymentFailureAt,
    }));
    return res.json({ mode, subscribers, statuses, failedInvoices, webhookReadiness });
  } catch (error) {
    console.error('Admin subscription billing summary failed:', error.message);
    return res.status(503).json({ message: 'Kunne ikke hente abonnementsoversikten.' });
  }
};
