/**
 * M10: switching STRIPE_TEST_MODE must not drop the other mode's webhook events.
 * Each event is verified against both signing secrets and handled in its own mode.
 */

jest.mock('../config/stripe', () => ({
  getStripeConfiguration: jest.fn(), // global toggle; the webhook must not depend on it
  getStripeConfigurationForMode: jest.fn(),
  getStripeForMode: jest.fn(),
}));
jest.mock('../services/stripe/webhookReadiness', () => ({
  recordVerifiedDelivery: jest.fn(),
  recordDeliveryProblem: jest.fn(),
}));
jest.mock('../services/stripe/eventLedger', () => ({
  claimEvent: jest.fn(),
  markProcessed: jest.fn(),
  releaseClaim: jest.fn(),
}));
jest.mock('../utils/errorLogger', () => ({ logApplicationError: jest.fn() }));
jest.mock('../services/stripe/paymentLifecycle', () => ({
  recordStripePaymentLifecycle: jest.fn(),
  recordRejectedSafePayPayment: jest.fn(),
}));

const Stripe = require('stripe');
const stripeConfig = require('../config/stripe');
const readiness = require('../services/stripe/webhookReadiness');
const ledger = require('../services/stripe/eventLedger');
const { recordStripePaymentLifecycle } = require('../services/stripe/paymentLifecycle');
const { logApplicationError } = require('../utils/errorLogger');
const { stripeWebhook } = require('../services/stripe/webhookDispatcher');

const signer = Stripe('sk_test_signer');
const CONFIG = {
  test: { testMode: true, mode: 'test', secretKey: 'sk_test_x', keyModeValid: true, webhookSecret: 'whsec_test_one', webhookSecretValid: true, fingerprint: 'fp_test' },
  live: { testMode: false, mode: 'live', secretKey: 'sk_live_x', keyModeValid: true, webhookSecret: 'whsec_live_two', webhookSecretValid: true, fingerprint: 'fp_live' },
};
let clients;

function deliver(livemode, secret) {
  const payload = JSON.stringify({
    id: `evt_${livemode ? 'live' : 'test'}_refund`,
    object: 'event',
    type: 'charge.refunded',
    livemode,
    data: { object: { id: 'ch_1' } },
  });
  const res = {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    send(b) { this.body = b; return this; },
    json(b) { this.body = b; return this; },
  };
  const req = {
    body: Buffer.from(payload),
    headers: { 'stripe-signature': signer.webhooks.generateTestHeaderString({ payload, secret }) },
    originalUrl: '/api/stripe/webhook',
    app: { get: () => null },
  };
  return stripeWebhook(req, res).then(() => res);
}

beforeEach(() => {
  jest.clearAllMocks();
  clients = { true: Stripe('sk_test_client'), false: Stripe('sk_live_client') };
  // Toggle switched to TEST while live events are still in flight.
  stripeConfig.getStripeConfiguration.mockResolvedValue(CONFIG.test);
  stripeConfig.getStripeConfigurationForMode.mockImplementation((t) => (t ? CONFIG.test : CONFIG.live));
  stripeConfig.getStripeForMode.mockImplementation(async (t) => clients[t]);
  ledger.claimEvent.mockResolvedValue({ claimed: true });
});

it('processes a live refund signed with the live secret while the toggle says test', async () => {
  const res = await deliver(true, CONFIG.live.webhookSecret);
  expect(res.statusCode).toBe(200);
  expect(recordStripePaymentLifecycle).toHaveBeenCalledWith(expect.objectContaining({ livemode: true }));
  expect(stripeConfig.getStripeForMode).toHaveBeenLastCalledWith(false);
  expect(readiness.recordVerifiedDelivery).toHaveBeenCalledWith(CONFIG.live, 'evt_live_refund');
});

it('still processes test events in test mode', async () => {
  const res = await deliver(false, CONFIG.test.webhookSecret);
  expect(res.statusCode).toBe(200);
  expect(stripeConfig.getStripeForMode).toHaveBeenLastCalledWith(true);
  expect(readiness.recordVerifiedDelivery).toHaveBeenCalledWith(CONFIG.test, 'evt_test_refund');
});

it('rejects an event signed by neither secret, without claiming it', async () => {
  const res = await deliver(true, 'whsec_attacker');
  expect(res.statusCode).toBe(400);
  expect(ledger.claimEvent).not.toHaveBeenCalled();
});

it('rejects a live event signed with the test secret (swapped secrets, not a mode switch)', async () => {
  const res = await deliver(true, CONFIG.test.webhookSecret);
  expect(res.statusCode).toBe(400);
  expect(logApplicationError).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'STRIPE_WEBHOOK_MODE_MISMATCH' }));
  expect(ledger.claimEvent).not.toHaveBeenCalled();
});

it('keeps a verified event retryable (503) when its mode has no usable API key', async () => {
  stripeConfig.getStripeForMode.mockRejectedValue(new Error('missing key'));
  const res = await deliver(true, CONFIG.live.webhookSecret);
  expect(res.statusCode).toBe(503);
  expect(ledger.claimEvent).not.toHaveBeenCalled();
});
