const mongoose = require('mongoose');

jest.mock('../models/Order', () => ({ findById: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../models/Payment', () => ({ findOne: jest.fn() }));
jest.mock('../models/SafePayHistory', () => ({ findOneAndUpdate: jest.fn() }));
jest.mock('../models/ChatMessage', () => ({ findByIdAndUpdate: jest.fn() }));
jest.mock('../models/Dispute', () => {
  const mock = jest.fn();
  mock.findOne = jest.fn();
  return mock;
});
jest.mock('../models/Notification', () => ({ create: jest.fn() }));
jest.mock('../models/Payout', () => ({ exists: jest.fn(async () => null) }));
jest.mock('../services/admin/activityService');

const Order = require('../models/Order');
const Payment = require('../models/Payment');
const SafePayHistory = require('../models/SafePayHistory');
const Dispute = require('../models/Dispute');
const Notification = require('../models/Notification');
const { openDispute, DISPUTE_ELIGIBLE_STATUSES } = require('../services/admin/safePayStateService');

function makeOrder(status) {
  return {
    _id: new mongoose.Types.ObjectId(),
    status,
    customerId: new mongoose.Types.ObjectId(),
    providerId: new mongoose.Types.ObjectId(),
    chatId: null,
    history: [],
    save: jest.fn(function () {
      return Promise.resolve(this);
    }),
  };
}

describe('openDispute eligibility', () => {
  beforeEach(() => jest.clearAllMocks());

  it('allows a dispute at the approval stage (ready_for_review) — BUG-003', async () => {
    const order = makeOrder('ready_for_review');
    Order.findById.mockResolvedValue(order);
    Order.findOneAndUpdate.mockImplementation(async () => {
      order.status = 'disputed';
      return order;
    });
    Dispute.findOne.mockResolvedValue(null);
    Payment.findOne.mockResolvedValue(null);
    SafePayHistory.findOneAndUpdate.mockResolvedValue(null);
    Notification.create.mockResolvedValue(null);
    Dispute.mockReturnValue({
      _id: new mongoose.Types.ObjectId(),
      status: 'open',
      save: jest.fn().mockResolvedValue(),
    });

    const dispute = await openDispute({
      orderId: order._id,
      openedByUserId: order.providerId,
      openedByRole: 'provider',
      reasonCategory: 'other',
      title: 'Konflikt i godkjenningsfasen',
      description: 'Fikk ikke betalt som avtalt for utført arbeid.',
      adminId: order.providerId,
    });

    expect(dispute.status).toBe('open');
    expect(order.status).toBe('disputed');
  });

  it('still rejects ineligible statuses (awaiting_payment)', async () => {
    const order = makeOrder('awaiting_payment');
    Order.findById.mockResolvedValue(order);

    await expect(
      openDispute({
        orderId: order._id,
        openedByUserId: order.providerId,
        openedByRole: 'provider',
        reasonCategory: 'other',
        title: 'Tittel',
        description: 'En beskrivelse som er lang nok til å passere validering.',
        adminId: order.providerId,
      })
    ).rejects.toThrow('Tvist kan ikke åpnes');
  });
});

it('F3: refuses to open a dispute while the order has a payout whose transfer outcome is unknown', async () => {
  const Payout = require('../models/Payout');
  const order = makeOrder('completed');
  Order.findById.mockResolvedValue(order);
  Dispute.findOne.mockResolvedValue(null);
  Payout.exists.mockResolvedValueOnce({ _id: 'payout_1' });
  await expect(openDispute({
    orderId: order._id, openedByUserId: order.customerId, openedByRole: 'customer',
    reasonCategory: 'other', title: 'Tittel', description: 'Beskrivelse', adminId: order.customerId,
  })).rejects.toThrow(/avstemmes/);
  expect(Payout.exists).toHaveBeenCalledWith({ orderId: order._id, status: { $in: ['processing', 'reconciliation_required'] } });
  expect(Order.findOneAndUpdate).not.toHaveBeenCalled();
});
