const mongoose = require('mongoose');

/**
 * "Hast" (39 kr) for one job (services/urgentPurchase.js). Bought on the web's "Nesten ferdig"
 * step BEFORE the job exists (no serviceId until it is published), or by the app for a job it
 * just published (serviceId from the start).
 *
 * pending  -> Checkout created, not paid yet (expires with the session)
 * paid     -> Stripe confirmed the payment; a job bought for is marked urgent
 * consumed  -> a prepaid purchase was used when its job was published (serviceId set then)
 * refunding -> paid but never used: the refund is being made (publishing cannot claim it)
 * refunded  -> that refund went through (HAST_DURATION_MINUTES after payment)
 * expired   -> the Checkout session expired or failed unpaid
 */
const urgentPurchaseSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', default: null },
    stripeMode: { type: String, enum: ['test', 'live'], required: true },
    amountMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, default: 'nok' },
    status: {
      type: String,
      enum: ['pending', 'paid', 'consumed', 'refunding', 'refunded', 'expired'],
      default: 'pending',
      required: true,
    },
    checkoutSessionId: { type: String },
    paymentIntentId: { type: String },
    expiresAt: { type: Date, required: true },
    paidAt: Date,
    consumedAt: Date,
    refundedAt: Date,
    refundId: String,
  },
  { timestamps: true, collection: 'urgent_purchases' }
);

urgentPurchaseSchema.index({ serviceId: 1, status: 1 });
urgentPurchaseSchema.index({ checkoutSessionId: 1 }, { unique: true, sparse: true });
// One open Checkout per user: two tabs cannot both start a charge.
urgentPurchaseSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' }, name: 'one_pending_per_user' }
);

module.exports = mongoose.model('UrgentPurchase', urgentPurchaseSchema);
