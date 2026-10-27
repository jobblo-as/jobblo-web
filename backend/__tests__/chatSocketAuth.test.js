const mongoose = require('mongoose');

jest.mock('../models/ChatMessage', () => ({
  findById: jest.fn(),
  updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
  find: jest.fn(() => mockChain([])),
}));
jest.mock('../models/User', () => ({ findById: jest.fn(), exists: jest.fn(async () => null), find: jest.fn(() => mockChain([])) }));
jest.mock('../models/Session', () => ({ findById: jest.fn(), exists: jest.fn(async () => ({ _id: 's' })) }));
jest.mock('../utils/tokenUtils', () => ({ verifyToken: jest.fn() }));
/** A query whose select/sort/limit chain resolves to `rows`. */
function mockChain(rows) {
  const q = { select: () => q, sort: () => q, limit: () => q, lean: async () => rows };
  return q;
}

const Chat = require('../models/ChatMessage');
const chatSocket = require('../sockets/chat.socket');

/**
 * Regression guard for F-50.
 *
 * The Socket.IO handshake is authenticated, but the event handlers were not: `join-chat`
 * put any authenticated socket into any chat room (so it received every message in a
 * conversation it had no part in), and `send-message` wrote into any conversation.
 * These tests pin membership checking against the authenticated `socket.userId`.
 */

const CLIENT = new mongoose.Types.ObjectId();
const PROVIDER = new mongoose.Types.ObjectId();
const OUTSIDER = new mongoose.Types.ObjectId();
const CHAT_ID = new mongoose.Types.ObjectId();

/** Boot the socket module and return a connected fake socket for `userId`. */
function connectAs(userId, extra = {}) {
  const handlers = {};
  const io = {
    use: jest.fn(),
    on: jest.fn((event, fn) => {
      if (event === 'connection') io._onConnection = fn;
    }),
    to: jest.fn(() => ({ emit: jest.fn() })),
    emit: jest.fn(),
  };

  chatSocket(io);

  const socket = {
    id: 'socket-1',
    userId: String(userId),
    on: jest.fn((event, fn) => {
      handlers[event] = fn;
    }),
    join: jest.fn(),
    leave: jest.fn(),
    use: jest.fn(),
    disconnect: jest.fn(),
    emit: jest.fn(),
    ...extra,
  };

  io._onConnection(socket);
  return { socket, handlers, io };
}

/** A chat between CLIENT and PROVIDER. */
function mockChat(extra = {}) {
  const chat = {
    _id: CHAT_ID,
    clientId: CLIENT,
    providerId: PROVIDER,
    messages: [],
    markModified: jest.fn(),
    save: jest.fn().mockResolvedValue(true),
    ...extra,
  };
  // join-chat uses .select(); send-message / mark-as-read await the query directly.
  Chat.findById.mockReturnValue(
    Object.assign(Promise.resolve(chat), { select: jest.fn().mockResolvedValue(chat) })
  );
  return chat;
}

describe('join-chat membership (F-50)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lets a participant join the chat room', async () => {
    mockChat();
    const { socket, handlers } = connectAs(CLIENT);
    socket.join.mockClear(); // ignore the personal-room join on connect

    await handlers['join-chat'](String(CHAT_ID));

    expect(socket.join).toHaveBeenCalledWith(`chat-${CHAT_ID}`);
  });

  it('refuses an outsider and does not join them to the room', async () => {
    mockChat();
    const { socket, handlers } = connectAs(OUTSIDER);
    socket.join.mockClear();

    await handlers['join-chat'](String(CHAT_ID));

    expect(socket.join).not.toHaveBeenCalledWith(`chat-${CHAT_ID}`);
    expect(socket.emit).toHaveBeenCalledWith(
      'chat-error',
      expect.objectContaining({ chatId: String(CHAT_ID) })
    );
  });
});

describe('send-message membership (F-50)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('appends a message from a participant', async () => {
    mockChat();
    const { handlers } = connectAs(PROVIDER);

    await handlers['send-message']({ chatId: String(CHAT_ID), text: 'hei' });

    expect(Chat.updateOne).toHaveBeenCalledTimes(1);
    expect(Chat.updateOne.mock.calls[0][1].$push.messages).toMatchObject({ text: 'hei', senderId: String(PROVIDER) });
  });

  // M5(c): the socket path skipped the HTTP route's checks and stored anything as text.
  it.each([
    ['too long', 'a'.repeat(5001)],
    ['not a string', { $gt: '' }],
    ['empty', '   '],
  ])('rejects a %s message like the HTTP route does', async (_label, text) => {
    mockChat();
    const { socket, handlers } = connectAs(PROVIDER);

    await handlers['send-message']({ chatId: String(CHAT_ID), text });

    expect(Chat.updateOne).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('chat-error', expect.objectContaining({ chatId: String(CHAT_ID) }));
  });

  it('M4: refuses a message when one side has blocked the other', async () => {
    mockChat();
    require('../models/User').exists.mockResolvedValueOnce({ _id: CLIENT });
    const { socket, handlers } = connectAs(PROVIDER);

    await handlers['send-message']({ chatId: String(CHAT_ID), text: 'hei' });

    expect(Chat.updateOne).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('chat-error', expect.objectContaining({ code: 'user_blocked' }));
  });

  it('refuses to inject a message from an outsider', async () => {
    const chat = mockChat();
    const { socket, handlers } = connectAs(OUTSIDER);

    await handlers['send-message']({ chatId: String(CHAT_ID), text: 'injected' });

    expect(chat.messages).toHaveLength(0);
    expect(Chat.updateOne).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('chat-error', expect.any(Object));
  });
});

describe('setup / mark-as-read use the authenticated id (F-50)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('setup ignores a client-supplied id and joins only the authenticated room', () => {
    const { socket, handlers } = connectAs(CLIENT);
    socket.join.mockClear();

    handlers['setup'](String(OUTSIDER)); // attacker passes a victim's id

    expect(socket.join).toHaveBeenCalledWith(String(CLIENT));
    expect(socket.join).not.toHaveBeenCalledWith(String(OUTSIDER));
  });

  it('mark-as-read ignores a client-supplied userId for an outsider', async () => {
    const chat = mockChat();
    const { handlers } = connectAs(OUTSIDER);

    await handlers['mark-as-read']({ chatId: String(CHAT_ID), userId: String(CLIENT) });

    expect(chat.save).not.toHaveBeenCalled();
  });
});

// M5(d): every client used to receive the ids of every online user.
describe('presence goes only to chat partners', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends a user only the online users they share a chat with', async () => {
    const STRANGER = new mongoose.Types.ObjectId();
    const PAIR_A = new mongoose.Types.ObjectId(); // fresh ids: earlier tests left CLIENT and PROVIDER online
    const PAIR_B = new mongoose.Types.ObjectId();
    Chat.find.mockImplementation((filter) => {
      const uid = String(filter.$or[0].clientId);
      return mockChain(uid === String(PAIR_A) || uid === String(PAIR_B) ? [{ clientId: PAIR_A, providerId: PAIR_B }] : []);
    });
    const emits = [];
    const io = {
      use: jest.fn(),
      on: jest.fn((event, fn) => { if (event === 'connection') io._onConnection = fn; }),
      to: jest.fn((room) => ({ emit: (event, data) => emits.push({ room, event, data }) })),
      emit: jest.fn(),
    };
    chatSocket(io);
    const connect = (userId, id) => io._onConnection({ id, userId: String(userId), on: jest.fn(), join: jest.fn(), use: jest.fn(), emit: jest.fn() });

    connect(STRANGER, 's1');
    connect(PAIR_A, 's2');
    connect(PAIR_B, 's3');
    await new Promise((r) => setImmediate(r));

    expect(io.emit).not.toHaveBeenCalled(); // no global broadcast
    const lastTo = (userId) => emits.filter((e) => e.room === String(userId) && e.event === 'get-online-users').at(-1)?.data;
    expect(lastTo(PAIR_A)).toEqual([String(PAIR_B)]);
    expect(lastTo(PAIR_B)).toEqual([String(PAIR_A)]);
    expect(lastTo(STRANGER)).toEqual([]);
  });
});

// Second review (S1-S13): handshake rules, per-socket limits, presence cost and lifetime.
describe('socket hardening', () => {
  const User = require('../models/User');
  const Session = require('../models/Session');
  const { verifyToken } = require('../utils/tokenUtils');
  const newId = () => new mongoose.Types.ObjectId();
  const tick = () => new Promise((r) => setImmediate(r));

  beforeEach(() => jest.clearAllMocks());

  /** Run the io.use handshake for `user`; resolves { err, socket }. */
  function handshake(user) {
    const io = { use: jest.fn(), on: jest.fn() };
    chatSocket(io);
    verifyToken.mockReturnValue({ id: String(user._id), sid: 'sid1', exp: 2e9 });
    Session.findById.mockResolvedValue({ userId: user._id, mfaVerifiedAt: new Date() });
    User.findById.mockReturnValue(mockChain(user));
    const socket = { handshake: { headers: {}, auth: { token: 't' } } };
    return new Promise((resolve) => io.use.mock.calls[0][0](socket, (err) => resolve({ err, socket })));
  }

  it('S4: refuses a deactivated or deleted account, like authenticate()', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect((await handshake({ _id: newId(), role: 'user', accountStatus: 'inactive' })).err).toBeInstanceOf(Error);
    expect((await handshake({ _id: newId(), role: 'user', isDeleted: true })).err).toBeInstanceOf(Error);
    const ok = await handshake({ _id: newId(), role: 'user', accountStatus: 'active' });
    expect(ok.err).toBeUndefined();
    expect(ok.socket.tokenExp).toBe(2e9);
    console.error.mockRestore();
  });

  it('S5: refuses an 11th socket for one user', async () => {
    const U = newId();
    for (let i = 0; i < 10; i++) connectAs(U, { id: `cap-${i}` });
    expect((await handshake({ _id: U, role: 'user' })).err?.message).toBe('Too many connections');
  });

  it('S5: only the first socket of a user loads partners and broadcasts presence', async () => {
    const U = newId();
    connectAs(U, { id: 'first' });
    await tick();
    connectAs(U, { id: 'second' });
    await tick();
    expect(Chat.find.mock.calls.filter(([f]) => String(f.$or[0].clientId) === String(U))).toHaveLength(1);
  });

  it('S7: presence is hidden between blocked users, both directions', async () => {
    const A = newId();
    const B = newId(); // A blocked B
    const C = newId(); // C blocked A
    connectAs(B, { id: 'b' });
    connectAs(C, { id: 'c' });
    await tick();
    Chat.find.mockImplementation((f) => mockChain(String(f.$or[0].clientId) === String(A) ? [{ clientId: A, providerId: B }, { clientId: C, providerId: A }] : []));
    User.find.mockImplementation((f) => mockChain(f.blockedUsers === String(A) ? [{ _id: C }] : []));
    const { io } = connectAs(A, { id: 'a', blockedUsers: [B] });
    await tick();
    const toA = io.to.mock.results.filter((r, i) => io.to.mock.calls[i][0] === String(A));
    expect(toA.at(-1).value.emit).toHaveBeenCalledWith('get-online-users', []);
    Chat.find.mockImplementation(() => mockChain([]));
    User.find.mockImplementation(() => mockChain([]));
  });

  it('S1: mark-as-read broadcasts only when something was unread', async () => {
    mockChat();
    const { handlers, io } = connectAs(CLIENT);
    Chat.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });
    await handlers['mark-as-read']({ chatId: String(CHAT_ID) });
    expect(io.to).not.toHaveBeenCalledWith(`chat-${CHAT_ID}`);
    await handlers['mark-as-read']({ chatId: String(CHAT_ID) });
    expect(io.to).toHaveBeenCalledWith(`chat-${CHAT_ID}`);
  });

  it('S1: a socket gets 20 events per 10 s; the rest are dropped', () => {
    const { socket } = connectAs(CLIENT);
    const limiter = socket.use.mock.calls[0][0];
    const next = jest.fn();
    for (let i = 0; i < 25; i++) limiter(['mark-as-read', {}], next);
    expect(next).toHaveBeenCalledTimes(20);
  });

  it('S3: the transport is closed when the access token expires, unless the socket left first', () => {
    jest.useFakeTimers();
    try {
      const exp = Math.floor(Date.now() / 1000) + 60;
      const live = connectAs(newId(), { id: 'exp-1', tokenExp: exp, conn: { close: jest.fn() } });
      const gone = connectAs(newId(), { id: 'exp-2', tokenExp: exp, conn: { close: jest.fn() } });
      gone.handlers.disconnect('client namespace disconnect');
      jest.advanceTimersByTime(59 * 1000);
      expect(live.socket.conn.close).not.toHaveBeenCalled();
      jest.advanceTimersByTime(2 * 1000);
      expect(live.socket.conn.close).toHaveBeenCalled();
      expect(gone.socket.conn.close).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('S3: a session ended between handshake and room join still drops the socket', async () => {
    Session.exists.mockResolvedValueOnce(null);
    const { socket } = connectAs(newId(), { id: 'race', sessionId: 'sid-race' });
    expect(socket.join).toHaveBeenCalledWith('session_sid-race'); // joined before the re-check
    await tick();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('S8: object chat ids never reach a query', async () => {
    mockChat();
    const { handlers } = connectAs(CLIENT);
    await handlers['join-chat']({ $ne: null });
    await handlers['mark-as-read']({ chatId: { $ne: null } });
    expect(Chat.findById).not.toHaveBeenCalled();
    expect(Chat.updateOne).not.toHaveBeenCalled();
  });

  it('S13: leave-chat leaves the room', () => {
    const { socket, handlers } = connectAs(CLIENT);
    handlers['leave-chat'](String(CHAT_ID));
    expect(socket.leave).toHaveBeenCalledWith(`chat-${CHAT_ID}`);
  });
});
