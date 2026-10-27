/**
 * Listing / order lifecycle correctness:
 *  - cancelling an unpaid award reopens the listing and restores ONLY the applications
 *    that award auto-declined (not withdrawn / owner-declined), and one bad order does not
 *    abort the cleanup sweep;
 *  - scheduler sweeps rotate (lastAutoAttemptAt) and reconciliation reads recent orders;
 *  - a dispute closed inside the review window restarts auto-release; re-entering review
 *    resets the warning;
 *  - a cancelled contract no longer locks its chat;
 *  - chat message paging never repeats messages and counts in the database;
 *  - maxApplicants is enforced; accept/decline is a compare-and-swap;
 *  - the update path parses checklists like create; broadcasts never load readBy whole.
 */
jest.mock('../config/stripe', () => ({
  getStripeConfiguration: jest.fn(),
  getStripeForMode: jest.fn(),
}));
jest.mock('../services/stripe/financialHistory', () => ({
  reconcileConnectedAccountsBatch: jest.fn(),
}));
jest.mock('../utils/errorLogger', () => ({ logApplicationError: jest.fn() }));
jest.mock('../services/notifications', () => ({
  notify: jest.fn(),
  emitToUser: jest.fn(),
  forViewer: jest.requireActual('../services/notifications').forViewer,
}));
jest.mock('../services/payout/releasePayoutToProvider', () => jest.fn());
jest.mock('../models/Order', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateMany: jest.fn(),
}));
jest.mock('../models/Payment', () => ({ findOne: jest.fn() }));
jest.mock('../models/Payout', () => ({ findOne: jest.fn() }));
jest.mock('../models/Dispute', () => ({ findOne: jest.fn(), find: jest.fn() }));
jest.mock('../models/Service', () => ({ findById: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../models/JobRequest', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
  updateMany: jest.fn(),
  countDocuments: jest.fn(),
}));
jest.mock('../models/ChatMessage', () => ({
  aggregate: jest.fn(),
  findById: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock('../models/Notification', () => ({ find: jest.fn(), countDocuments: jest.fn() }));
jest.mock('../models/User', () => ({ exists: jest.fn(async () => null) }));
jest.mock('../middleware/requireProviderConnect', () => ({
  ensureProviderConnectReady: jest.fn(async () => true),
}));
jest.mock('../services/subscriptions/v2Entitlements', () => ({
  consumeApplicationContact: jest.fn(),
  V2EntitlementError: class extends Error {},
}));

const mongoose = require('mongoose');
const Order = require('../models/Order');
const Service = require('../models/Service');
const JobRequest = require('../models/JobRequest');
const Chat = require('../models/ChatMessage');
const Dispute = require('../models/Dispute');
const Notification = require('../models/Notification');
const jobs = require('../services/scheduler/jobs');
const { liveContractOrderId } = require('../services/order/releaseListing');

const id = () => new mongoose.Types.ObjectId();
const res = () => ({
  statusCode: 200,
  body: null,
  status(c) {
    this.statusCode = c;
    return this;
  },
  json(b) {
    this.body = b;
    return this;
  },
});
/** A query chain that records sort/select and resolves to `rows`. */
const chain = (rows, seen = {}) => {
  const c = {
    sort: (s) => {
      seen.sort = s;
      return c;
    },
    select: (s) => {
      seen.select = s;
      return c;
    },
    skip: () => c,
    limit: () => c,
    populate: () => c,
    lean: async () => rows,
    then: (ok, ko) => Promise.resolve(rows).then(ok, ko),
  };
  return c;
};

beforeEach(() => jest.clearAllMocks());

describe('cleanupAbandonedOrders', () => {
  it('restores only auto-declined applications, survives E11000 and a failing order, rotates', async () => {
    const seen = {};
    Order.find.mockReturnValue(
      chain(
        [
          { _id: 'o1', serviceId: 's1' },
          { _id: 'o2', serviceId: 's2' },
        ],
        seen
      )
    );
    Order.findOneAndUpdate
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ _id: 'o2', serviceId: 's2', chatId: null });
    Order.findOne.mockReturnValue(chain(null));
    Service.findOneAndUpdate.mockResolvedValue({ _id: 's2' });
    JobRequest.find.mockReturnValue(chain([{ _id: 'r1' }, { _id: 'r2' }]));
    JobRequest.updateOne
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }))
      .mockResolvedValueOnce({});

    await expect(jobs.cleanupAbandonedOrders()).resolves.toEqual({ cancelled: 1, reopened: 1 });

    expect(seen.sort).toEqual({ lastAutoAttemptAt: 1, _id: 1 });
    expect(Order.updateMany).toHaveBeenCalledWith(
      { _id: { $in: ['o1', 'o2'] } },
      { $set: { lastAutoAttemptAt: expect.any(Date) } },
      { timestamps: false }
    );
    expect(JobRequest.updateMany).not.toHaveBeenCalled(); // the blanket resurrect is gone
    expect(JobRequest.find).toHaveBeenCalledWith({
      serviceId: 's2',
      status: 'declined',
      autoDeclinedByOrderId: 'o2',
      withdrawnAt: null,
    });
    expect(JobRequest.updateOne).toHaveBeenCalledTimes(2);
  });
});

describe('scheduler batching', () => {
  it('reconcileMoneyState reads recent terminal orders newest first', async () => {
    const seen = {};
    let filter;
    Order.find.mockImplementation((f) => {
      filter = f;
      return chain([], seen);
    });
    Dispute.find.mockReturnValue(chain([]));
    await jobs.reconcileMoneyState();
    expect(filter.updatedAt.$gte).toBeInstanceOf(Date);
    expect(seen.sort).toEqual({ updatedAt: -1 });
  });

  it('auto-release rotates its batch and treats a recently closed dispute as blocking', async () => {
    const seen = {};
    Order.find.mockReturnValue(chain([{ _id: 'o9', agreedPrice: 1000 }], seen));
    let disputeFilter;
    Dispute.findOne.mockImplementation((f) => {
      disputeFilter = f;
      return chain({ _id: 'd1' });
    });
    await expect(jobs.autoReleaseStaleReviews()).resolves.toEqual({ scanned: 1, released: 0 });
    expect(seen.sort).toEqual({ lastAutoAttemptAt: 1, _id: 1 });
    expect(Order.updateMany).toHaveBeenCalled();
    expect(disputeFilter.$or[1]).toEqual({ closedAt: { $gt: expect.any(Date) } });
  });
});

it('markReadyForReview restarts the auto-release warning', async () => {
  const provider = id();
  Order.findById.mockResolvedValue({
    _id: id(),
    providerId: provider,
    status: 'in_progress',
    paymentStatus: 'paid',
  });
  Dispute.findOne.mockResolvedValue(null);
  Order.findOneAndUpdate.mockResolvedValue(null);
  await require('../controllers/providerWorkController').markReadyForReview(
    { params: { orderId: String(id()) }, userId: String(provider) },
    res()
  );
  expect(Order.findOneAndUpdate.mock.calls[0][1].$set).toEqual(
    expect.objectContaining({ readyForReviewAt: expect.any(Date), autoReleaseWarnedAt: null })
  );
});

describe('chat', () => {
  const chatController = require('../controllers/chatController');

  it('a cancelled contract no longer counts as one', async () => {
    expect(await liveContractOrderId({ orderId: { _id: 'o1', status: 'cancelled' } })).toBeNull();
    expect(await liveContractOrderId({ orderId: { _id: 'o1', status: 'paid' } })).toBe('o1');
    Order.findById.mockReturnValue(chain({ status: 'declined' }));
    expect(await liveContractOrderId({ orderId: id() })).toBeNull();
  });

  it('the owner can renegotiate the price after the contract was cancelled', async () => {
    const owner = id();
    const chat = {
      clientId: owner,
      providerId: id(),
      serviceId: { userId: owner },
      orderId: id(),
      messages: [],
      save: jest.fn(),
    };
    Chat.findById
      .mockReturnValueOnce({ populate: async () => chat })
      .mockReturnValueOnce(chain({}));
    Order.findById.mockReturnValue(chain({ status: 'cancelled' }));
    const r = res();
    await chatController.updateAgreedPrice(
      { user: { id: String(owner) }, params: { chatId: String(id()) }, body: { agreedPrice: 900 } },
      r
    );
    expect(r.statusCode).toBe(200);
    expect(chat.agreedPrice).toBe(900);
  });

  it('pages past the oldest message without repeating, counted by $size', async () => {
    const me = id();
    const slices = [];
    Chat.aggregate.mockResolvedValue([{ clientId: me, providerId: id(), total: 60 }]);
    Chat.findById.mockImplementation(() => {
      const c = chain({ toObject: () => ({ messages: [] }) });
      c.select = (s) => {
        slices.push(s.messages.$slice);
        return c;
      };
      return c;
    });
    for (const offset of ['0', '50', '100']) {
      await chatController.getChatById(
        {
          user: { id: String(me) },
          params: { chatId: String(id()) },
          query: { offset, limit: '50' },
        },
        res()
      );
    }
    expect(slices).toEqual([
      [10, 50],
      [0, 10],
      [60, 1],
    ]);
  });
});

describe('job requests', () => {
  const orderController = require('../controllers/orderController');

  it('refuses an application once maxApplicants is reached', async () => {
    const owner = id();
    Service.findById.mockResolvedValue({
      _id: id(),
      userId: owner,
      status: 'open',
      maxApplicants: 2,
      price: 100,
    });
    Order.findOne.mockResolvedValue(null);
    JobRequest.findOne.mockResolvedValue(null);
    JobRequest.countDocuments.mockResolvedValue(2);
    const r = res();
    await orderController.createJobRequest(
      { body: { serviceId: String(id()) }, userId: String(id()) },
      r
    );
    expect(r.statusCode).toBe(400);
    expect(r.body.limitReached).toBe(true);
  });

  it('accept/decline is a compare-and-swap on pending', async () => {
    const owner = id();
    JobRequest.findById.mockResolvedValue({
      _id: id(),
      providerId: owner,
      status: 'pending',
      save: jest.fn(),
    });
    JobRequest.findOneAndUpdate.mockResolvedValue(null); // the other request won
    const r = res();
    await orderController.updateJobRequestStatus(
      { params: { id: String(id()) }, body: { status: 'accepted' }, userId: String(owner) },
      r
    );
    expect(r.statusCode).toBe(400);
    expect(JobRequest.findOneAndUpdate.mock.calls[0][0]).toEqual(
      expect.objectContaining({ status: 'pending' })
    );
  });

  it('JobRequest has providerId-leading indexes', () => {
    const keys = jest
      .requireActual('../models/JobRequest')
      .schema.indexes()
      .map(([k]) => JSON.stringify(k));
    expect(keys).toEqual(
      expect.arrayContaining(['{"providerId":1,"createdAt":-1}', '{"providerId":1,"status":1}'])
    );
  });
});

it('the listing update path parses checklists with the create rules', () => {
  const { parseChecklist } = require('../controllers/services/manageController');
  expect(parseChecklist('{"a":1}').error).toBeDefined();
  expect(parseChecklist(new Array(51).fill({ text: 'x' })).error).toBeDefined();
  expect(parseChecklist('[{"id":"1","text":"Mal"}]')).toEqual({
    items: [{ id: '1', text: 'Mal' }],
  });
});

it('the notification tray never loads a broadcast readBy list', async () => {
  const viewer = id();
  const n1 = id();
  const seen = {};
  Notification.countDocuments.mockResolvedValue(1);
  Notification.find
    .mockReturnValueOnce(chain([{ _id: n1, userId: null, isSystem: true, read: false }], seen))
    .mockReturnValueOnce(chain([{ _id: n1 }]));
  const r = res();
  await require('../controllers/notificationController').getAllNotifications(
    { userId: String(viewer), query: {} },
    r
  );
  expect(seen.select).toBe('-readBy');
  expect(r.body.data[0].read).toBe(true);
  expect(r.body.data[0].readBy).toBeUndefined();
});
