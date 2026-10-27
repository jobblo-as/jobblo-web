jest.mock('../models/Order', () => ({ findById: jest.fn() }));
jest.mock('../config/stripe', () => ({
  getStripeConfiguration: jest.fn(async () => ({ testMode: true })),
  getStripeForMode: jest.fn(async () => ({})),
}));
jest.mock('../services/stripe/webhookReadiness', () => ({
  getStripeWebhookReadiness: jest.fn(async () => ({ ready: true })),
}));

const Order = require('../models/Order');
const { createSafePaySession } = require('../controllers/SafePayCheckoutController');

const ORDER_ID = '507f1f77bcf86cd799439011';

function res() {
  const r = {};
  r.status = jest.fn(() => r);
  r.json = jest.fn(() => r);
  return r;
}

// A stranger must get 403 before any 409 that reveals the order's state.
it.each([
  ['missing service', { serviceId: null, agreedPrice: 100 }],
  ['missing agreed price', { serviceId: { _id: 's', title: 't' }, agreedPrice: 0 }],
])('a non-customer gets 403 even when the order has a %s', async (_name, order) => {
  Order.findById.mockReturnValue({
    populate: async () => ({ _id: ORDER_ID, customerId: 'owner', ...order }),
  });
  const r = res();
  await createSafePaySession({ userId: 'stranger', body: { orderId: ORDER_ID } }, r);
  expect(r.status).toHaveBeenCalledWith(403);
});
