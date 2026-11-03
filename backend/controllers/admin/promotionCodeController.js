const crypto = require('crypto');
const { getStripe, getStripeModeReport } = require('../../config/stripe');

/**
 * Membership discount codes: a Stripe coupon plus a customer-facing promotion code. Stripe is
 * the only store (the local Coupon model was removed with the old subscription code, ec0eac85);
 * the V2 subscription checkout lets customers type the code (allow_promotion_codes).
 */

function bad(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function input(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  const { type, duration } = body;
  const amount = Number(body.amount);
  const usageLimit = Number(body.usageLimit || 0);

  if (!name || !code) throw bad('Navn og kode er påkrevd.');
  if (name.length > 40) throw bad('Navnet kan ha maks 40 tegn.');
  if (!/^[A-Z0-9-]{3,30}$/.test(code)) throw bad('Koden kan bare ha A–Z, 0–9 og bindestrek (3–30 tegn).');
  if (!['percentage', 'fixed'].includes(type)) throw bad('Rabatt-typen er ugyldig.');
  if (!Number.isFinite(amount) || amount <= 0 || (type === 'percentage' && amount > 100)) {
    throw bad('Rabattbeløpet er ugyldig.');
  }
  if (!['once', 'forever', 'repeating'].includes(duration)) throw bad('Varigheten er ugyldig.');
  if (!Number.isInteger(usageLimit) || usageLimit < 0) throw bad('Bruksgrensen er ugyldig.');

  const durationInMonths = body.durationInMonths ? Number(body.durationInMonths) : null;
  if (duration === 'repeating' && !(Number.isInteger(durationInMonths) && durationInMonths > 0)) {
    throw bad('Antall måneder må være et positivt heltall.');
  }

  let expiresAt = null;
  if (body.expiresDate) {
    const date = new Date(body.expiresDate);
    if (Number.isNaN(date.getTime())) throw bad('Utløpsdatoen er ugyldig.');
    if (date.getTime() <= Date.now()) throw bad('Utløpsdatoen må være i fremtiden.');
    expiresAt = Math.floor(date.getTime() / 1000);
  }
  if (body.activeDate && new Date(body.activeDate).getTime() > Date.now()) {
    throw bad('Stripe-koder kan ikke ha fremtidig aktivering.');
  }
  return { name, code, type, amount, duration, durationInMonths, usageLimit, expiresAt };
}

/** Stripe and mode must agree before anything is written (never a live code by accident). */
async function stripeFor() {
  const report = await getStripeModeReport();
  if (report.mismatch || !['test', 'live'].includes(report.keyMode)) {
    throw bad('Stripe-modus er ikke konfigurert riktig.', 503);
  }
  return { stripe: await getStripe(), mode: report.keyMode };
}

/** The shape VoucherPage reads (the same fields the old local model had). */
function toRow(promotion, mode) {
  const coupon = promotion.promotion?.coupon || {};
  const fixed = coupon.amount_off != null;
  return {
    _id: promotion.id,
    name: coupon.name || promotion.code,
    code: promotion.code,
    type: fixed ? 'fixed' : 'percentage',
    amount: fixed ? coupon.amount_off / 100 : coupon.percent_off,
    usageLimit: promotion.max_redemptions || 0,
    targetPlanType: 'all',
    active: Boolean(promotion.active),
    activeDate: new Date(promotion.created * 1000).toISOString(),
    expiresDate: promotion.expires_at ? new Date(promotion.expires_at * 1000).toISOString() : null,
    usedBy: [],
    source: 'stripe',
    stripeMode: mode,
    duration: coupon.duration || null,
    durationInMonths: coupon.duration_in_months || null,
    redemptions: promotion.times_redeemed || 0,
    maxRedemptions: promotion.max_redemptions || 0,
  };
}

const fail = (res, error) =>
  res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : 'Stripe svarte ikke. Prøv igjen.',
  });

exports.listPromotionCodes = async (_req, res) => {
  try {
    const { stripe, mode } = await stripeFor();
    // ponytail: newest 100 codes, no paging; add `starting_after` paging if Jobblo ever has more.
    const list = await stripe.promotionCodes.list({
      limit: 100,
      expand: ['data.promotion.coupon'],
    });
    return res.json({ promotions: list.data.map((p) => toRow(p, mode)), mode, mismatch: false });
  } catch (error) {
    return fail(res, error);
  }
};

exports.createPromotionCode = async (req, res) => {
  let couponId = null;
  let stripe = null;
  try {
    const values = input(req.body || {});
    if (req.body.targetPlanType && req.body.targetPlanType !== 'all') {
      throw bad('Stripe-rabattkoder gjelder foreløpig alle medlemsplaner.');
    }
    const ready = await stripeFor();
    stripe = ready.stripe;
    const taken = await stripe.promotionCodes.list({ code: values.code, active: true, limit: 1 });
    if (taken.data.length) throw bad('Kupongkoden finnes allerede.', 409);

    const key = `promotion_create_${crypto.randomUUID()}`;
    const coupon = await stripe.coupons.create(
      {
        name: values.name,
        ...(values.type === 'percentage'
          ? { percent_off: values.amount }
          : { amount_off: Math.round(values.amount * 100), currency: 'nok' }),
        duration: values.duration,
        ...(values.duration === 'repeating' ? { duration_in_months: values.durationInMonths } : {}),
        metadata: { createdBy: String(req.user._id) },
      },
      { idempotencyKey: `${key}_coupon` }
    );
    couponId = coupon.id;

    const promotion = await stripe.promotionCodes.create(
      {
        promotion: { type: 'coupon', coupon: couponId },
        code: values.code,
        active: req.body.active !== false,
        ...(values.usageLimit > 0 ? { max_redemptions: values.usageLimit } : {}),
        ...(values.expiresAt ? { expires_at: values.expiresAt } : {}),
        metadata: { createdBy: String(req.user._id) },
      },
      { idempotencyKey: `${key}_promotion` }
    );
    return res.status(201).json(toRow({ ...promotion, promotion: { coupon } }, ready.mode));
  } catch (error) {
    // A coupon without its code is unreachable clutter in Stripe: remove it.
    if (couponId && stripe) {
      await stripe.coupons.del(couponId).catch(() => {
        console.error('Promotion cleanup failed for Stripe coupon %s', couponId);
      });
    }
    return fail(res, error);
  }
};

exports.deactivatePromotionCode = async (req, res) => {
  try {
    if (!/^promo_[A-Za-z0-9]+$/.test(req.params.id)) throw bad('Ugyldig rabattkode.');
    const { stripe, mode } = await stripeFor();
    const promotion = await stripe.promotionCodes.update(req.params.id, {
      active: false,
      expand: ['promotion.coupon'],
    });
    return res.json({ promotion: toRow(promotion, mode) });
  } catch (error) {
    if (error.type === 'StripeInvalidRequestError' && error.statusCode === 404) {
      return res.status(404).json({ error: 'Stripe-rabattkode ble ikke funnet.' });
    }
    return fail(res, error);
  }
};
