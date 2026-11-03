// A promotion code lowers what the customer pays. Activation must accept "paid + Stripe's
// discount = plan price" (it sent a discounted first payment to reconciliation), and nothing else.
const { paidInFull } = require('../services/subscriptions/v2WebhookProcessor');

test('paid + discount must equal the plan price', () => {
  expect(paidInFull(19900, 0, 199)).toBe(true); // no code: the old exact check
  expect(paidInFull(19900, undefined, 199)).toBe(true);
  expect(paidInFull(15920, 3980, 199)).toBe(true); // 20% off
  expect(paidInFull(0, 19900, 199)).toBe(true); // 100% off
  expect(paidInFull(15920, 0, 199)).toBe(false); // underpaid without a discount
  expect(paidInFull(19900, 3980, 199)).toBe(false); // discount reported but full price taken
  expect(paidInFull(15920, -3980, 199)).toBe(false);
  expect(paidInFull(null, 0, 199)).toBe(false);
});
