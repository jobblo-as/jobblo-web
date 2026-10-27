/**
 * Every dispute outcome must settle the money it claims to settle.
 *
 * Before this: `partial_refund` and `split_payment` recorded a providerAmount that no
 * code ever transferred, `cancel_without_payment` refunded nobody while cancelling
 * the order, and `no_action` — documented as no action — cancelled it too. The refund
 * also ran inside a MongoDB transaction, so an abort after a successful refund left
 * the customer refunded and the database certain it never happened.
 */

const captured = { success: null, error: null };

jest.mock('../utils/apiResponse', () => ({
  asyncHandler: (fn) => fn,
  sendSuccess: jest.fn((res, data, message) => {
    captured.success = { data, message };
    return res;
  }),
  sendError: jest.fn((res, message, status) => {
    captured.error = { message, status };
    return res;
  }),
  buildPagination: jest.fn(),
}));
jest.mock('../utils/pagination', () => ({
  parsePagination: jest.fn(),
  parseObjectId: jest.fn((v) => v),
  parseSort: jest.fn(),
  parseDate: jest.fn(),
}));
jest.mock('../models/Dispute', () => ({ findById: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../models/Order', () => ({}));
jest.mock('../models/Payment', () => ({ findOne: jest.fn() }));
jest.mock('../models/Payout', () => ({ findOne: jest.fn(), updateOne: jest.fn().mockResolvedValue({}), exists: jest.fn(async () => null) }));
jest.mock('../models/StripeFinancialOperation', () => ({
  findOne: jest.fn(() => ({ select: () => ({ lean: async () => null }) })),
  exists: jest.fn(async () => null),
}));
jest.mock('../models/SafePayHistory', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../models/ChatMessage', () => ({ findByIdAndUpdate: jest.fn() }));
jest.mock('../models/Notification', () => ({ create: jest.fn() }));
jest.mock('../models/User', () => ({ findByIdAndUpdate: jest.fn() }));
jest.mock('../services/admin/activityService', () => ({ logActivity: jest.fn() }));
jest.mock('../utils/errorLogger', () => ({ logApplicationError: jest.fn() }));
jest.mock('../config/stripe', () => ({
  getStripe: jest.fn(),
  getStripeForMode: jest.fn(),
}));
jest.mock('../services/payout/releasePayoutToProvider', () => jest.fn());
jest.mock('../services/stripe/financialOperations', () => ({
  executeRefund: jest.fn(async (stripe, operation) => ({
    operation: { _id: 'financial_operation_1' },
    refund: await stripe.refunds.create(
      {
        payment_intent: operation.paymentIntentId,
        amount: operation.amount,
        metadata: { jobbloOperationKey: operation.operationKey },
      },
      { idempotencyKey: 'jobblo_financial_test' }
    ),
    status: 'succeeded',
  })),
  executeTransferReversal: jest.fn(),
}));

const Dispute = require('../models/Dispute');
const Payment = require('../models/Payment');
const Payout = require('../models/Payout');
const SafePayHistory = require('../models/SafePayHistory');
const Notification = require('../models/Notification');
const { getStripe, getStripeForMode } = require('../config/stripe');
const releasePayoutToProvider = require('../services/payout/releasePayoutToProvider');
const { logApplicationError } = require('../utils/errorLogger');
const { executeRefund } = require('../services/stripe/financialOperations');
const { resolveDispute } = require('../controllers/admin/disputesAdminController');

const ORDER = () => ({
  _id: 'order_1',
  customerId: 'cust_1',
  providerId: 'prov_1',
  serviceId: 'svc_1',
  agreedPrice: 1000,
  chatId: null,
  status: 'disputed',
  checkoutMode: 'test',
  checkoutSessionId: 'cs_1',
  paymentIntentId: 'pi_1',
  checkoutCustomerId: 'cus_1',
  checkoutAmountMinor: 100000,
  checkoutCurrency: 'nok',
  checkoutAttemptId: 'attempt_1',
  history: [],
  save: jest.fn().mockResolvedValue(),
});

function disputeDoc(order, previousOrderStatus = 'ready_for_review') {
  return {
    _id: 'dispute_1',
    orderId: order,
    status: 'open',
    previousOrderStatus,
    timeline: [],
    resolution: undefined,
    save: jest.fn().mockResolvedValue(),
  };
}

let refundsCreate;

function run(outcome, body = {}) {
  const req = {
    params: { disputeId: 'dispute_1' },
    body: { outcome, reason: 'Behandlet av support', ...body },
    user: { _id: 'admin_1', name: 'Admin' },
    ip: '127.0.0.1',
    headers: {},
    originalUrl: '/api/admin/disputes/dispute_1/resolve',
  };
  return resolveDispute(req, {}, jest.fn());
}

beforeEach(() => {
  jest.clearAllMocks();
  captured.success = null;
  captured.error = null;

  refundsCreate = jest.fn().mockResolvedValue({ id: 're_1', status: 'succeeded' });
  const stripe = {
    checkout: {
      sessions: {
        retrieve: jest.fn().mockResolvedValue({
          id: 'cs_1',
          livemode: false,
          status: 'complete',
          payment_status: 'paid',
          mode: 'payment',
          payment_intent: 'pi_1',
          customer: 'cus_1',
          metadata: { orderId: 'order_1', userId: 'cust_1' },
          amount_total: 100000,
          currency: 'nok',
        }),
      },
    },
    paymentIntents: {
      retrieve: jest.fn().mockResolvedValue({
        id: 'pi_1',
        status: 'succeeded',
        amount_received: 100000,
        customer: 'cus_1',
        latest_charge: 'ch_1',
      }),
    },
    charges: {
      retrieve: jest.fn().mockResolvedValue({
        id: 'ch_1',
        paid: true,
        captured: true,
        amount: 100000,
        currency: 'nok',
        payment_intent: 'pi_1',
        customer: 'cus_1',
        disputed: false,
        livemode: false,
      }),
    },
    refunds: { create: refundsCreate },
  };
  getStripe.mockResolvedValue(stripe);
  getStripeForMode.mockResolvedValue(stripe);
  Payout.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

  Payment.findOne.mockResolvedValue({
    stripePaymentIntentId: 'pi_1',
    stripeSessionId: 'cs_1',
    status: 'disputed',
    save: jest.fn().mockResolvedValue(),
  });
  SafePayHistory.findOneAndUpdate.mockResolvedValue({});
  // The resolution intent is claimed atomically; these tests resolve a fresh dispute,
  // so the claim succeeds. Contention is covered in its own block below.
  Dispute.findOneAndUpdate.mockImplementation(async (_filter, update) => ({ resolution: update.$set.resolution }));
  Notification.create.mockResolvedValue({});
  releasePayoutToProvider.mockResolvedValue({
    payout: { stripeTransferId: 'tr_1' },
    alreadyPaid: false,
  });
});

describe('outcomes that pay the provider', () => {
  it('release_to_provider transfers and completes', async () => {
    const order = ORDER();
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(disputeDoc(order)) });

    await run('release_to_provider');

    expect(refundsCreate).not.toHaveBeenCalled();
    expect(releasePayoutToProvider).toHaveBeenCalledWith(
      expect.objectContaining({ grossAmount: 1000, platformFee: 30 })
    );
    expect(order.status).toBe('completed');
  });

  it('partial_refund now ALSO pays the provider its recorded share', async () => {
    const order = ORDER();
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(disputeDoc(order)) });

    await run('partial_refund', { customerAmount: 400, providerAmount: 600 });

    expect(refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 40000 }), // 400 kr in øre
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^jobblo_financial_/) })
    );
    // This transfer never happened before — the amount was recorded and dropped.
    expect(releasePayoutToProvider).toHaveBeenCalledWith(
      expect.objectContaining({ grossAmount: 600, platformFee: 0 })
    );
    expect(order.status).toBe('completed');
  });

  it('split_payment makes real Stripe calls instead of none at all', async () => {
    const order = ORDER();
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(disputeDoc(order)) });

    await run('split_payment', { customerAmount: 300, providerAmount: 700 });

    expect(refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 30000 }),
      expect.any(Object)
    );
    expect(releasePayoutToProvider).toHaveBeenCalledWith(
      expect.objectContaining({ grossAmount: 700 })
    );
  });
});

describe('outcomes that return money to the customer', () => {
  it('full_refund_to_customer refunds and cancels', async () => {
    const order = ORDER();
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(disputeDoc(order)) });

    await run('full_refund_to_customer');

    expect(refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 100000 }),
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^jobblo_financial_/) })
    );
    expect(releasePayoutToProvider).not.toHaveBeenCalled();
    expect(order.status).toBe('cancelled');
  });

  it('cancel_without_payment now refunds instead of keeping the money', async () => {
    const order = ORDER();
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(disputeDoc(order)) });

    await run('cancel_without_payment');

    // Previously: no Stripe call whatsoever, order cancelled, platform kept the funds.
    expect(refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 100000 }),
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^jobblo_financial_/) })
    );
    expect(order.status).toBe('cancelled');
  });
});

describe('no_action', () => {
  it('takes no action: no money moves and the order returns to where it was', async () => {
    const order = ORDER();
    Dispute.findById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(disputeDoc(order, 'ready_for_review')),
    });

    await run('no_action');

    expect(refundsCreate).not.toHaveBeenCalled();
    expect(releasePayoutToProvider).not.toHaveBeenCalled();
    // Was 'cancelled' — the exact opposite of what the outcome promises.
    expect(order.status).toBe('ready_for_review');
  });

  it('restores in_progress when that is where the dispute found the order', async () => {
    const order = ORDER();
    Dispute.findById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(disputeDoc(order, 'in_progress')),
    });

    await run('no_action');

    expect(order.status).toBe('in_progress');
  });
});

describe('failure handling and retryability', () => {
  it('leaves the dispute unresolved and retryable when the refund fails', async () => {
    const order = ORDER();
    const dispute = disputeDoc(order);
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(dispute) });
    refundsCreate.mockRejectedValue(new Error('card_declined'));

    await run('full_refund_to_customer');

    expect(dispute.resolution.moneyState).toBe('failed');
    expect(dispute.status).not.toBe('resolved');
    expect(captured.error.status).toBe(502);
    expect(logApplicationError).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'DISPUTE_RESOLUTION_MONEY_FAILED' })
    );
    // The order must NOT be moved when the money did not move.
    expect(order.status).toBe('disputed');
  });

  it('leaves the dispute retryable when the payout fails', async () => {
    const order = ORDER();
    const dispute = disputeDoc(order);
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(dispute) });
    releasePayoutToProvider.mockRejectedValue(new Error('PAYOUT_SETUP_REQUIRED'));

    await run('release_to_provider');

    expect(dispute.resolution.moneyState).toBe('failed');
    expect(captured.error.status).toBe(502);
    expect(order.status).toBe('disputed');
  });

  it('records the intent BEFORE calling Stripe, so a crash is discoverable', async () => {
    const order = ORDER();
    const dispute = disputeDoc(order);
    let moneyStateAtRefundTime = null;
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(dispute) });
    refundsCreate.mockImplementation(async () => {
      moneyStateAtRefundTime = dispute.resolution.moneyState;
      return { id: 're_1', status: 'succeeded' };
    });

    await run('full_refund_to_customer');

    expect(moneyStateAtRefundTime).toBe('pending');
    expect(dispute.resolution.moneyState).toBe('settled');
  });

  it('marks money settled and the dispute resolved on success', async () => {
    const order = ORDER();
    const dispute = disputeDoc(order);
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(dispute) });

    await run('release_to_provider');

    expect(dispute.status).toBe('resolved');
    expect(dispute.payoutFrozen).toBe(false);
    expect(dispute.resolution.moneyState).toBe('settled');
    expect(dispute.resolution.stripeTransferId).toBe('tr_1');
    expect(captured.success).not.toBeNull();
  });

  it('allows re-resolving a dispute whose money movement previously failed', async () => {
    const order = ORDER();
    const dispute = disputeDoc(order);
    dispute.resolution = { outcome: 'full_refund_to_customer', moneyState: 'failed' };
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(dispute) });

    await run('full_refund_to_customer');

    expect(captured.error).toBeNull();
    expect(dispute.resolution.moneyState).toBe('settled');
  });

  it('refuses to resolve one that already settled', async () => {
    const order = ORDER();
    const dispute = disputeDoc(order);
    dispute.resolution = { outcome: 'release_to_provider', moneyState: 'settled' };
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(dispute) });

    await run('release_to_provider');

    expect(captured.error.status).toBe(409);
    expect(releasePayoutToProvider).not.toHaveBeenCalled();
  });
});

describe('the recorded resolution and concurrent admins', () => {
  it('release_to_provider records the full secured amount the payout service will check, even if the form sent 0', async () => {
    const order = ORDER();
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(disputeDoc(order)) });

    await run('release_to_provider', { providerAmount: 0, customerAmount: 0 });

    const [, update] = Dispute.findOneAndUpdate.mock.calls[0];
    expect(update.$set.resolution).toMatchObject({ outcome: 'release_to_provider', providerAmount: 1000, customerAmount: 0 });
    expect(releasePayoutToProvider).toHaveBeenCalledWith(expect.objectContaining({ grossAmount: 1000 }));
  });

  it('a second admin who loses the atomic claim gets 409 and moves no money', async () => {
    const order = ORDER();
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(disputeDoc(order)) });
    Dispute.findOneAndUpdate.mockResolvedValueOnce(null); // the other admin claimed it first

    await run('full_refund_to_customer');

    expect(captured.error.status).toBe(409);
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(releasePayoutToProvider).not.toHaveBeenCalled();
    expect(order.save).not.toHaveBeenCalled();
  });

  it('the claim only re-enters a pending resolution for the same outcome and amounts after it went idle', async () => {
    const order = ORDER();
    const doc = disputeDoc(order);
    doc.resolution = { outcome: 'partial_refund', customerAmount: 300, providerAmount: 600, moneyState: 'pending' };
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(doc) });

    await run('partial_refund', { customerAmount: 300, providerAmount: 600 });

    const [filter] = Dispute.findOneAndUpdate.mock.calls[0];
    const pendingBranch = filter.$or.find((b) => b['resolution.moneyState'] === 'pending');
    expect(pendingBranch).toMatchObject({
      'resolution.outcome': 'partial_refund',
      'resolution.customerAmount': 300,
      'resolution.providerAmount': 600,
    });
    const idleFor = Date.now() - pendingBranch['resolution.resolvedAt'].$lte.getTime();
    expect(idleFor).toBeGreaterThanOrEqual(10 * 60 * 1000 - 1000);
    expect(filter.status.$in).toContain('open');
  });
});

describe('H7: every dispute path ends with money and order consistent', () => {
  const Order = require('../models/Order');
  const { executeTransferReversal } = require('../services/stripe/financialOperations');
  const { updateDisputeStatus, reopenDispute } = require('../controllers/admin/disputesAdminController');
  const withFee = async () => {
    const stripe = await getStripeForMode();
    for (const fn of [stripe.checkout.sessions.retrieve, stripe.paymentIntents.retrieve, stripe.charges.retrieve]) {
      const base = await fn();
      fn.mockResolvedValue({ ...base, amount_total: 103000, amount_received: 103000, amount: 103000 });
    }
    return stripe;
  };
  const transferred = () => Payout.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ status: 'transferred', stripeTransferId: 'tr_9', stripeConnectAccountId: 'acct_p', netProviderAmount: 970 }) });

  it('a full refund returns what the customer paid, the 3 % fee included', async () => {
    await withFee();
    const order = { ...ORDER(), checkoutAmountMinor: 103000 };
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(disputeDoc(order)) });
    await run('full_refund_to_customer');
    expect(refundsCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 103000 }), expect.any(Object));
    expect(order.status).toBe('cancelled');
  });

  it('on a paid-out order the transfer is reversed BEFORE the customer is refunded', async () => {
    const stripe = await withFee();
    stripe.transfers = { retrieve: jest.fn().mockResolvedValue({ id: 'tr_9', livemode: false, destination: 'acct_p', source_transaction: 'ch_1', amount: 97000, amount_reversed: 0, currency: 'nok' }) };
    transferred();
    executeTransferReversal.mockResolvedValue({ reversal: { id: 'trr_1' } });
    const order = { ...ORDER(), checkoutAmountMinor: 103000 };
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(disputeDoc(order)) });
    await run('full_refund_to_customer');
    expect(executeTransferReversal).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amount: 97000 }));
    expect(executeTransferReversal.mock.invocationCallOrder[0]).toBeLessThan(refundsCreate.mock.invocationCallOrder[0]);
  });

  it('a failed reversal refunds nothing and leaves the dispute open and retryable', async () => {
    const stripe = await withFee();
    stripe.transfers = { retrieve: jest.fn().mockResolvedValue({ id: 'tr_9', livemode: false, destination: 'acct_p', source_transaction: 'ch_1', amount: 97000, amount_reversed: 0, currency: 'nok' }) };
    transferred();
    executeTransferReversal.mockRejectedValue(new Error('Insufficient funds in the connected account'));
    const order = { ...ORDER(), checkoutAmountMinor: 103000 };
    const dispute = disputeDoc(order);
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(dispute) });
    await run('full_refund_to_customer');
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(dispute.status).toBe('open');
    expect(dispute.resolution.moneyState).toBe('failed');
    expect(order.status).toBe('disputed');
  });

  it.each(['closed', 'cancelled', 'resolved'])('a dispute cannot be ended by setting status %s', async (status) => {
    Dispute.findById.mockResolvedValue({ ...disputeDoc(ORDER()), status: 'under_review' });
    await updateDisputeStatus({ params: { disputeId: 'dispute_1' }, body: { status }, user: { _id: 'admin_1' } }, {});
    expect(captured.error).toEqual(expect.objectContaining({ status: 400 }));
  });

  describe('reopen', () => {
    let dispute; let payUpdate;
    beforeEach(() => {
      Dispute.findOne = jest.fn().mockReturnValue({ select: async () => null });
      Order.findOneAndUpdate = jest.fn().mockReturnValue({ select: async () => ({ status: 'completed' }) });
      payUpdate = jest.fn().mockResolvedValue({});
      Payment.updateOne = payUpdate;
      dispute = { ...disputeDoc('order_1'), status: 'resolved', resolution: { outcome: 'no_action', moneyState: 'settled' } };
      Dispute.findById.mockResolvedValue(dispute);
    });
    const reopen = () => reopenDispute({ params: { disputeId: 'dispute_1' }, body: { reason: 'Ny informasjon' }, user: { _id: 'admin_1' } }, {});

    it('clears the old resolution and puts the order back under dispute, so it can be resolved again', async () => {
      await reopen();
      expect(captured.error).toBeNull();
      expect(dispute).toMatchObject({ status: 'under_review', resolution: undefined, payoutFrozen: true, previousOrderStatus: 'completed' });
      expect(Order.findOneAndUpdate.mock.calls[0][1].$set).toEqual({ status: 'disputed' });
      expect(payUpdate).toHaveBeenCalledWith({ orderId: 'order_1', status: { $in: ['completed', 'released'] } }, { $set: { status: 'disputed' } });
    });

    it('a resolution that moved money cannot be reopened (no second refund or payout)', async () => {
      dispute.resolution = { outcome: 'full_refund_to_customer', moneyState: 'settled', stripeRefundId: 're_1' };
      await reopen();
      expect(captured.error).toEqual(expect.objectContaining({ status: 409 }));
      expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('a cancelled dispute (old dead end) can be reopened', async () => {
      dispute.status = 'cancelled';
      dispute.resolution = undefined;
      await reopen();
      expect(dispute.status).toBe('under_review');
    });

    it('refused while a payout or refund holds the order', async () => {
      Order.findOneAndUpdate.mockReturnValue({ select: async () => null });
      await reopen();
      expect(captured.error).toEqual(expect.objectContaining({ status: 409 }));
      expect(dispute.status).toBe('resolved');
    });

    it('refused when another dispute is already active on the order', async () => {
      Dispute.findOne.mockReturnValue({ select: async () => ({ _id: 'd2' }) });
      await reopen();
      expect(captured.error).toEqual(expect.objectContaining({ status: 409 }));
    });
  });
});

describe('money review follow-ups', () => {
  const StripeFinancialOperation = require('../models/StripeFinancialOperation');
  const { executeTransferReversal } = require('../services/stripe/financialOperations');

  it('a refund larger than what is still refundable is refused BEFORE the provider is reversed', async () => {
    const stripe = await getStripeForMode();
    const base = await stripe.charges.retrieve();
    stripe.charges.retrieve.mockResolvedValue({ ...base, amount_refunded: 40000 }); // 400 of 1000 already refunded
    stripe.transfers = { retrieve: jest.fn().mockResolvedValue({ id: 'tr_9', livemode: false, destination: 'acct_p', source_transaction: 'ch_1', amount: 97000, amount_reversed: 0, currency: 'nok' }) };
    Payout.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ status: 'transferred', stripeTransferId: 'tr_9', stripeConnectAccountId: 'acct_p', netProviderAmount: 970 }) });
    const order = ORDER();
    const dispute = disputeDoc(order);
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(dispute) });
    await run('full_refund_to_customer');
    expect(executeTransferReversal).not.toHaveBeenCalled();
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(dispute.resolution.moneyState).toBe('failed');
  });

  it('after Stripe failed the earlier refund, a new resolve uses a new attempt key', async () => {
    StripeFinancialOperation.findOne
      .mockReturnValueOnce({ select: () => ({ lean: async () => ({ status: 'failed' }) }) })
      .mockReturnValueOnce({ select: () => ({ lean: async () => null }) });
    const order = ORDER();
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(disputeDoc(order)) });
    await run('full_refund_to_customer');
    expect(executeRefund).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ operationKey: expect.stringMatching(/:attempt2$/) }));
    expect(order.status).toBe('cancelled');
  });

  it('a settled refund cancels the unpaid payout so it is not retried forever', async () => {
    const order = ORDER();
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(disputeDoc(order)) });
    await run('full_refund_to_customer');
    expect(Payout.updateOne).toHaveBeenCalledWith(
      { orderId: 'order_1', status: { $in: ['pending', 'failed', 'released_internal'] } },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'cancelled' }) })
    );
  });
});

it('a no_action ruling back to ready_for_review restarts the review window and its warning', async () => {
  const order = { ...ORDER(), readyForReviewAt: new Date('2026-01-01'), autoReleaseWarnedAt: new Date('2026-01-10') };
  Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(disputeDoc(order, 'ready_for_review')) });
  await run('no_action');
  expect(order.status).toBe('ready_for_review');
  expect(Date.now() - order.readyForReviewAt.getTime()).toBeLessThan(5000);
  expect(order.autoReleaseWarnedAt).toBeNull();
});

describe('final review: dispute money and status races', () => {
  const StripeFinancialOperation = require('../models/StripeFinancialOperation');
  const ORIGINAL_KEY = 'dispute:dispute_1:refund:pi_1:30000';
  // A refund an earlier 30/70 attempt started; Stripe timed out but the refund happened.
  const earlierRefund = (status = 'reconciliation_required') => {
    const ops = [{ disputeId: 'dispute_1', type: 'refund', status, operationKey: ORIGINAL_KEY }];
    StripeFinancialOperation.exists.mockImplementation(async (f) => ops.find((op) =>
      (f.disputeId === undefined || op.disputeId === f.disputeId) &&
      (f.type === undefined || op.type === f.type) &&
      f.status.$in.includes(op.status) &&
      (typeof f.operationKey === 'string' ? op.operationKey === f.operationKey : !f.operationKey || op.operationKey !== f.operationKey.$ne)) || null);
  };
  afterEach(() => StripeFinancialOperation.exists.mockImplementation(async () => null));

  it.each(['reconciliation_required', 'succeeded'])('F1: re-resolving with other amounts after an earlier refund (%s) refunds nothing more', async (status) => {
    earlierRefund(status);
    const order = ORDER();
    const dispute = disputeDoc(order);
    dispute.resolution = { outcome: 'split_payment', customerAmount: 300, providerAmount: 700, moneyState: status === 'succeeded' ? 'failed' : 'reconciliation_required' };
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(dispute) });
    await run('split_payment', { customerAmount: 330, providerAmount: 670 });
    expect(executeRefund).not.toHaveBeenCalled();
    expect(releasePayoutToProvider).not.toHaveBeenCalled();
    expect(dispute.resolution.moneyState).toBe('reconciliation_required');
    expect(order.status).toBe('disputed');
  });

  it('F1: an outcome without a refund (no_action) is refused too while that refund is unresolved', async () => {
    earlierRefund();
    const order = ORDER();
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(disputeDoc(order)) });
    await run('no_action');
    expect(captured.error.status).toBe(502);
    expect(order.status).toBe('disputed');
  });

  it('F1: the SAME outcome and amounts finish the earlier refund on its own key', async () => {
    earlierRefund();
    const order = ORDER();
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(disputeDoc(order)) });
    await run('split_payment', { customerAmount: 300, providerAmount: 700 });
    expect(executeRefund).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ operationKey: ORIGINAL_KEY }));
    expect(order.status).toBe('completed');
  });

  it('F2: a chargeback the platform WON does not block the dispute money (charge.disputed stays true)', async () => {
    const stripe = await getStripeForMode();
    const base = await stripe.charges.retrieve();
    stripe.charges.retrieve.mockImplementation(async (_id, opts) => ({ ...base, disputed: true, dispute: opts?.expand?.includes('dispute') ? { status: 'won' } : 'dp_1' }));
    const order = ORDER();
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(disputeDoc(order)) });
    await run('full_refund_to_customer');
    expect(refundsCreate).toHaveBeenCalled();
    expect(order.status).toBe('cancelled');
  });

  it('F2: a lost chargeback still blocks it', async () => {
    const stripe = await getStripeForMode();
    const base = await stripe.charges.retrieve();
    stripe.charges.retrieve.mockResolvedValue({ ...base, disputed: true, dispute: { status: 'lost' } });
    const order = ORDER();
    Dispute.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(disputeDoc(order)) });
    await run('full_refund_to_customer');
    expect(refundsCreate).not.toHaveBeenCalled();
    expect(order.status).toBe('disputed');
  });

  it('F3: reopen is refused while the order has a payout whose transfer outcome is unknown', async () => {
    const { reopenDispute } = require('../controllers/admin/disputesAdminController');
    const Order = require('../models/Order');
    Dispute.findOne = jest.fn().mockReturnValue({ select: async () => null });
    Order.findOneAndUpdate = jest.fn().mockReturnValue({ select: async () => ({ status: 'completed' }) });
    Payout.exists.mockResolvedValueOnce({ _id: 'payout_1' });
    Dispute.findById.mockResolvedValue({ ...disputeDoc('order_1'), status: 'resolved', resolution: { outcome: 'no_action', moneyState: 'settled' } });
    await reopenDispute({ params: { disputeId: 'dispute_1' }, body: { reason: 'Ny informasjon' }, user: { _id: 'admin_1' } }, {});
    expect(captured.error).toEqual(expect.objectContaining({ status: 409 }));
    expect(Payout.exists).toHaveBeenCalledWith({ orderId: 'order_1', status: { $in: ['processing', 'reconciliation_required'] } });
    expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
  });

  describe('F4: admin status writes are compare-and-swap, never over a concurrent resolve', () => {
    const ctl = require('../controllers/admin/disputesAdminController');
    const req = (body = {}) => ({ params: { disputeId: 'dispute_1' }, body, user: { _id: 'admin_1', name: 'Admin' }, headers: {} });
    beforeEach(() => {
      const doc = { ...disputeDoc('order_1'), status: 'open', messages: [] };
      Dispute.findById.mockReturnValue(Object.assign(Promise.resolve(doc), { populate() { return this; } }));
      Dispute.findOneAndUpdate.mockResolvedValue(null); // a resolve landed between read and write
    });
    it.each([
      ['assignDispute', {}],
      ['updateDisputeStatus', { status: 'under_review' }],
      ['requestInformation', { from: 'customer', message: 'Send kvittering' }],
    ])('%s answers 409 and filters on the status it read', async (fn, body) => {
      await ctl[fn](req(body), {});
      expect(captured.error).toEqual(expect.objectContaining({ status: 409 }));
      expect(Dispute.findOneAndUpdate.mock.calls[0][0]).toEqual({ _id: 'dispute_1', status: 'open' });
    });
  });
});

it('F4: a party message answering a request is compare-and-swap too (409 after a concurrent resolve)', async () => {
  const { addUserDisputeMessage } = require('../controllers/disputeController');
  Dispute.findById.mockReturnValue({ populate: async () => ({ _id: 'dispute_1', status: 'waiting_for_customer', orderId: { customerId: 'cust_1', providerId: 'prov_1' } }) });
  Dispute.findOneAndUpdate.mockResolvedValue(null);
  const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await addUserDisputeMessage({ params: { disputeId: '507f1f77bcf86cd799439011' }, userId: 'cust_1', body: { message: 'Her er kvitteringen' } }, res);
  expect(res.code).toBe(409);
  const [filter, update] = Dispute.findOneAndUpdate.mock.calls[0];
  expect(filter).toEqual({ _id: 'dispute_1', status: 'waiting_for_customer' });
  expect(update.$set).toEqual({ status: 'evidence_submitted' });
});
