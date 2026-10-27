jest.mock('../models/Order', () => ({ findById: jest.fn() }));
jest.mock('../models/Payment', () => ({ findOne: jest.fn() }));
jest.mock('../models/Payout', () => ({
  findOne: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) })),
}));
jest.mock('../models/StripeTransferRecord', () => ({
  findOne: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) })),
}));
jest.mock('../models/StripePaymentIncident', () => ({
  findById: jest.fn(),
  // Sibling incidents of the same Stripe dispute (one per charge.dispute.* event).
  find: jest.fn(() => ({
    select: () => ({
      lean: async () => [{ _id: '507f1f77bcf86cd799439011' }, { _id: 'sibling_incident' }],
    }),
  })),
  countDocuments: jest.fn(),
  updateMany: jest.fn().mockResolvedValue({}),
  findOneAndUpdate: jest.fn(async () => ({})), // recovery lease lock
  updateOne: jest.fn().mockResolvedValue({}),
}));
jest.mock('../models/StripeFinancialOperation', () => ({
  find: jest.fn(() => ({ select: () => ({ lean: async () => [] }) })),
}));
jest.mock('../config/stripe', () => ({ getStripeForMode: jest.fn() }));
jest.mock('../services/stripe/financialOperations', () => ({
  executeRefund: jest.fn(),
  executeTransferReversal: jest.fn(),
}));
jest.mock('../services/admin/activityService', () => ({ logActivity: jest.fn() }));

const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Payout = require('../models/Payout');
const StripePaymentIncident = require('../models/StripePaymentIncident');
const StripeFinancialOperation = require('../models/StripeFinancialOperation');
const { getStripeForMode } = require('../config/stripe');
const { executeTransferReversal } = require('../services/stripe/financialOperations');
const {
  reverseChargebackTransfer,
} = require('../controllers/admin/stripePaymentIncidentController');

const incidentId = '507f1f77bcf86cd799439011';

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function request(amountMinor = 50000) {
  return {
    params: { id: incidentId },
    body: { amountMinor, reason: 'Approved after chargeback review' },
    user: { _id: 'admin_1' },
    ip: '127.0.0.1',
    headers: {},
  };
}

let incident;
let stripe;

beforeEach(() => {
  jest.clearAllMocks();
  incident = {
    _id: incidentId,
    kind: 'charge_dispute',
    status: 'manual_review',
    orderId: 'order_1',
    stripeDisputeId: 'dp_test_1',
    paymentIntentId: 'pi_test_1',
    checkoutSessionId: 'cs_test_1',
    stripeCustomerId: 'cus_test_1',
    chargeId: 'ch_test_1',
    providerTransferId: 'tr_test_1',
    livemode: false,
    amount: 50000,
    currency: 'NOK',
    save: jest.fn().mockResolvedValue(undefined),
  };
  StripePaymentIncident.findById.mockResolvedValue(incident);
  Order.findById.mockResolvedValue({
    _id: 'order_1',
    customerId: 'customer_1',
    checkoutMode: 'test',
    checkoutSessionId: 'cs_test_1',
    paymentIntentId: 'pi_test_1',
    checkoutCustomerId: 'cus_test_1',
    checkoutAmountMinor: 103000,
    checkoutCurrency: 'nok',
  });
  Payment.findOne.mockResolvedValue({
    _id: 'payment_1',
    stripePaymentIntentId: 'pi_test_1',
    stripeSessionId: 'cs_test_1',
    stripeLivemode: false,
  });
  Payout.findOne.mockReturnValue({
    lean: jest.fn().mockResolvedValue({
      stripeTransferId: 'tr_test_1',
      stripeLivemode: false,
      stripeConnectAccountId: 'acct_test_1',
      netProviderAmount: 970,
      stripePaymentIntentId: 'pi_test_1',
    }),
  });
  stripe = {
    disputes: {
      retrieve: jest.fn().mockResolvedValue({
        id: 'dp_test_1',
        status: 'lost',
        livemode: false,
        charge: 'ch_test_1',
        payment_intent: 'pi_test_1',
        amount: 50000,
        currency: 'nok',
      }),
    },
    checkout: {
      sessions: {
        retrieve: jest.fn().mockResolvedValue({
          id: 'cs_test_1',
          status: 'complete',
          payment_status: 'paid',
          livemode: false,
          mode: 'payment',
          payment_intent: 'pi_test_1',
          customer: 'cus_test_1',
          metadata: { orderId: 'order_1', userId: 'customer_1' },
          amount_total: 103000,
          currency: 'nok',
        }),
      },
    },
    paymentIntents: {
      retrieve: jest.fn().mockResolvedValue({
        id: 'pi_test_1',
        status: 'succeeded',
        livemode: false,
        amount_received: 103000,
        customer: 'cus_test_1',
        latest_charge: 'ch_test_1',
      }),
    },
    charges: {
      retrieve: jest.fn().mockResolvedValue({
        id: 'ch_test_1',
        paid: true,
        captured: true,
        livemode: false,
        payment_intent: 'pi_test_1',
        customer: 'cus_test_1',
        amount: 103000,
        currency: 'nok',
      }),
    },
    transfers: {
      retrieve: jest
        .fn()
        .mockResolvedValueOnce({
          id: 'tr_test_1',
          livemode: false,
          source_transaction: 'ch_test_1',
          destination: 'acct_test_1',
          amount: 97000,
          amount_reversed: 0,
          currency: 'nok',
        })
        .mockResolvedValueOnce({
          id: 'tr_test_1',
          livemode: false,
          source_transaction: 'ch_test_1',
          amount_reversed: 50000,
        }),
    },
  };
  getStripeForMode.mockResolvedValue(stripe);
  executeTransferReversal.mockResolvedValue({
    operation: { _id: 'operation_1' },
    reversal: { id: 'trr_test_1' },
    status: 'succeeded',
  });
});

it('requires a final Stripe-lost chargeback and an explicit bounded recovery approval', async () => {
  stripe.disputes.retrieve.mockResolvedValueOnce({
    id: 'dp_test_1',
    status: 'needs_response',
    livemode: false,
    charge: 'ch_test_1',
    payment_intent: 'pi_test_1',
    amount: 50000,
    currency: 'nok',
  });
  const res = response();

  await reverseChargebackTransfer(request(), res);

  expect(res.statusCode).toBe(409);
  expect(executeTransferReversal).not.toHaveBeenCalled();
  expect(stripe.transfers.retrieve).not.toHaveBeenCalled();
});

it('reverses only an admin-approved amount after verifying the lost dispute, charge, order and transfer', async () => {
  const res = response();

  await reverseChargebackTransfer(request(), res);

  expect(executeTransferReversal).toHaveBeenCalledWith(
    stripe,
    expect.objectContaining({
      operationKey: `chargeback:${incidentId}:reversal:tr_test_1:50000`,
      paymentIntentId: 'pi_test_1',
      chargeId: 'ch_test_1',
      transferId: 'tr_test_1',
      amount: 50000,
      currency: 'NOK',
    })
  );
  expect(incident).toMatchObject({
    status: 'reconciled',
    transferReversedAmount: 50000,
    resolutionOperationId: 'operation_1',
  });
  expect(res.statusCode).toBe(200);
});

describe('cumulative recovery cap', () => {
  const priorOps = (ops) =>
    StripeFinancialOperation.find.mockReturnValue({ select: () => ({ lean: async () => ops }) });

  it('refuses a second approval that would recover more than the chargeback in total', async () => {
    // 30000 of this incident was already recovered by an earlier, different-amount approval.
    priorOps([{ amount: 30000 }]);
    const res = response();

    await reverseChargebackTransfer(request(), res); // asks for 50000 more; incident is 50000

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      code: 'chargeback_recovery_exceeds_incident',
      alreadyRecovered: 30000,
    });
    expect(executeTransferReversal).not.toHaveBeenCalled();
  });

  it("counts only this incident's other recoveries and lets an idempotent retry through", async () => {
    priorOps([]);
    const res = response();
    await reverseChargebackTransfer(request(), res);

    const [filter] = StripeFinancialOperation.find.mock.calls.at(-1);
    expect(filter).toMatchObject({
      incidentId: expect.anything(),
      type: 'transfer_reversal',
      status: { $in: ['pending', 'succeeded', 'reconciliation_required'] },
      operationKey: { $ne: `chargeback:${incidentId}:reversal:tr_test_1:50000` },
    });
    expect(executeTransferReversal).toHaveBeenCalledTimes(1);
  });

  it('counts recoveries made under OTHER incidents of the same Stripe dispute', async () => {
    // A 300 kr recovery already ran on the "created" incident; this is the "closed" one.
    priorOps([{ amount: 50000 }]);
    const res = response();
    await reverseChargebackTransfer(request(), res);
    const [filter] = StripeFinancialOperation.find.mock.calls.at(-1);
    expect(filter.incidentId).toEqual({ $in: ['507f1f77bcf86cd799439011', 'sibling_incident'] });
    expect(res.statusCode).toBe(409);
    expect(executeTransferReversal).not.toHaveBeenCalled();
  });
});

describe('final review: chargeback close paths', () => {
  beforeEach(() =>
    StripeFinancialOperation.find.mockReturnValue({ select: () => ({ lean: async () => [] }) })
  );
  const fullChargeback = () => {
    incident.amount = 103000; // the whole charge, fee included
    stripe.disputes.retrieve.mockResolvedValue({
      id: 'dp_test_1',
      status: 'lost',
      livemode: false,
      charge: 'ch_test_1',
      payment_intent: 'pi_test_1',
      amount: 103000,
      currency: 'nok',
    });
  };

  it('F5: recovering the whole (net) transfer reconciles a full-charge chargeback', async () => {
    fullChargeback();
    stripe.transfers.retrieve
      .mockReset()
      .mockResolvedValueOnce({
        id: 'tr_test_1',
        livemode: false,
        source_transaction: 'ch_test_1',
        destination: 'acct_test_1',
        amount: 97000,
        amount_reversed: 0,
        currency: 'nok',
      })
      .mockResolvedValueOnce({
        id: 'tr_test_1',
        livemode: false,
        source_transaction: 'ch_test_1',
        amount_reversed: 97000,
      });
    const res = response();
    await reverseChargebackTransfer(request(97000), res);
    expect(res.statusCode).toBe(200);
    expect(incident.status).toBe('reconciled');
  });

  it('F6: a concurrent approval that cannot take the recovery lock moves nothing', async () => {
    StripePaymentIncident.findOneAndUpdate.mockResolvedValueOnce(null);
    const res = response();
    await reverseChargebackTransfer(request(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ code: 'chargeback_recovery_in_progress' });
    expect(executeTransferReversal).not.toHaveBeenCalled();
  });

  it('F6: the lock is taken before the cap is read and released afterwards, even on refusal', async () => {
    StripeFinancialOperation.find.mockReturnValue({
      select: () => ({ lean: async () => [{ amount: 50000 }] }),
    });
    await reverseChargebackTransfer(request(), response());
    expect(StripePaymentIncident.findOneAndUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      StripeFinancialOperation.find.mock.invocationCallOrder[0]
    );
    const [lockFilter, lockUpdate] = StripePaymentIncident.findOneAndUpdate.mock.calls[0];
    expect(lockFilter._id).toBe(incidentId);
    expect(StripePaymentIncident.updateOne).toHaveBeenCalledWith(
      { _id: incidentId, recoveryLockedAt: lockUpdate.$set.recoveryLockedAt },
      { $set: { recoveryLockedAt: null } }
    );
  });

  describe('F5: a chargeback lost before any payout can be closed', () => {
    const {
      closeLostChargebackWithoutTransfer,
    } = require('../controllers/admin/stripePaymentIncidentController');
    const Order = require('../models/Order');
    let payout;
    beforeEach(() => {
      fullChargeback();
      incident.providerTransferId = undefined;
      payout = { _id: 'payout_1', status: 'failed', stripeTransferId: null };
      Payout.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(payout) });
      Payout.updateOne = jest.fn().mockResolvedValue({ matchedCount: 1 });
      Payment.updateOne = jest.fn().mockResolvedValue({});
      Order.updateOne = jest.fn().mockResolvedValue({});
      stripe.charges.retrieve.mockResolvedValue({
        id: 'ch_test_1',
        payment_intent: 'pi_test_1',
        amount: 103000,
        amount_refunded: 0,
      });
    });
    const close = async () => {
      const res = response();
      await closeLostChargebackWithoutTransfer(
        {
          params: { id: incidentId },
          body: { reason: 'Lost at the bank, never paid out' },
          user: { _id: 'admin_1' },
        },
        res
      );
      return res;
    };

    it('cancels the payout, refunds the payment, cancels the order and reconciles every incident of the dispute', async () => {
      const res = await close();
      expect(res.statusCode).toBe(200);
      expect(Payout.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 'payout_1', stripeTransferId: null }),
        expect.objectContaining({ $set: expect.objectContaining({ status: 'cancelled' }) })
      );
      expect(Payment.updateOne).toHaveBeenCalledWith(
        { _id: 'payment_1' },
        { $set: { status: 'refunded' } }
      );
      expect(Order.updateOne.mock.calls[0][1].$set).toEqual({
        status: 'cancelled',
        paymentStatus: 'refunded',
      });
      expect(StripePaymentIncident.updateMany).toHaveBeenCalledWith(
        { stripeDisputeId: 'dp_test_1', status: 'manual_review' },
        expect.objectContaining({ $set: expect.objectContaining({ status: 'reconciled' }) })
      );
      expect(Payout.updateOne.mock.invocationCallOrder[0]).toBeLessThan(
        StripePaymentIncident.updateMany.mock.invocationCallOrder[0]
      );
    });

    it.each([
      [
        'a transfer exists',
        () => {
          payout.stripeTransferId = 'tr_1';
          payout.status = 'transferred';
        },
        'chargeback_transfer_exists',
      ],
      [
        'the transfer outcome is unknown',
        () => {
          payout.status = 'reconciliation_required';
        },
        'chargeback_transfer_exists',
      ],
      [
        'the chargeback is not lost',
        () =>
          stripe.disputes.retrieve.mockResolvedValue({
            id: 'dp_test_1',
            status: 'under_review',
            livemode: false,
            charge: 'ch_test_1',
            payment_intent: 'pi_test_1',
            amount: 103000,
          }),
        'chargeback_not_final_or_partial',
      ],
      [
        'only part of the charge was charged back',
        () =>
          stripe.disputes.retrieve.mockResolvedValue({
            id: 'dp_test_1',
            status: 'lost',
            livemode: false,
            charge: 'ch_test_1',
            payment_intent: 'pi_test_1',
            amount: 50000,
          }),
        'chargeback_not_final_or_partial',
      ],
    ])('is refused when %s', async (_name, setup, code) => {
      setup();
      const res = await close();
      expect(res.statusCode).toBe(409);
      expect(res.body.code).toBe(code);
      expect(Order.updateOne).not.toHaveBeenCalled();
      expect(StripePaymentIncident.updateMany).not.toHaveBeenCalled();
    });
  });
});
