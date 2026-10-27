/**
 * Awarding a job is the service owner's decision.
 *
 * The chat contract endpoint only checked that the caller was a participant in the
 * conversation. In an owner-initiated chat the applicant sits in `chat.providerId`,
 * so the applicant could award themselves the contract — at a price taken from their
 * own request body.
 */

jest.mock('../models/ChatMessage', () => ({ findById: jest.fn() }));
jest.mock('../models/Order', () => ({ findOne: jest.fn(), findById: jest.fn() }));
jest.mock('../models/User', () => ({ findById: jest.fn(), exists: jest.fn(async () => null) }));
jest.mock('../models/Service', () => ({
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findOneAndUpdate: jest.fn(async () => ({})),
  updateOne: jest.fn(async () => ({})),
}));
jest.mock('../config/stripe', () => ({ getStripe: jest.fn() }));
jest.mock('../services/stripe/customers', () => ({ resolveStripeCustomer: jest.fn() }));

const mongoose = require('mongoose');
const Chat = require('../models/ChatMessage');
const Order = require('../models/Order');
const chatController = require('../controllers/chatController');

const OWNER_ID = new mongoose.Types.ObjectId();
const APPLICANT_ID = new mongoose.Types.ObjectId();
const SERVICE_ID = new mongoose.Types.ObjectId();
const CHAT_ID = new mongoose.Types.ObjectId();

/** Owner-initiated chat: clientId = owner, providerId = applicant. */
function ownerInitiatedChat(overrides = {}) {
  return {
    _id: CHAT_ID,
    clientId: { _id: OWNER_ID },
    providerId: { _id: APPLICANT_ID },
    serviceId: {
      _id: SERVICE_ID,
      userId: OWNER_ID, // the owner owns the listing
      price: 1000,
      checklist: [],
    },
    orderId: null,
    agreedPrice: 1000,
    messages: [],
    save: jest.fn().mockResolvedValue(),
    ...overrides,
  };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  Order.findOne.mockResolvedValue(null);
});

describe('createContract authorization', () => {
  it('refuses when the caller is the APPLICANT, not the service owner', async () => {
    Chat.findById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(ownerInitiatedChat()),
    });

    const req = {
      user: { id: String(APPLICANT_ID) },
      params: { chatId: String(CHAT_ID) },
      body: { agreedPrice: 99999 }, // and at a price of their choosing
    };
    const res = makeRes();

    await chatController.createContract(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/oppdragsgiveren/i);
  });

  it('refuses a chat participant who owns neither side of the listing', async () => {
    const stranger = new mongoose.Types.ObjectId();
    Chat.findById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(ownerInitiatedChat({ providerId: { _id: stranger } })),
    });

    const req = {
      user: { id: String(stranger) },
      params: { chatId: String(CHAT_ID) },
      body: {},
    };
    const res = makeRes();

    await chatController.createContract(req, res);

    expect(res.statusCode).toBe(403);
  });

  it('refuses when a contract-bearing order already exists for the service', async () => {
    Chat.findById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(ownerInitiatedChat()),
    });
    Order.findOne.mockResolvedValue({ _id: 'existing_order' });

    const req = {
      user: { id: String(OWNER_ID) },
      params: { chatId: String(CHAT_ID) },
      body: {},
    };
    const res = makeRes();

    await chatController.createContract(req, res);

    expect(res.statusCode).toBe(400);
    // Only genuinely blocking statuses count — a stray `pending` order must not
    // brick the listing.
    expect(Order.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        status: {
          $in: [
            'awaiting_payment',
            'paid',
            'in_progress',
            'ready_for_review',
            'disputed',
            'completed',
          ],
        },
      })
    );
  });
});

// Z3: deleteChat hard-deleted the shared conversation for both parties; only active orders,
// disputes and open reports were protected, so a harasser could wipe it before being reported.
describe('deleteChat only hides the conversation for the caller', () => {
  it.each([
    ['no order', null],
    ['a completed order', 'order_1'],
  ])('keeps a chat with %s and hides it for the caller', async (_label, orderId) => {
    Chat.findById.mockReturnValue({
      select: jest
        .fn()
        .mockResolvedValue({ _id: CHAT_ID, clientId: OWNER_ID, providerId: APPLICANT_ID, orderId }),
    });
    Chat.findByIdAndDelete = jest.fn().mockResolvedValue({});
    Chat.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });

    const res = {
      ...makeRes(),
      end() {
        return this;
      },
    };
    await chatController.deleteChat(
      { user: { id: String(APPLICANT_ID) }, params: { chatId: String(CHAT_ID) } },
      res
    );

    expect(res.statusCode).toBe(204);
    expect(Chat.findByIdAndDelete).not.toHaveBeenCalled();
    expect(Chat.updateOne).toHaveBeenCalledWith(
      { _id: String(CHAT_ID) },
      { $addToSet: { deletedFor: String(APPLICANT_ID) } }
    );
  });

  it('still refuses an outsider', async () => {
    Chat.findById.mockReturnValue({
      select: jest
        .fn()
        .mockResolvedValue({ _id: CHAT_ID, clientId: OWNER_ID, providerId: APPLICANT_ID }),
    });
    Chat.updateOne = jest.fn();
    const res = makeRes();
    await chatController.deleteChat(
      { user: { id: String(new mongoose.Types.ObjectId()) }, params: { chatId: String(CHAT_ID) } },
      res
    );
    expect(res.statusCode).toBe(403);
    expect(Chat.updateOne).not.toHaveBeenCalled();
  });
});
