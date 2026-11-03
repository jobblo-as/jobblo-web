// Admin "Fakturering" summary from the V2 subscription records (it was a 503 stub after ec0eac85).
const failing = [
  {
    userId: 'u2',
    stripeMode: 'test',
    stripeSubscriptionId: 'sub_2',
    recoveryInvoiceId: 'in_2',
    firstPaymentFailureAt: new Date('2026-10-01'),
    planId: { name: 'Pro', price: 199 },
  },
];
const query = {
  select: () => query,
  sort: () => query,
  limit: () => query,
  populate: () => query,
  lean: async () => failing,
};
const SubscriptionV2 = {
  countDocuments: jest.fn(async () => 3),
  aggregate: jest.fn(async () => [{ _id: 'active', count: 2 }]),
  find: jest.fn(() => query),
};
jest.mock('../models/SubscriptionV2', () => SubscriptionV2);
jest.mock('../models/SubscriptionPlan', () => ({}));
jest.mock('../services/stripe/webhookReadiness', () => ({
  getStripeWebhookReadiness: async () => ({ ready: true, status: 'verified', mode: 'test' }),
}));
const { getAdminSummary } = require('../controllers/admin/subscriptionBillingController');

const call = async (mode) => {
  const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
  await getAdminSummary({ query: mode ? { mode } : {} }, res);
  return res;
};

test('returns counts, statuses and failed renewals in the shape the admin page reads', async () => {
  const body = (await call()).json.mock.calls[0][0];
  expect(SubscriptionV2.countDocuments).toHaveBeenCalledWith({});
  expect(body).toMatchObject({
    mode: 'all',
    subscribers: 3,
    statuses: [{ _id: 'active', count: 2 }],
  });
  expect(body.failedInvoices).toEqual([
    {
      stripeSessionId: 'in_2',
      userId: 'u2',
      planName: 'Pro',
      amount: 199,
      currency: 'nok',
      livemode: false,
      createdAt: new Date('2026-10-01'),
    },
  ]);
  expect(body.webhookReadiness.ready).toBe(true);
});

test('filters by Stripe mode and refuses an unknown one', async () => {
  await call('live');
  expect(SubscriptionV2.countDocuments).toHaveBeenLastCalledWith({ stripeMode: 'live' });
  expect(SubscriptionV2.find).toHaveBeenLastCalledWith({
    stripeMode: 'live',
    firstPaymentFailureAt: { $ne: null },
  });
  expect((await call('prod')).status).toHaveBeenCalledWith(400);
});
