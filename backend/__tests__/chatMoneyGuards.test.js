/**
 * Guards on the two chat endpoints that touch money, plus message hygiene.
 *
 * The price and the payment button both sit inside the conversation, and both were
 * open in ways that let the wrong person act, or let the agreed number drift away
 * from the order the escrow is calculated from.
 */

jest.mock('../models/ChatMessage', () => ({
  findById: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findByIdAndDelete: jest.fn(),
  updateOne: jest.fn(),
}));
jest.mock('../models/Order', () => {
  const Order = jest.fn(function (doc) {
    Object.assign(this, doc);
    this.save = jest.fn().mockResolvedValue(this);
  });
  Order.findOne = jest.fn();
  Order.findById = jest.fn();
  Order.findByIdAndUpdate = jest.fn();
  return Order;
});
jest.mock('../models/User', () => ({ findById: jest.fn(), exists: jest.fn() }));
jest.mock('../models/Service', () => ({ findById: jest.fn(), findByIdAndUpdate: jest.fn(), updateOne: jest.fn() }));
jest.mock('../models/JobRequest', () => ({ findOne: jest.fn() }));
jest.mock('../models/Dispute', () => ({ findOne: jest.fn() }));
jest.mock('../models/ChatReport', () => ({ findOne: jest.fn() }));
jest.mock('../controllers/SafePayCheckoutController', () => ({
  createSafePaySession: jest.fn(),
}));
jest.mock('../services/subscriptions/v2Entitlements', () => ({
  enabled: jest.fn(() => false),
  consumeApplicationContact: jest.fn(),
  V2EntitlementError: class V2EntitlementError extends Error {},
}));

const mongoose = require('mongoose');
const Chat = require('../models/ChatMessage');
const User = require('../models/User');
const Service = require('../models/Service');
const JobRequest = require('../models/JobRequest');
const { createSafePaySession } = require('../controllers/SafePayCheckoutController');
const {
  enabled,
  consumeApplicationContact,
} = require('../services/subscriptions/v2Entitlements');
const chatController = require('../controllers/chatController');

const OWNER = new mongoose.Types.ObjectId();
const WORKER = new mongoose.Types.ObjectId();
const SERVICE = new mongoose.Types.ObjectId();
const CHAT = new mongoose.Types.ObjectId();
const ORDER = new mongoose.Types.ObjectId();

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
  };
}

function populateChain(value) {
  const chain = {};
  chain.populate = jest.fn(() => chain);
  chain.then = (resolve, reject) => Promise.resolve(value).then(resolve, reject);
  chain.catch = (reject) => Promise.resolve(value).catch(reject);
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
  enabled.mockReturnValue(true);
  User.exists.mockResolvedValue(null);
});

describe('updateAgreedPrice', () => {
  function chatDoc(overrides = {}) {
    return {
      _id: CHAT,
      clientId: WORKER,
      providerId: OWNER,
      orderId: null,
      status: 'requested',
      serviceId: { _id: SERVICE, userId: OWNER },
      messages: [],
      save: jest.fn().mockResolvedValue(),
      ...overrides,
    };
  }

  it('refuses to change the price once a contract exists', async () => {
    // The escrow amount comes from the order; the payment endpoint prefers the chat
    // value. Letting these diverge meant agreeing 5000, setting the chat to 3, paying
    // 3 kr, and still having the 5000 kr order marked fully paid.
    Chat.findById.mockReturnValue(populateChain(chatDoc({ orderId: ORDER })));
    require('../models/Order').findById.mockReturnValue({ select: () => ({ lean: async () => ({ status: 'awaiting_payment' }) }) });

    const res = makeRes();
    await chatController.updateAgreedPrice(
      { user: { id: String(OWNER) }, params: { chatId: String(CHAT) }, body: { agreedPrice: 3 } },
      res
    );

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('price_locked_by_contract');
  });

  it.each([
    ['zero', 0],
    ['negative', -100],
    ['not a number', 'gratis'],
    ['infinite', Infinity],
    ['decimal (P3)', 1200.5],
  ])('rejects %s', async (_label, agreedPrice) => {
    Chat.findById.mockReturnValue(populateChain(chatDoc()));

    const res = makeRes();
    await chatController.updateAgreedPrice(
      { user: { id: String(OWNER) }, params: { chatId: String(CHAT) }, body: { agreedPrice } },
      res
    );

    expect(res.statusCode).toBe(400);
  });

  it('rejects a price above the ceiling that would overflow Stripe', async () => {
    Chat.findById.mockReturnValue(populateChain(chatDoc()));

    const res = makeRes();
    await chatController.updateAgreedPrice(
      {
        user: { id: String(OWNER) },
        params: { chatId: String(CHAT) },
        body: { agreedPrice: 1e12 },
      },
      res
    );

    expect(res.statusCode).toBe(400);
  });

  it('does not drag a live job back to "agreed"', async () => {
    const chat = chatDoc({ status: 'in_progress' });
    Chat.findById.mockReturnValue(populateChain(chat));
    Chat.findById.mockReturnValueOnce(populateChain(chat));

    await chatController.updateAgreedPrice(
      {
        user: { id: String(OWNER) },
        params: { chatId: String(CHAT) },
        body: { agreedPrice: 1200 },
      },
      makeRes()
    );

    expect(chat.status).toBe('in_progress');
    expect(chat.agreedPrice).toBe(1200);
  });

  it('refuses the worker setting the price the owner will pay (P3)', async () => {
    const chat = chatDoc();
    Chat.findById.mockReturnValue(populateChain(chat));

    const res = makeRes();
    await chatController.updateAgreedPrice(
      { user: { id: String(WORKER) }, params: { chatId: String(CHAT) }, body: { agreedPrice: 90000 } },
      res
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('price_owner_only');
    expect(chat.save).not.toHaveBeenCalled();
  });

  it('refuses a non-participant', async () => {
    Chat.findById.mockReturnValue(populateChain(chatDoc()));

    const res = makeRes();
    await chatController.updateAgreedPrice(
      {
        user: { id: String(new mongoose.Types.ObjectId()) },
        params: { chatId: String(CHAT) },
        body: { agreedPrice: 500 },
      },
      res
    );

    expect(res.statusCode).toBe(403);
  });

  // S6: price and contract steps post system messages into the chat, and skipped the block list.
  it('refuses a blocked pair (S6)', async () => {
    const chat = chatDoc();
    Chat.findById.mockReturnValue(populateChain(chat));
    User.exists.mockResolvedValueOnce({ _id: WORKER });

    const res = makeRes();
    await chatController.updateAgreedPrice(
      { user: { id: String(OWNER) }, params: { chatId: String(CHAT) }, body: { agreedPrice: 500 } },
      res
    );

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('user_blocked');
    expect(chat.save).not.toHaveBeenCalled();
  });

  it('shares the chat send limit, so repeated changes cannot grow the document without bound (S6)', async () => {
    const chatId = String(new mongoose.Types.ObjectId());
    const chat = chatDoc({ _id: chatId });
    Chat.findById.mockReturnValue(populateChain(chat));

    let res;
    for (let i = 1; i <= 31; i++) {
      res = makeRes();
      await chatController.updateAgreedPrice({ user: { id: String(OWNER) }, params: { chatId }, body: { agreedPrice: i } }, res);
    }

    expect(res.statusCode).toBe(429);
    expect(chat.save).toHaveBeenCalledTimes(30);
  });

  it('createContract refuses a blocked pair (S6)', async () => {
    const chat = chatDoc({ serviceId: { _id: SERVICE, userId: OWNER, price: 1000, checklist: [] } });
    Chat.findById.mockReturnValue(populateChain(chat));
    User.exists.mockResolvedValueOnce({ _id: WORKER });

    const res = makeRes();
    await chatController.createContract({ user: { id: String(OWNER) }, params: { chatId: String(CHAT) }, body: {} }, res);

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('user_blocked');
    expect(require('../models/Order')).not.toHaveBeenCalled();
  });
});

describe('createPaymentSession', () => {
  function chatWithOrder(order) {
    return {
      _id: CHAT,
      clientId: { _id: WORKER },
      providerId: { _id: OWNER },
      serviceId: { _id: SERVICE, title: 'Maling', price: 1000 },
      orderId: order,
      agreedPrice: 1000,
    };
  }

  beforeEach(() => {
    createSafePaySession.mockImplementation(async (_req, res) =>
      res.json({ url: 'https://checkout.stripe.com/canonical' })
    );
  });

  it('delegates to SafePay with the chat order and authenticated request context', async () => {
    const chat = chatWithOrder({ _id: ORDER });
    Chat.findById.mockReturnValue(populateChain(chat));
    const req = {
      user: { id: String(OWNER) },
      userId: String(OWNER),
      params: { chatId: String(CHAT) },
      body: { orderId: String(new mongoose.Types.ObjectId()), platform: 'mobile' },
    };

    const res = makeRes();
    await chatController.createPaymentSession(req, res);

    expect(createSafePaySession).toHaveBeenCalledWith(req, res);
    expect(req.body).toEqual({ orderId: String(ORDER) });
    expect(req.userId).toBe(String(OWNER));
    expect(res.body.url).toBe('https://checkout.stripe.com/canonical');
  });

  it('refuses a non-participant before delegating to SafePay', async () => {
    Chat.findById.mockReturnValue(populateChain(chatWithOrder({ _id: ORDER })));
    const res = makeRes();
    await chatController.createPaymentSession(
      {
        user: { id: String(new mongoose.Types.ObjectId()) },
        params: { chatId: String(CHAT) },
      },
      res
    );

    expect(res.statusCode).toBe(403);
    expect(createSafePaySession).not.toHaveBeenCalled();
  });
});

describe('sendMessage hygiene', () => {
  function chatDoc() {
    return {
      _id: CHAT,
      clientId: { _id: WORKER, toString: () => String(WORKER) },
      providerId: { _id: OWNER, toString: () => String(OWNER) },
      messages: [],
      deletedFor: [String(OWNER)],
      save: jest.fn().mockResolvedValue(),
    };
  }

  /** findById(...).select(...) reads it; the atomic updateOne appends to it. */
  function storeChat(chat) {
    Chat.findById.mockReturnValue(Object.assign(Promise.resolve(chat), { select: () => Promise.resolve(chat) }));
    Chat.updateOne.mockImplementation(async (_filter, update) => {
      chat.messages.push(update.$push.messages);
      Object.assign(chat, update.$set);
      return { modifiedCount: 1 };
    });
  }
  const send = (userId, text, chatId = CHAT) => {
    const res = makeRes();
    return chatController
      .sendMessage({ user: { id: String(userId) }, params: { chatId: String(chatId) }, body: { text }, app: { get: () => null } }, res)
      .then(() => res);
  };

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace only', '   '],
  ])('rejects a %s message instead of storing undefined', async (_label, text) => {
    storeChat(chatDoc());

    const res = makeRes();
    await chatController.sendMessage(
      { user: { id: String(OWNER) }, params: { chatId: String(CHAT) }, body: { text }, app: { get: () => null } },
      res
    );

    expect(res.statusCode).toBe(400);
  });

  it('rejects an oversized message that could push the document past the 16 MB limit', async () => {
    storeChat(chatDoc());

    const res = makeRes();
    await chatController.sendMessage(
      {
        user: { id: String(OWNER) },
        params: { chatId: String(CHAT) },
        body: { text: 'a'.repeat(50000) },
        app: { get: () => null },
      },
      res
    );

    expect(res.statusCode).toBe(400);
  });

  it('un-hides the conversation for someone who had deleted it', async () => {
    const chat = chatDoc();
    storeChat(chat);

    await chatController.sendMessage(
      {
        user: { id: String(WORKER) },
        params: { chatId: String(CHAT) },
        body: { text: 'Hei, er du der?' },
        app: { get: () => null },
      },
      makeRes()
    );

    // Otherwise the reply lands in an inbox the recipient can no longer see, forever.
    expect(chat.deletedFor).toEqual([]);
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0].text).toBe('Hei, er du der?');
  });

  it('sends the first and subsequent messages without consuming contacts', async () => {
    const chat = {
      ...chatDoc(),
      serviceId: SERVICE,
      orderId: ORDER,
    };
    storeChat(chat);

    for (let i = 0; i < 20; i += 1) {
      const res = makeRes();
      await chatController.sendMessage({
        user: { id: String(OWNER) },
        params: { chatId: String(CHAT) },
        body: { text: `Progress update ${i}` },
        app: { get: () => null },
      }, res);
      expect(res.statusCode).toBe(201);
    }

    expect(chat.messages).toHaveLength(20);
    expect(Chat.updateOne).toHaveBeenCalledTimes(20);
    expect(consumeApplicationContact).not.toHaveBeenCalled();
  });

  it('does not consume a contact when chat persistence fails or when the message is retried', async () => {
    const chat = chatDoc();
    storeChat(chat);
    Chat.updateOne.mockRejectedValueOnce(new Error('chat write failed'));

    const failed = makeRes();
    await chatController.sendMessage({
      user: { id: String(OWNER) },
      params: { chatId: String(CHAT) },
      body: { text: 'Retry me' },
      app: { get: () => null },
    }, failed);
    expect(failed.statusCode).toBe(500);

    const retried = makeRes();
    await chatController.sendMessage({
      user: { id: String(OWNER) },
      params: { chatId: String(CHAT) },
      body: { text: 'Retry me' },
      app: { get: () => null },
    }, retried);
    expect(retried.statusCode).toBe(201);
    expect(consumeApplicationContact).not.toHaveBeenCalled();
  });

  it('M4: refuses a message when either side has blocked the other', async () => {
    storeChat(chatDoc());
    User.exists.mockResolvedValue({ _id: OWNER });
    const res = await send(WORKER, 'hei');
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('user_blocked');
    expect(Chat.updateOne).not.toHaveBeenCalled();
  });

  it('M7: appends only while the document is under the size cap, and says so when full', async () => {
    storeChat(chatDoc());
    Chat.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });
    const res = await send(WORKER, 'hei');
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('chat_full');
    expect(Chat.updateOne.mock.calls[0][0].$expr).toEqual({ $lt: [{ $bsonSize: '$$ROOT' }, 15 * 1024 * 1024] });
  });

  it('M7: limits how fast one user can send into one chat', async () => {
    const chatId = new mongoose.Types.ObjectId(); // own counter key
    storeChat({ ...chatDoc(), _id: chatId });
    for (let i = 0; i < 30; i += 1) expect((await send(WORKER, `m${i}`, chatId)).statusCode).toBe(201);
    const limited = await send(WORKER, 'one too many', chatId);
    expect(limited.statusCode).toBe(429);
    expect((await send(OWNER, 'the other side still can', chatId)).statusCode).toBe(201);
  });
});

describe('createOrGetChat usage accounting', () => {
  it('M4: refuses to open a chat between users when one has blocked the other', async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: WORKER, name: 'Worker' }) });
    User.exists.mockResolvedValue({ _id: WORKER });
    const res = makeRes();
    await chatController.createOrGetChat({
      user: { id: String(OWNER) },
      body: { providerId: String(WORKER), serviceId: String(SERVICE) },
    }, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('user_blocked');
    expect(Chat.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('opens or creates a chat without consuming an included contact', async () => {
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: WORKER, name: 'Worker' }),
    });
    Service.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: SERVICE, userId: OWNER }),
    });
    JobRequest.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: new mongoose.Types.ObjectId() }),
    });
    Chat.findOneAndUpdate.mockResolvedValue({
      lastErrorObject: { updatedExisting: true },
      value: { _id: CHAT },
    });
    Chat.findById.mockReturnValue(populateChain({ _id: CHAT }));

    const res = makeRes();
    await chatController.createOrGetChat({
      user: { id: String(OWNER) },
      body: { providerId: String(WORKER), serviceId: String(SERVICE) },
    }, res);

    expect(res.body).toEqual({ _id: CHAT });
    expect(consumeApplicationContact).not.toHaveBeenCalled();
  });
});

describe('deleteForMe authorization', () => {
  it('refuses a stranger appending themselves to a chat they are not in', async () => {
    Chat.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: CHAT, clientId: WORKER, providerId: OWNER }),
    });

    const res = makeRes();
    await chatController.deleteForMe(
      { user: { id: String(new mongoose.Types.ObjectId()) }, params: { chatId: String(CHAT) } },
      res
    );

    expect(res.statusCode).toBe(403);
    expect(Chat.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('lets a participant hide their own copy', async () => {
    Chat.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: CHAT, clientId: WORKER, providerId: OWNER }),
    });
    Chat.findByIdAndUpdate.mockResolvedValue({});

    const res = makeRes();
    await chatController.deleteForMe(
      { user: { id: String(OWNER) }, params: { chatId: String(CHAT) } },
      res
    );

    expect(res.body.success).toBe(true);
    expect(Chat.findByIdAndUpdate).toHaveBeenCalled();
  });
});
