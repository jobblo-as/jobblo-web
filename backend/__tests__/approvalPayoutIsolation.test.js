/**
 * H6 (path 1): approval marks the order `completed` first, so a second approval is
 * refused. A failing bookkeeping step after that (chat, listing, history, review,
 * stats) used to end the request with a 500 before any payout existed, and nothing
 * retried it. The money step must still run.
 */
jest.mock('../models/Order', () => ({ findById: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../models/Service', () => ({ findByIdAndUpdate: jest.fn() }));
jest.mock('../models/User', () => ({ findById: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../models/Payment', () => ({ findOne: jest.fn() }));
jest.mock('../models/SafePayHistory', () => ({
  findOne: jest.fn(),
  updateOne: jest.fn(),
  create: jest.fn(),
  OPEN_STATUSES: [],
}));
jest.mock('../models/Review', () => ({ findOne: jest.fn(), create: jest.fn(), find: jest.fn() }));
jest.mock('../models/ChatMessage', () => ({ findById: jest.fn() }));
jest.mock('../models/Dispute', () => ({ findOne: jest.fn() }));
jest.mock('../services/notifications', () => ({ notify: jest.fn(), emitToUser: jest.fn() }));
jest.mock('../utils/errorLogger', () => ({
  logApplicationError: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/payout/releasePayoutToProvider', () => jest.fn());

const Order = require('../models/Order');
const Service = require('../models/Service');
const User = require('../models/User');
const Payment = require('../models/Payment');
const SafePayHistory = require('../models/SafePayHistory');
const Review = require('../models/Review');
const Chat = require('../models/ChatMessage');
const Dispute = require('../models/Dispute');
const { logApplicationError } = require('../utils/errorLogger');
const releasePayoutToProvider = require('../services/payout/releasePayoutToProvider');
const { approveAndPayout } = require('../controllers/SafePayCheckoutController');

const ORDER_ID = '64b000000000000000000001';
const order = () => ({
  _id: ORDER_ID,
  customerId: 'cust',
  providerId: 'prov',
  chatId: 'chat1',
  agreedPrice: 1000,
  status: 'ready_for_review',
  paymentStatus: 'paid',
  serviceId: { _id: 'svc', title: 'Maling' },
});
const populated = (v) => ({ populate: async () => v });

async function approve() {
  const res = {
    code: 200,
    body: null,
    status(c) {
      this.code = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
  await approveAndPayout(
    { userId: 'cust', body: { orderId: ORDER_ID, ratings: { overall: 5 } } },
    res
  );
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  Order.findById.mockReturnValue(populated(order()));
  Order.findOneAndUpdate.mockReturnValue(populated({ ...order(), status: 'completed' }));
  Dispute.findOne.mockResolvedValue(null);
  Chat.findById.mockResolvedValue({ messages: [], save: jest.fn() });
  SafePayHistory.findOne.mockResolvedValue({ _id: 'h1' });
  Review.findOne.mockResolvedValue(null);
  Review.create.mockResolvedValue({});
  Service.findByIdAndUpdate.mockResolvedValue({});
  Review.find.mockResolvedValue([]);
  User.findById.mockResolvedValue(null);
  Payment.findOne.mockResolvedValue({ stripePaymentIntentId: 'pi', stripeSessionId: 'cs' });
  releasePayoutToProvider.mockResolvedValue({ payout: { status: 'transferred' } });
});

it.each([
  ['the chat update', () => Chat.findById.mockRejectedValue(new Error('chat db down'))],
  [
    'the listing update',
    () => Service.findByIdAndUpdate.mockRejectedValue(new Error('service db down')),
  ],
  ['the review', () => Review.create.mockRejectedValue(new Error('validation failed'))],
])('when %s fails, the provider is still paid and the error is logged', async (_name, breakIt) => {
  breakIt();
  const res = await approve();
  expect(releasePayoutToProvider).toHaveBeenCalledWith(
    expect.objectContaining({
      orderId: ORDER_ID,
      releaseSource: 'customer_approve',
      grossAmount: 1000,
      platformFee: 30,
    })
  );
  expect(res.code).toBe(200);
  expect(logApplicationError).toHaveBeenCalledWith(
    expect.objectContaining({ errorCode: 'APPROVAL_SIDE_EFFECT_FAILED' })
  );
});

it('the normal path pays and logs nothing', async () => {
  const res = await approve();
  expect(res.code).toBe(200);
  expect(releasePayoutToProvider).toHaveBeenCalledTimes(1);
  expect(logApplicationError.mock.calls.map(([a]) => a.error.message)).toEqual([]);
});

it('approval never rewrites paymentStatus: a refund that landed concurrently is not overwritten', async () => {
  await approve();
  const [filter, update] = Order.findOneAndUpdate.mock.calls[0];
  expect(filter).toMatchObject({ status: 'ready_for_review', paymentStatus: 'paid' });
  expect(update.$set).not.toHaveProperty('paymentStatus');
});
