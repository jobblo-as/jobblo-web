const stripe = {
  coupons: { create: jest.fn(), del: jest.fn() },
  promotionCodes: { create: jest.fn(), list: jest.fn(), update: jest.fn() },
};
const report = { keyMode: 'test', mismatch: false };
jest.mock('../config/stripe', () => ({
  getStripe: async () => stripe,
  getStripeModeReport: async () => report,
}));
const c = require('../controllers/admin/promotionCodeController');

const res = () => {
  const r = {};
  r.status = jest.fn(() => r);
  r.json = jest.fn(() => r);
  return r;
};
const body = {
  name: 'Vinter',
  code: 'vinter-20',
  type: 'percentage',
  amount: 20,
  duration: 'once',
  usageLimit: 50,
};
const coupon = { id: 'co_1', name: 'Vinter', percent_off: 20, duration: 'once' };
const promo = { id: 'promo_1', code: 'VINTER-20', active: true, created: 1, max_redemptions: 50 };

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(report, { keyMode: 'test', mismatch: false });
  stripe.promotionCodes.list.mockResolvedValue({ data: [] });
  stripe.coupons.create.mockResolvedValue(coupon);
  stripe.promotionCodes.create.mockResolvedValue(promo);
});

test('creates a Stripe coupon + promotion code and returns the page row', async () => {
  const r = res();
  await c.createPromotionCode({ body, user: { _id: 'u1' } }, r);
  expect(stripe.coupons.create).toHaveBeenCalledWith(
    expect.objectContaining({ percent_off: 20, duration: 'once', name: 'Vinter' }),
    expect.any(Object)
  );
  expect(stripe.promotionCodes.create).toHaveBeenCalledWith(
    expect.objectContaining({
      promotion: { type: 'coupon', coupon: 'co_1' },
      code: 'VINTER-20',
      max_redemptions: 50,
    }),
    expect.any(Object)
  );
  expect(r.status).toHaveBeenCalledWith(201);
  expect(r.json.mock.calls[0][0]).toMatchObject({
    _id: 'promo_1',
    code: 'VINTER-20',
    amount: 20,
    type: 'percentage',
    stripeMode: 'test',
  });
});

test('refuses a taken code, bad input and a mismatched Stripe mode without writing', async () => {
  stripe.promotionCodes.list.mockResolvedValueOnce({ data: [promo] });
  let r = res();
  await c.createPromotionCode({ body, user: { _id: 'u1' } }, r);
  expect(r.status).toHaveBeenCalledWith(409);

  r = res();
  await c.createPromotionCode({ body: { ...body, amount: 150 }, user: { _id: 'u1' } }, r);
  expect(r.status).toHaveBeenCalledWith(400);

  report.mismatch = true;
  r = res();
  await c.createPromotionCode({ body, user: { _id: 'u1' } }, r);
  expect(r.status).toHaveBeenCalledWith(503);
  expect(stripe.coupons.create).not.toHaveBeenCalled();
});

test('removes the coupon again when the promotion code fails', async () => {
  stripe.promotionCodes.create.mockRejectedValueOnce(new Error('boom'));
  stripe.coupons.del.mockResolvedValue({});
  const r = res();
  await c.createPromotionCode({ body, user: { _id: 'u1' } }, r);
  expect(stripe.coupons.del).toHaveBeenCalledWith('co_1');
  expect(r.status).toHaveBeenCalledWith(500);
});

test('lists and deactivates by Stripe id; rejects other ids', async () => {
  stripe.promotionCodes.list.mockResolvedValueOnce({
    data: [{ ...promo, times_redeemed: 3, promotion: { coupon } }],
  });
  let r = res();
  await c.listPromotionCodes({}, r);
  expect(r.json.mock.calls[0][0].promotions[0]).toMatchObject({ redemptions: 3, name: 'Vinter' });

  stripe.promotionCodes.update.mockResolvedValue({ ...promo, active: false, promotion: { coupon } });
  r = res();
  await c.deactivatePromotionCode({ params: { id: 'promo_1' } }, r);
  expect(stripe.promotionCodes.update).toHaveBeenCalledWith('promo_1', expect.objectContaining({ active: false }));
  expect(r.json.mock.calls[0][0].promotion.active).toBe(false);

  r = res();
  await c.deactivatePromotionCode({ params: { id: '../x' } }, r);
  expect(r.status).toHaveBeenCalledWith(400);
});
