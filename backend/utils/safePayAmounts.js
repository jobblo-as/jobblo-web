/**
 * SafePay money, in one place.
 *
 * The customer pays the job price, nothing more. Jobblo's 3 % fee comes out of the
 * provider's payout: on a 390 kr job the customer pays 390, the provider receives 378 and
 * Jobblo keeps 12. (It used to add the 3 % on top for the customer as well — 402 — while
 * still deducting it from the provider, so Jobblo took 6 %.)
 *
 * What a customer was actually charged is the order's `checkoutAmountMinor` snapshot,
 * written when the Checkout session is created; orders paid under the old rule keep their
 * snapshot, so their receipts, refunds and amount checks stay true.
 */
const SAFEPAY_FEE_RATE = 0.03;

const safePayFee = (price) => Math.round((Number(price) || 0) * SAFEPAY_FEE_RATE);

/** What the customer pays (or paid) for this order, in kroner. */
function customerTotal(order) {
  const snapshot = order?.checkoutAmountMinor;
  if (Number.isSafeInteger(snapshot) && snapshot > 0) return snapshot / 100;
  return Number(order?.agreedPrice) || 0;
}

/** The breakdown the SafePay screens show: price, fee, what the customer pays, the payout. */
function safePayCalculation(order) {
  const basePrice = Number(order?.agreedPrice) || 0;
  const fee = safePayFee(basePrice);
  return { basePrice, fee, total: customerTotal(order), providerNet: basePrice - fee };
}

module.exports = { SAFEPAY_FEE_RATE, safePayFee, customerTotal, safePayCalculation };
