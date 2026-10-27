/**
 * SafePay scheduler: failed-payout retry. It used to relabel every retry as
 * `admin_override` (losing the dispute link and who released it) and re-read the same
 * first 25 failed payouts forever, starving everything behind them.
 */
jest.mock('../config/stripe', () => ({ getStripeConfiguration: jest.fn(), getStripeForMode: jest.fn() }));
jest.mock('../services/stripe/financialHistory', () => ({ reconcileConnectedAccountsBatch: jest.fn() }));
jest.mock('../utils/errorLogger', () => ({ logApplicationError: jest.fn() }));
jest.mock('../services/notifications', () => ({ notify: jest.fn() }));
jest.mock('../models/Notification', () => ({}));
jest.mock('../services/payout/releasePayoutToProvider', () => jest.fn());
jest.mock('../models/Order', () => ({ find: jest.fn(), findOneAndUpdate: jest.fn(), updateMany: jest.fn() }));
jest.mock('../models/Payment', () => ({ findOne: jest.fn(), updateOne: jest.fn() }));
jest.mock('../models/Payout', () => ({ find: jest.fn(), updateOne: jest.fn() }));
jest.mock('../models/Dispute', () => ({ findOne: jest.fn() }));

const Payment = require('../models/Payment');
const Payout = require('../models/Payout');
const Order = require('../models/Order');
const Dispute = require('../models/Dispute');
const { notify } = require('../services/notifications');
const releasePayoutToProvider = require('../services/payout/releasePayoutToProvider');
const { retryFailedPayouts, autoReleaseStaleReviews } = require('../services/scheduler/jobs');

const chain = (rows) => ({ select() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => rows });
let query;

beforeEach(() => {
  jest.clearAllMocks();
  Payment.findOne.mockResolvedValue({ stripePaymentIntentId: 'pi', stripeSessionId: 'cs' });
  releasePayoutToProvider.mockResolvedValue({});
  Payout.find.mockImplementation(function () {
    query = { sort: null, filter: arguments[0] };
    const c = chain([
      { _id: 'po1', orderId: 'o1', providerId: 'p', customerId: 'c', serviceId: 's', grossAmount: 500, platformFee: 0, releaseSource: 'dispute_release', releasedBy: 'admin', disputeId: 'd1' },
      { _id: 'po2', orderId: 'o2', providerId: 'p', customerId: 'c', serviceId: 's', grossAmount: 500, platformFee: 15, releaseSource: 'customer_approve', releasedBy: 'c' },
    ]);
    c.sort = (s) => { query.sort = s; return c; };
    return c;
  });
});

it('retries each payout under its original release source, least-recently-tried first', async () => {
  await retryFailedPayouts();
  expect(query.sort).toEqual({ lastAttemptedAt: 1, _id: 1 });
  expect(releasePayoutToProvider.mock.calls.map(([a]) => [a.orderId, a.releaseSource, a.releasedBy, a.disputeId])).toEqual([
    ['o1', 'dispute_release', 'admin', 'd1'],
    ['o2', 'customer_approve', 'c', undefined],
  ]);
});

it('a payout that still fails is rotated to the back of the queue', async () => {
  releasePayoutToProvider.mockRejectedValueOnce(Object.assign(new Error('order invalid'), { code: 'PAYOUT_ORDER_INVALID' }));
  await retryFailedPayouts();
  expect(Payout.updateOne).toHaveBeenCalledWith({ _id: 'po1', status: { $in: ['failed', 'reconciliation_required'] } }, { $set: { lastAttemptedAt: expect.any(Date) } });
});

describe('H6: paid orders are not left open', () => {
  it('also retries unknown-outcome payouts (reconciliation_required), which nothing retried', async () => {
    await retryFailedPayouts();
    expect(query.filter).toEqual({
      status: { $in: ['failed', 'reconciliation_required'] },
      $or: [{ releaseSource: { $ne: 'dispute_release' } }, { status: 'reconciliation_required' }],
    });
  });

  it('a retried payout completes its order if it is still waiting for review (auto-release)', async () => {
    Order.findOneAndUpdate.mockResolvedValueOnce(null).mockResolvedValueOnce({ _id: 'o2' });
    await retryFailedPayouts();
    expect(Order.findOneAndUpdate.mock.calls.map(([f, u]) => [f, u.$set])).toEqual([
      [{ _id: 'o1', status: 'ready_for_review' }, { status: 'completed' }],
      [{ _id: 'o2', status: 'ready_for_review' }, { status: 'completed' }],
    ]);
    expect(Payment.updateOne).toHaveBeenCalledTimes(1);
    expect(Payment.updateOne).toHaveBeenCalledWith({ orderId: 'o2' }, { $set: { status: 'released' } });
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('a failed payout does not complete the order', async () => {
    releasePayoutToProvider.mockRejectedValue(new Error('still failing'));
    await retryFailedPayouts();
    expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('auto-release finishes an order whose payout the retry job already paid (payment `released`)', async () => {
    Order.find.mockReturnValue(chain([{ _id: 'o9', customerId: 'c', providerId: 'p', serviceId: 's', agreedPrice: 1000 }]));
    Dispute.findOne.mockReturnValue({ select: async () => null });
    Payment.findOne.mockResolvedValue({ status: 'released', stripePaymentIntentId: 'pi', stripeSessionId: 'cs' });
    releasePayoutToProvider.mockResolvedValue({ alreadyPaid: true });
    Order.findOneAndUpdate.mockResolvedValue({ _id: 'o9' });
    await expect(autoReleaseStaleReviews()).resolves.toEqual({ scanned: 1, released: 1 });
    expect(Order.findOneAndUpdate).toHaveBeenCalledWith({ _id: 'o9', status: 'ready_for_review' }, expect.anything(), { new: true });
  });
});
