const cookie = require('cookie');
const mongoose = require('mongoose');
const { verifyToken } = require('../utils/tokenUtils');
const { joinUserRooms } = require('./rooms');

const onlineUsers = new Map(); // userId -> Set of socketIds
const partnersOf = new Map(); // online userId -> Set of user ids they share a chat with

/** Each socket costs a session lookup, a partner load and presence emits; tabs + phone fit easily. */
const MAX_SOCKETS_PER_USER = 10;
/** Events one socket may send per window; the excess is dropped (a flood used to fan out to the peer). */
const EVENT_LIMIT = { max: 20, windowMs: 10 * 1000 };
const MAX_PRESENCE_PARTNERS = 500;

/** Chat ids from clients: a string ObjectId, never an object handed to a query. */
const isChatId = (id) => typeof id === 'string' && mongoose.isValidObjectId(id);

/**
 * Presence goes only to chat partners: every client used to receive the id of every online
 * user. Each recipient gets its own list (the client replaces its list with the payload).
 * A block in either direction hides presence both ways.
 * ponytail: partners are loaded when the user's first socket connects, so a chat created (or a
 * block made) later counts after all their sockets reconnect; only the most recent
 * MAX_PRESENCE_PARTNERS chats count; onlineUsers is per instance (as before), so with several
 * instances a partner on another one shows offline and the socket cap is per instance.
 */
async function loadPartners(userId, blockedUsers = []) {
  const Chat = require('../models/ChatMessage');
  const chats = await Chat.find({ $or: [{ clientId: userId }, { providerId: userId }] })
    .select('clientId providerId')
    .sort({ updatedAt: -1 })
    .limit(MAX_PRESENCE_PARTNERS)
    .lean();
  const partners = new Set(
    chats.map((c) => String(String(c.clientId) === userId ? c.providerId : c.clientId))
  );
  for (const id of blockedUsers) partners.delete(String(id));
  if (partners.size) {
    const blockers = await require('../models/User')
      .find({ _id: { $in: [...partners] }, blockedUsers: userId })
      .select('_id')
      .lean();
    for (const u of blockers) partners.delete(String(u._id));
  }
  return partners;
}
const onlinePartners = (userId) =>
  [...(partnersOf.get(userId) || [])].filter((id) => onlineUsers.has(id));
function broadcastPresence(io, userId) {
  io.to(userId).emit('get-online-users', onlinePartners(userId));
  for (const partnerId of partnersOf.get(userId) || []) {
    if (partnersOf.has(partnerId))
      io.to(partnerId).emit('get-online-users', onlinePartners(partnerId));
  }
}

/**
 * (F-50) The handshake is authenticated, but the event handlers below were not:
 * `join-chat` would put any authenticated socket into any chat room, and
 * `send-message` would write into any conversation. Every chat event must therefore
 * check membership against the authenticated `socket.userId` — never a client payload.
 */
const isChatParticipant = (chat, userId) =>
  String(chat.clientId) === String(userId) || String(chat.providerId) === String(userId);

module.exports = (io) => {
  io.use(async (socket, next) => {
    try {
      const rawCookie = socket.handshake.headers.cookie;
      const cookies = rawCookie ? cookie.parse(rawCookie) : {};
      // The explicit token first: the app's native cookie jar can still hold a previous
      // user's cookie, and the token is who the client says it is now.
      const token = socket.handshake.auth?.token || cookies.accessToken || cookies.token;

      if (!token) {
        return next(new Error('No token found'));
      }

      // Same purpose check as authenticate(): a refresh token cannot open a socket.
      const decoded = verifyToken(token, 'access');

      // Verify session exists in DB
      const Session = require('../models/Session');
      const sessionExists = await Session.findById(decoded.sid);

      if (!sessionExists || sessionExists.userId.toString() !== decoded.id) {
        return next(new Error('Session expired or revoked'));
      }
      // Same account rule as authenticate(): a deactivated or deleted user gets no socket.
      const user = await require('../models/User')
        .findById(decoded.id)
        .select('role accountStatus isDeleted blockedUsers')
        .lean();
      if (!user || require('../middleware/auth').isInactiveAccount(user))
        return next(new Error('Account inactive'));
      // Same two-factor rule as authenticate(): no socket for an unverified admin session.
      if (!sessionExists.mfaVerifiedAt && require('../services/auth/mfa').requiresMfa(user)) {
        return next(new Error('Two-factor authentication required'));
      }
      if ((onlineUsers.get(String(decoded.id))?.size || 0) >= MAX_SOCKETS_PER_USER) {
        return next(new Error('Too many connections'));
      }

      socket.userId = String(decoded.id);
      socket.sessionId = decoded.sid;
      socket.tokenExp = decoded.exp;
      socket.blockedUsers = user.blockedUsers || [];

      next();
    } catch (err) {
      console.error('Socket Auth Error:', err.message);
      next(new Error('Socket auth failed'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);
    console.log(`✅ Auth user: ${socket.userId}`);

    // Session room first, then re-check the session: a logout that landed between the
    // handshake's lookup and this join found no socket to disconnect, and the socket lived on.
    joinUserRooms(socket);
    if (socket.sessionId) {
      require('../models/Session')
        .exists({ _id: socket.sessionId })
        .then((alive) => alive || socket.disconnect(true))
        .catch((err) => console.error('socket session re-check error:', err.message));
    }
    // The socket outlived its access token (and the session's TTL expiry, and a deactivation)
    // indefinitely. Drop the transport at the token's expiry: the client reconnects by itself
    // and the handshake checks its fresh token (an expired one is refused).
    let expiry = null;
    if (socket.tokenExp) {
      expiry = setTimeout(
        () => socket.conn?.close(),
        Math.max(0, socket.tokenExp * 1000 - Date.now())
      );
      expiry.unref?.();
    }

    // One fixed window per socket. Dropped events get no reply.
    let windowStart = Date.now();
    let events = 0;
    socket.use((_packet, next) => {
      if (Date.now() - windowStart > EVENT_LIMIT.windowMs) {
        windowStart = Date.now();
        events = 0;
      }
      if (++events <= EVENT_LIMIT.max) next();
    });

    // Track online user. Presence is loaded and broadcast for the user's first socket only;
    // every connect used to rerun the partner query and notify every partner.
    if (socket.userId) {
      const first = !onlineUsers.has(socket.userId);
      if (first) onlineUsers.set(socket.userId, new Set());
      onlineUsers.get(socket.userId).add(socket.id);
      if (first) {
        loadPartners(socket.userId, socket.blockedUsers)
          .then((partners) => {
            if (!onlineUsers.has(socket.userId)) return; // left while loading
            partnersOf.set(socket.userId, partners);
            broadcastPresence(io, socket.userId);
          })
          .catch((err) => console.error('presence load error:', err.message));
      } else if (partnersOf.has(socket.userId)) {
        socket.emit('get-online-users', onlinePartners(socket.userId));
      }
    }

    // join personal room
    socket.join(socket.userId);

    // =========================
    // 💬 SETUP USER
    // =========================
    // The client used to pass its own id here, which let a socket join any user's
    // private room and fake their presence. The authenticated id is the only source.
    socket.on('setup', () => {
      const userId = socket.userId;
      if (!userId) return;
      socket.join(userId);
      if (!onlineUsers.has(userId)) {
        onlineUsers.set(userId, new Set());
      }
      onlineUsers.get(userId).add(socket.id);
      socket.emit('get-online-users', onlinePartners(userId));
    });

    // =========================
    // 💬 JOIN CHAT ROOM
    // =========================
    socket.on('join-chat', async (chatId) => {
      if (!isChatId(chatId)) return;
      try {
        const Chat = require('../models/ChatMessage');
        const chat = await Chat.findById(chatId).select('clientId providerId');
        if (!chat || !isChatParticipant(chat, socket.userId)) {
          // Without this, any authenticated user could join any chat room by id and
          // receive every `receive-message` broadcast in that conversation.
          return socket.emit('chat-error', { chatId, error: 'Ikke tilgang til denne samtalen.' });
        }
        socket.join(`chat-${chatId}`);
      } catch (err) {
        console.error('join-chat error:', err.message);
      }
    });

    // The web client leaves the conversation it closes; without this it kept receiving it.
    socket.on('leave-chat', (chatId) => {
      if (isChatId(chatId)) socket.leave(`chat-${chatId}`);
    });

    // =========================
    // 👁️ MARK AS READ (Real-time read status)
    // =========================
    // Destructuring in the parameter list ran before the try: an emit with no payload made
    // the handler reject, and an unhandled rejection exits Node — one emit crashed the API.
    socket.on('mark-as-read', async (payload) => {
      const chatId = payload?.chatId;
      if (!isChatId(chatId)) return;
      try {
        // `userId` used to come from the client payload, making read receipts
        // spoofable for any user. Use the authenticated id only.
        const userId = socket.userId;
        const Chat = require('../models/ChatMessage');
        const chat = await Chat.findById(chatId).select('clientId providerId');
        if (!chat || !isChatParticipant(chat, userId)) return;

        // This used to load the document, push into every message's seenBy, call
        // markModified('messages') and save — which writes the ENTIRE messages array
        // with $set. The client emits mark-as-read on mount and on every inbound
        // message, so if the counterparty's send-message committed between the read
        // and the save, that message was overwritten out of existence: no error, the
        // sender's UI showed it delivered, and it was gone from dispute evidence too.
        //
        // A positional-filtered $addToSet touches only the seenBy arrays, so a
        // concurrent $push of a new message cannot be clobbered.
        const { modifiedCount } = await Chat.updateOne(
          { _id: chatId },
          { $addToSet: { 'messages.$[unseen].seenBy': userId } },
          { arrayFilters: [{ 'unseen.seenBy': { $ne: userId } }] }
        );

        // Notify ALL users in the chat room (including sender) — only when something was
        // unread: every no-op emit made the other side refetch, so a loop of them pushed
        // the victim's client into the per-IP 429.
        if (modifiedCount > 0) io.to(`chat-${chatId}`).emit('messages-read', { chatId, userId });
      } catch (err) {
        console.error('Mark as read error:', err.message);
      }
    });

    // =========================
    // ✉️ SEND MESSAGE
    // =========================
    socket.on('send-message', async (payload) => {
      const chatId = payload?.chatId;
      try {
        // The HTTP route's path: membership, type and length checks, block list, send
        // limit and the document-size cap. This handler used to write `text` unchecked.
        const { postChatMessage } = require('../controllers/chatController');
        const result = await postChatMessage({
          chatId,
          userId: socket.userId,
          text: payload?.text,
        });
        if (result.error)
          return socket.emit('chat-error', { chatId, error: result.error, code: result.code });

        io.to(`chat-${chatId}`).emit('receive-message', { chatId, message: result.message });
      } catch (err) {
        console.error('Send message error:', err.message);
      }
    });

    // =========================
    // ❌ DISCONNECT
    // =========================
    socket.on('disconnect', (reason) => {
      clearTimeout(expiry);
      if (socket.userId && onlineUsers.has(socket.userId)) {
        const sockets = onlineUsers.get(socket.userId);
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(socket.userId);
          broadcastPresence(io, socket.userId);
          partnersOf.delete(socket.userId);
        }
      }
      console.log(`❌ Socket disconnected: ${socket.id} | user=${socket.userId} | ${reason}`);
    });
  });
};

// Online users connected to THIS instance (Realtime Chat Monitor).
module.exports.onlineCount = () => onlineUsers.size;
