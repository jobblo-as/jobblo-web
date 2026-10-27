/**
 * M5(b): ending a session disconnects its sockets. M6/M4/M2: order-message authorization,
 * client-sent system types, block list and bounded lists.
 * No database: the Session hook runs on the real model with the driver call stubbed.
 */
jest.mock('../models/Message', () => ({
  find: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  updateMany: jest.fn(),
  updateOne: jest.fn(),
  findByIdAndDelete: jest.fn(),
}));
jest.mock('../models/PushToken', () => ({ updateMany: jest.fn(async () => ({})) }));
jest.mock('../models/Order', () => ({ find: jest.fn(), findById: jest.fn() }));
jest.mock('../models/User', () => ({ findById: jest.fn(), exists: jest.fn(async () => null) }));

const mongoose = require('mongoose');
const Session = require('../models/Session');
const Message = require('../models/Message');
const Order = require('../models/Order');
const User = require('../models/User');
const { setIO } = require('../sockets/io');
const { joinUserRooms } = require('../sockets/rooms');
const messageController = require('../controllers/messageController');
const PushToken = require('../models/PushToken');

const CUSTOMER = String(new mongoose.Types.ObjectId());
const PROVIDER = String(new mongoose.Types.ObjectId());
const OUTSIDER = String(new mongoose.Types.ObjectId());
const ORDER = String(new mongoose.Types.ObjectId());

const res = () => ({
  statusCode: 200,
  status(c) {
    this.statusCode = c;
    return this;
  },
  json(b) {
    this.body = b;
    return this;
  },
});
const select = (v) => ({ select: async () => v, then: (r, j) => Promise.resolve(v).then(r, j) });

describe('M5(b) ending a session disconnects its sockets', () => {
  const S1 = new mongoose.Types.ObjectId();
  const S2 = new mongoose.Types.ObjectId();
  let rooms;
  let localRooms;
  beforeEach(() => {
    rooms = null;
    localRooms = null;
    // io.in() on the redis adapter only publishes; io.local.in() acts on this instance.
    setIO({
      in: (r) => ({
        disconnectSockets: () => {
          rooms = r;
        },
      }),
      local: {
        in: (r) => ({
          disconnectSockets: () => {
            localRooms = r;
          },
        }),
      },
    });
    jest.spyOn(Session, 'find').mockReturnValue({
      select: () => ({
        lean: () => ({
          limit() {
            return this;
          },
          then: (r) => r([{ _id: S1 }, { _id: S2 }]),
        }),
      }),
    });
    jest
      .spyOn(Session.collection, 'deleteMany')
      .mockResolvedValue({ acknowledged: true, deletedCount: 2 });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    setIO(null);
  });

  it('deleteMany (logout everywhere, password reset, deactivation, revocation) disconnects those sessions', async () => {
    await Session.deleteMany({ userId: CUSTOMER });
    expect(rooms).toEqual([`session_${S1}`, `session_${S2}`]);
  });

  it('S2: also disconnects the sockets on this instance directly (Redis down: the relay never comes back)', async () => {
    await Session.deleteMany({ userId: CUSTOMER });
    expect(localRooms).toEqual([`session_${S1}`, `session_${S2}`]);
  });

  it('P1: switches off the push tokens of every ended session', async () => {
    await Session.deleteMany({ userId: CUSTOMER });
    expect(PushToken.updateMany).toHaveBeenCalledWith(
      { sessionId: { $in: [S1, S2] } },
      { $set: { active: false } }
    );
  });

  it('a socket is put in its session room on connect', () => {
    const socket = { userId: CUSTOMER, sessionId: String(S1), join: jest.fn() };
    joinUserRooms(socket);
    expect(socket.join).toHaveBeenCalledWith(`session_${S1}`);
  });
});

describe('M6/M4 order messages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Order.findById.mockReturnValue(
      select({ _id: ORDER, customerId: CUSTOMER, providerId: PROVIDER })
    );
  });

  it('refuses an outsider marking an order message read', async () => {
    const message = { _id: 'm1', orderId: ORDER, readReceipts: [], save: jest.fn() };
    Message.findById.mockResolvedValue(message);
    const r = res();
    await messageController.markAsRead(
      { userId: OUTSIDER, params: { id: String(new mongoose.Types.ObjectId()) } },
      r
    );
    expect(r.statusCode).toBe(403);
    expect(message.save).not.toHaveBeenCalled();
  });

  // S11: no client posted here (web and app use the chat API); it took any content and
  // unlimited image URLs. The route and handler are gone.
  it('S11: POST /api/messages no longer exists', () => {
    const router = require('../routes/messages');
    expect(router.stack.some((l) => l.route?.path === '/' && l.route.methods.post)).toBe(false);
    expect(messageController.createMessage).toBeUndefined();
  });

  it('Z3: deleting your own order message hides it for you, never deletes the evidence', async () => {
    Message.findById.mockResolvedValue({ _id: 'm1', senderId: CUSTOMER });
    const r = {
      ...res(),
      end() {
        return this;
      },
    };
    const id = String(new mongoose.Types.ObjectId());
    await messageController.deleteMessage({ userId: CUSTOMER, params: { id } }, r);
    expect(r.statusCode).toBe(204);
    expect(Message.findByIdAndDelete).not.toHaveBeenCalled();
    expect(Message.updateOne).toHaveBeenCalledWith(
      { _id: id },
      { $addToSet: { deletedFor: CUSTOMER } }
    );
  });

  it('M2: caps the order thread and keeps the array response', async () => {
    const chain = {
      sort: jest.fn(() => chain),
      skip: jest.fn(() => chain),
      limit: jest.fn(() => chain),
      populate: jest.fn(async () => [{ _id: 'm' }]),
    };
    Message.find.mockReturnValue(chain);
    const r = res();
    await messageController.getMessagesForOrder(
      { userId: CUSTOMER, params: { orderId: ORDER }, query: { limit: '100000' } },
      r
    );
    expect(chain.limit).toHaveBeenCalledWith(100);
    expect(Array.isArray(r.body)).toBe(true);
  });
});
