const User = require('../models/User');
const { ensureProviderConnectReady } = require('../middleware/requireProviderConnect');
const { acquireServiceContractLock } = require('../services/order/contractLock');
const { liveContractOrderId } = require('../services/order/releaseListing');
const Chat = require('../models/ChatMessage');
const Order = require('../models/Order');
const Service = require('../models/Service');
const JobRequest = require('../models/JobRequest');
const mongoose = require('mongoose');
const { notify } = require('../services/notifications');
const { identityVerificationSummary } = require('../utils/userProjections');
const { serverError } = require('../utils/serverError');
const { parsePagination } = require('../utils/pagination');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

/** Ceiling for a negotiated price. Stripe rejects unit_amount above ~1e8 øre. */
const MAX_AGREED_PRICE = 1000000;

/** Longest single chat message. Guards the 16 MB per-document limit — see sendMessage. */
const MAX_MESSAGE_LENGTH = 5000;
exports.MAX_MESSAGE_LENGTH = MAX_MESSAGE_LENGTH;

/** Ceiling on how many messages one request may pull from a thread. */
const MAX_MESSAGE_PAGE = 200;

exports.createOrGetChat = async (req, res) => {
  try {
    const { providerId, serviceId } = req.body;
    let { id } = req.user;

    if (!serviceId) {
      return res.status(400).json({ message: 'Service ID is required.' });
    }

    // Unvalidated ids reached findById and threw a CastError → 500 instead of 400.
    if (!isValidId(serviceId) || !isValidId(providerId)) {
      return res.status(400).json({ message: 'Invalid ID format.' });
    }

    if (id === providerId) {
      return res.status(400).json({ message: 'You cannot create a chat with yourself.' });
    }

    const provider = await User.findById(providerId).select('role name');
    if (!provider) {
      return res.status(404).json({ message: 'Provider not found.' });
    }
    if (await isBlockedBetween(id, providerId)) {
      return res.status(BLOCKED.status).json({ message: BLOCKED.error, code: BLOCKED.code });
    }

    // Both people must have a real relationship to this job.
    //
    // The only checks here used to be "not yourself" and "the other user exists" —
    // nothing tied either party to the service. Any authenticated user could therefore
    // open a conversation with any other user by supplying a scraped user id and any
    // service id, and it arrived in the victim's inbox looking like a legitimate job
    // conversation. That is a direct spam and harassment channel, and it also let a
    // stranger seed a chat they could later try to create a contract from.
    //
    // A conversation about a job is between its owner and someone who applied to it.
    const service = await Service.findById(serviceId).select('userId');
    if (!service) {
      return res.status(404).json({ message: 'Service not found.' });
    }

    const ownerId = String(service.userId);
    const callerIsOwner = ownerId === String(id);
    const targetIsOwner = ownerId === String(providerId);

    if (!callerIsOwner && !targetIsOwner) {
      return res.status(403).json({
        message: 'Du kan bare starte en samtale om et oppdrag du eier eller har søkt på.',
        code: 'not_related_to_service',
      });
    }

    // The non-owner side must actually have applied.
    const applicantId = callerIsOwner ? providerId : id;
    const application = await JobRequest.findOne({
      serviceId,
      customerId: applicantId, // JobRequest.customerId is the applicant
    }).select('_id');

    if (!application) {
      return res.status(403).json({
        message: 'Det finnes ingen søknad som knytter dere til dette oppdraget.',
        code: 'no_application_between_parties',
      });
    }

    // Direction-agnostic: match the PAIR, not the slots.
    //
    // Applying to a job creates the chat as { clientId: applicant, providerId: owner }
    // (orderController.createJobRequest). When the owner then pressed "Send melding"
    // this looked for { clientId: owner, providerId: applicant } — the same two people
    // the other way round — found nothing, and created a SECOND conversation for the
    // same pair and the same job. The duplicate also put the owner in the clientId
    // slot, which every role-aware view reads as "the applicant", so the owner
    // appeared to have applied to their own listing.
    const pairFilter = {
      serviceId,
      $or: [
        { clientId: id, providerId },
        { clientId: providerId, providerId: id },
      ],
    };

    // One atomic operation rather than find-then-create.
    //
    // Reading first and inserting afterwards is a check-then-act race: two requests for the
    // same pair — a double-clicked button, or the applicant and the owner opening the
    // conversation at the same moment — both read "no chat here" before either has written,
    // so both insert. `findOneAndUpdate ... upsert` collapses that into a single matched
    // write, and `$setOnInsert` means an existing conversation is never overwritten by the
    // second caller's slot order.
    //
    // `$pull` on the same call restores the thread for someone who had deleted it, which
    // used to be a second round trip.
    const result = await Chat.findOneAndUpdate(
      pairFilter,
      {
        $setOnInsert: { clientId: id, providerId, serviceId, messages: [] },
        $pull: { deletedFor: new mongoose.Types.ObjectId(id) },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        // Tells us whether this call created the conversation, so the status code stays
        // honest — the client distinguishes 200 from 201.
        includeResultMetadata: true,
      }
    );

    const created = !result.lastErrorObject?.updatedExisting;

    const chat = await Chat.findById(result.value._id)
      .populate('clientId', 'name')
      .populate('providerId', 'name')
      .populate('serviceId', 'title description images price categories userId')
      .populate('orderId');

    res.status(created ? 201 : 200).json(chat);
  } catch (error) {
    serverError(res, error);
  }
};

exports.getMyChats = async (req, res) => {
  try {
    const { id } = req.user;
    // Still a plain array (both clients read one); the newest 100 unless ?page/?limit ask.
    const { skip, limit } = parsePagination(req.query, { defaultLimit: 100 });

    // The inbox needs the last message, not every message ever sent.
    //
    // This returned each chat's FULL history, and the client invalidates the chats
    // query on every inbound message and every read receipt — so a user with a few
    // long-running conversations re-downloaded the entire corpus on each event. The
    // unread indicator only ever inspects the most recent message, so `$slice: -1`
    // gives the UI exactly what it reads.
    const chats = await Chat.find({
      $or: [{ clientId: id }, { providerId: id }],
      deletedFor: { $ne: id },
    })
      .select({ messages: { $slice: -1 } })
      .populate('clientId', 'name role avatarUrl')
      .populate('providerId', 'name role avatarUrl')
      .populate('serviceId', 'title description images price categories userId')
      .populate('orderId')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json(chats);
  } catch (error) {
    serverError(res, error);
  }
};

exports.getChatById = async (req, res) => {
  try {
    const { id } = req.user;
    const { chatId } = req.params;

    if (!isValidId(chatId)) return res.status(400).json({ error: 'Invalid chat ID format' });

    // Paginate the thread. It used to return every message with each sender populated,
    // so a long-running job's conversation grew into a large response on every open —
    // and the client refetches this whenever a message or read receipt arrives.
    //
    // `offset` counts backwards from the newest message, so offset=0 is the most recent
    // page and the client raises it to walk further back. Messages stay in chronological
    // order within the page, which is how the thread renders.
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), MAX_MESSAGE_PAGE);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    // Authorize before reading the messages at all.
    // Counted in the database: loading the whole messages array just to read its length
    // cost as much as the unpaginated response this replaced.
    const [meta] = await Chat.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(chatId) } },
      {
        $project: { clientId: 1, providerId: 1, total: { $size: { $ifNull: ['$messages', []] } } },
      },
    ]);
    if (!meta) {
      return res.status(404).json({ message: 'Chat not found' });
    }
    if (String(meta.clientId) !== String(id) && String(meta.providerId) !== String(id)) {
      return res.status(403).json({ message: 'Unauthorized: You are not part of this chat.' });
    }

    const totalMessages = meta.total;
    // `$slice: [-(offset + limit), limit]` clamps a negative skip to the start, so a
    // page past the oldest message repeated messages from earlier pages. Slice from the
    // front instead, and return nothing once offset passes the start.
    const count = Math.min(limit, totalMessages - offset);
    const slice = count > 0 ? [totalMessages - offset - count, count] : [totalMessages, 1];

    const chat = await Chat.findById(chatId)
      .select({ messages: { $slice: slice } })
      .populate('clientId', 'name avatarUrl verified identityVerification')
      .populate('providerId', 'name avatarUrl verified identityVerification')
      .populate('serviceId', 'title description images price categories userId')
      .populate('orderId')
      .populate('messages.senderId', 'name avatarUrl');

    const payload = chat.toObject();
    // Header badge only needs the derived flag; never ship the raw BankID subdocument.
    for (const party of [payload.clientId, payload.providerId]) {
      if (!party) continue;
      party.identityVerified = identityVerificationSummary(party).identityVerified;
      delete party.identityVerification;
    }
    payload.messagePage = {
      total: totalMessages,
      limit,
      offset,
      // True when older messages remain to be fetched.
      hasMore: offset + limit < totalMessages,
    };

    res.json(payload);
  } catch (error) {
    serverError(res, error);
  }
};

/**
 * A chat is one document, and MongoDB refuses to write one past 16 MB, after which every
 * save on it fails for good (messages, contract, payment confirmation). Messages are only
 * appended while the document is under this; the headroom is for system messages.
 */
const MAX_CHAT_BYTES = 15 * 1024 * 1024;

/** Messages one user may send into one chat per minute. */
const SEND_LIMIT = { max: 30, windowMs: 60 * 1000 };
const sendCounts = new Map(); // `${chatId}:${userId}` -> { n, resetAt }

/**
 * Fixed-window send counter shared by HTTP and socket sends: in Redis when configured (one
 * limit across instances), in memory otherwise.
 * ponytail: fails open when Redis errors; the in-memory map is cleared wholesale past 10k
 * keys instead of pruned.
 */
async function overSendLimit(chatId, userId) {
  const key = `${chatId}:${userId}`;
  const redisConfig = require('../config/redis');
  const redis = redisConfig.getRedis();
  if (redis) {
    try {
      const k = `${redisConfig.PREFIX}:chat-send:${key}`;
      const n = await redis.incr(k);
      if (n === 1) await redis.pexpire(k, SEND_LIMIT.windowMs);
      return n > SEND_LIMIT.max;
    } catch {
      return false;
    }
  }
  const now = Date.now();
  let entry = sendCounts.get(key);
  if (!entry || entry.resetAt <= now) {
    if (sendCounts.size > 10000) sendCounts.clear();
    entry = { n: 0, resetAt: now + SEND_LIMIT.windowMs };
    sendCounts.set(key, entry);
  }
  entry.n += 1;
  return entry.n > SEND_LIMIT.max;
}

/** True when either user has blocked the other. */
const isBlockedBetween = async (a, b) =>
  Boolean(
    await User.exists({
      $or: [
        { _id: a, blockedUsers: b },
        { _id: b, blockedUsers: a },
      ],
    })
  );
exports.isBlockedBetween = isBlockedBetween;

const BLOCKED = {
  status: 403,
  error: 'Du kan ikke sende meldinger til denne brukeren.',
  code: 'user_blocked',
};
/** 403 body for a deal step (price, contract, accepting an application) between blocked users. */
const BLOCKED_DEAL = {
  error: 'Dette er ikke mulig fordi en av dere har blokkert den andre.',
  code: 'user_blocked',
};
exports.BLOCKED_DEAL = BLOCKED_DEAL;

/**
 * The one way a user message enters a chat, for the HTTP route and the socket alike (the
 * socket path skipped the type, length, emptiness and block checks). Returns `{ message }`
 * or `{ status, error, code? }`.
 */
async function postChatMessage({ chatId, userId, text }) {
  if (!isValidId(chatId)) return { status: 400, error: 'Invalid chat ID format' };
  // Empty text wrote a blank unread row; no length cap let a few messages fill the document.
  if (typeof text !== 'string' || !text.trim())
    return { status: 400, error: 'Meldingen kan ikke være tom.' };
  if (text.length > MAX_MESSAGE_LENGTH) {
    return { status: 400, error: `Meldingen er for lang (maks ${MAX_MESSAGE_LENGTH} tegn).` };
  }

  const chat = await Chat.findById(chatId).select('clientId providerId');
  if (!chat) return { status: 404, error: 'Chat not found' };
  const uid = String(userId);
  if (String(chat.clientId) !== uid && String(chat.providerId) !== uid) {
    return { status: 403, error: 'Unauthorized: You are not part of this chat.' };
  }
  const otherId = String(chat.clientId) === uid ? chat.providerId : chat.clientId;
  if (await isBlockedBetween(uid, otherId)) return BLOCKED;
  if (await overSendLimit(chatId, uid)) {
    return {
      status: 429,
      error: 'Du sender meldinger for raskt. Vent litt.',
      code: 'chat_send_rate_limited',
    };
  }

  const trimmed = text.trim();
  const message = {
    _id: new mongoose.Types.ObjectId(),
    senderId: uid,
    text: trimmed,
    type: 'text',
    createdAt: new Date(),
    seenBy: [uid],
  };
  // Atomic append, only while the document has room. A new message also brings the
  // conversation back for anyone who had hidden it.
  const result = await Chat.updateOne(
    { _id: chatId, $expr: { $lt: [{ $bsonSize: '$$ROOT' }, MAX_CHAT_BYTES] } },
    { $push: { messages: message }, $set: { lastMessage: trimmed, deletedFor: [] } }
  );
  if (!result.modifiedCount) {
    return { status: 409, error: 'Samtalen er full. Start en ny samtale.', code: 'chat_full' };
  }
  return { message };
}
exports.postChatMessage = postChatMessage;

exports.sendMessage = async (req, res) => {
  try {
    const { chatId } = req.params;
    const result = await postChatMessage({ chatId, userId: req.user.id, text: req.body?.text });
    if (result.error) {
      return res
        .status(result.status)
        .json({ message: result.error, error: result.error, code: result.code });
    }

    // Emit socket event to notify users in the chat room
    const io = req.app.get('io');
    if (io) {
      io.to(`chat-${chatId}`).emit('receive-message', { chatId, message: result.message });
    }

    res.status(201).json(result.message);
  } catch (error) {
    serverError(res, error);
  }
};

/**
 * PATCH /api/chat/:id/delete-for-me
 */

exports.deleteForMe = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { id } = req.user;

    if (!isValidId(chatId)) return res.status(400).json({ error: 'Invalid chat ID format' });

    // There was no authorization here at all: any authenticated user could append their
    // id to ANY chat's `deletedFor`, on a document they have no relationship to, with
    // no bound on the array. Only a participant may hide their own copy.
    const chat = await Chat.findById(chatId).select('clientId providerId');
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    if (String(chat.clientId) !== String(id) && String(chat.providerId) !== String(id)) {
      return res.status(403).json({ error: 'Not allowed' });
    }

    await Chat.findByIdAndUpdate(chatId, {
      $addToSet: { deletedFor: id },
    });

    res.json({ success: true, message: 'Chat hidden' });
  } catch (err) {
    serverError(res, err);
  }
};

/**
 * DELETE /api/chat/:id
 * Permanent delete — only for sender
 */
exports.createPaymentSession = async (req, res) => {
  try {
    const { id } = req.user;
    const { chatId } = req.params;

    if (!isValidId(chatId)) return res.status(400).json({ error: 'Invalid chat ID format' });

    const chat = await Chat.findById(chatId).populate('serviceId').populate('orderId');

    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    // 🔒 Authorization check
    if (chat.clientId._id.toString() !== id && chat.providerId._id.toString() !== id)
      return res.status(403).json({ error: 'Not allowed' });

    if (!chat.orderId) {
      return res
        .status(400)
        .json({ error: 'No order exists for this chat. Please create a contract first.' });
    }

    // This route used to build its own Stripe session without saving the session id on
    // the order or using an idempotency key. The webhook then rejected every such payment
    // as checkout_session_mismatch (card charged, order never paid), and the failing
    // retries marked the webhook unhealthy, blocking every SafePay checkout.
    // createSafePaySession owns payer, status, amount and session bookkeeping.
    const { createSafePaySession } = require('./SafePayCheckoutController');
    req.body = { orderId: String(chat.orderId._id || chat.orderId) };
    return createSafePaySession(req, res);
  } catch (error) {
    console.error('Error creating payment session:', error);
    res.status(500).json({ error: 'Kunne ikke starte betalingen' });
  }
};

exports.createContract = async (req, res) => {
  try {
    const { id } = req.user;
    const { chatId } = req.params;
    const { agreedPrice } = req.body;

    if (!isValidId(chatId)) return res.status(400).json({ error: 'Invalid chat ID format' });

    const chat = await Chat.findById(chatId).populate('serviceId');
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    // 🔒 Authorization check — participant in the conversation.
    if (chat.clientId._id.toString() !== id && chat.providerId._id.toString() !== id)
      return res.status(403).json({ error: 'Not allowed' });

    // 🔒 Awarding the job is the SERVICE OWNER's decision, not any participant's.
    //
    // Participation was the only check here. In an owner-initiated chat the applicant
    // occupies chat.providerId, so the applicant could award themselves the contract —
    // at a price of their own choosing, taken from the request body below — and the
    // owner would then find a contract they never created, unable to make the real
    // one. The web UI already gates this button behind isServiceOwner; the server did
    // not, which is the half that matters.
    if (!chat.serviceId?.userId || String(chat.serviceId.userId) !== String(id)) {
      return res.status(403).json({
        error: 'Bare oppdragsgiveren kan opprette kontrakten',
      });
    }
    if (await isBlockedBetween(chat.clientId, chat.providerId))
      return res.status(403).json(BLOCKED_DEAL);

    // Check if a live contract already exists (a cancelled one frees the chat)
    if (await liveContractOrderId(chat)) {
      return res.status(400).json({ error: 'Contract already exists for this chat' });
    }

    // Held across the check below and order.save(): two concurrent awards (this path or
    // safepayController's) both saw "no order" and created two contracts for one job.
    const lock = await acquireServiceContractLock(chat.serviceId._id);
    if (!lock) {
      return res.status(409).json({ error: 'Kontrakten opprettes allerede. Prøv igjen om litt.' });
    }
    let order;
    let price;
    try {
      // The same "any order at all" check safepayController makes, for the same reason:
      // without it the two contract paths can both produce an order for one service.
      const blockingOrder = await Order.findOne({
        serviceId: chat.serviceId._id,
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
      });
      if (blockingOrder) {
        return res.status(400).json({ error: 'Kontrakt finnes allerede for dette oppdraget' });
      }

      // Create order (contract)
      const checklist = (chat.serviceId.checklist || []).map((item) => ({
        id: item.id,
        text: item.text,
        checked: false,
      }));

      // Price comes from the negotiated value on the chat or the listing — never
      // straight from this request body. `agreedPrice` was accepted verbatim, so
      // whoever called this endpoint set the contract price unilaterally.
      price = chat.agreedPrice || chat.serviceId.price;

      // Who pays and who gets paid is decided by the SERVICE, not by the chat slots.
      //
      // These used to be `chat.clientId` → customerId and `chat.providerId` → providerId.
      // A chat created by the applicant applying stores { clientId: applicant,
      // providerId: owner }, so creating the contract from that conversation produced an
      // order with the applicant as the payer and the owner as the payee — the money
      // pointing the wrong way. The owner sees the "Opprett kontrakt" button in either
      // conversation (it keys off service ownership), so that path was reachable.
      //
      // The job owner always pays; the other participant always does the work. This
      // matches safepayController.createContract, which is the primary award path.
      const serviceOwnerId = String(chat.serviceId.userId);
      const participants = [String(chat.clientId._id), String(chat.providerId._id)];
      const workerId = participants.find((p) => p !== serviceOwnerId);

      if (!workerId) {
        return res.status(400).json({ error: 'Fant ikke motparten i denne samtalen.' });
      }

      if (!(await ensureProviderConnectReady(req, res, workerId))) return;

      order = new Order({
        chatId: chat._id,
        serviceId: chat.serviceId._id,
        customerId: serviceOwnerId,
        providerId: workerId,
        status: 'awaiting_payment',
        initialPrice: chat.serviceId.price,
        agreedPrice: price,
        checklist,
        history: [
          {
            action: 'contract_created',
            userId: id,
            timestamp: new Date(),
            data: { message: 'SafePay contract created' },
          },
        ],
      });

      await order.save();
    } finally {
      await lock.release();
    }

    // Update chat
    chat.orderId = order._id;
    chat.status = 'contracted';
    chat.agreedPrice = price;

    // Add system message
    chat.messages.push({
      type: 'system_contract',
      systemData: { orderId: order._id, agreedPrice: price },
      text: `Kontrakt opprettet med pris på ${price} kr`,
      createdAt: new Date(),
    });

    await chat.save();

    // Update service status to awaiting_payment (contract created, waiting for payment)
    await Service.findByIdAndUpdate(chat.serviceId._id, { status: 'awaiting_payment' });

    // Populate chat for response
    const updatedChat = await Chat.findById(chatId)
      .populate('clientId', 'name avatarUrl')
      .populate('providerId', 'name avatarUrl')
      .populate('serviceId', 'title description images price categories userId')
      .populate('orderId')
      .populate('messages.senderId', 'name avatarUrl');

    res.status(201).json(updatedChat);
  } catch (error) {
    console.error('Error creating contract:', error);
    serverError(res, error);
  }
};

exports.updateAgreedPrice = async (req, res) => {
  try {
    const { id } = req.user;
    const { chatId } = req.params;
    const { agreedPrice } = req.body;

    if (!isValidId(chatId)) return res.status(400).json({ error: 'Invalid chat ID format' });

    // `agreedPrice >= 0` allowed 0, which is falsy — so `chat.agreedPrice || price`
    // in createContract and createPaymentSession silently fell back to the listing
    // price while the chat displayed "Pris avtalt: 0 kr". And there was no ceiling, so
    // a huge number overflowed Stripe's maximum unit_amount and 500'd at checkout.
    // Whole kroner: decimals were accepted and shown as "Pris avtalt: 0.5 kr".
    if (!Number.isInteger(agreedPrice) || agreedPrice <= 0) {
      return res.status(400).json({ error: 'Prisen må være et positivt helt beløp i kroner.' });
    }
    if (agreedPrice > MAX_AGREED_PRICE) {
      return res.status(400).json({ error: `Prisen kan ikke overstige ${MAX_AGREED_PRICE} kr.` });
    }

    const chat = await Chat.findById(chatId).populate('serviceId', 'userId');
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    // Authorization check: user must be part of the chat
    if (chat.clientId.toString() !== id && chat.providerId.toString() !== id)
      return res.status(403).json({ error: 'Not allowed' });

    // The job owner pays this price and alone creates the contract from it (createContract).
    // Either participant could set it, so the worker could raise the price the owner then
    // contracted at. Only the payer sets it.
    if (!chat.serviceId?.userId || String(chat.serviceId.userId) !== String(id)) {
      return res
        .status(403)
        .json({ error: 'Bare oppdragsgiveren kan sette prisen.', code: 'price_owner_only' });
    }
    if (await isBlockedBetween(chat.clientId, chat.providerId))
      return res.status(403).json(BLOCKED_DEAL);
    // Each change posts a system message, so it shares the chat send limit: repeated price
    // changes could otherwise grow the document toward MongoDB's 16 MB ceiling.
    if (await overSendLimit(chatId, id)) {
      return res
        .status(429)
        .json({ error: 'Du endrer prisen for ofte. Vent litt.', code: 'chat_send_rate_limited' });
    }

    // Once a contract exists the price is settled — the Order carries it, and escrow
    // is calculated from it.
    //
    // Without this, either party could renegotiate the chat price AFTER the contract
    // and then start checkout, which prefers the chat value: agree 5000, set the chat
    // to 3, pay 3 kr, and confirmPaidSession still flips the 5000 kr order to fully
    // paid — the provider is later released `order.agreedPrice - fee` that the
    // platform never collected. The UI hides the edit control once an order exists;
    // this is the server-side half of that rule.
    if (await liveContractOrderId(chat)) {
      return res.status(409).json({
        error: 'Prisen kan ikke endres etter at kontrakten er opprettet.',
        code: 'price_locked_by_contract',
      });
    }

    // Update chat
    chat.agreedPrice = agreedPrice;
    // Only advance the badge from a pre-contract state. Overwriting unconditionally
    // dragged a live job's chat back to "agreed" from paid/in_progress.
    if (!chat.status || ['requested', 'agreed'].includes(chat.status)) {
      chat.status = 'agreed';
    }

    // Add system message
    chat.messages.push({
      type: 'system_status',
      systemData: { agreedPrice },
      text: `Pris avtalt: ${agreedPrice} kr`,
      createdAt: new Date(),
    });

    await chat.save();

    // Populate chat for response
    const updatedChat = await Chat.findById(chatId)
      .populate('clientId', 'name avatarUrl')
      .populate('providerId', 'name avatarUrl')
      .populate('serviceId', 'title description images price categories userId')
      .populate('orderId')
      .populate('messages.senderId', 'name avatarUrl');

    res.json(updatedChat);
  } catch (error) {
    console.error('Error updating agreed price:', error);
    serverError(res, error);
  }
};

exports.deleteChat = async (req, res) => {
  try {
    const { id } = req.user;
    if (!id) return res.status(401).json({ error: 'Unauthorized' });

    const { chatId } = req.params;

    if (!isValidId(chatId)) return res.status(400).json({ error: 'Invalid chat ID format' });

    const chat = await Chat.findById(chatId).select('clientId providerId');
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    if (chat.clientId.toString() !== id && chat.providerId.toString() !== id)
      return res.status(403).json({ error: 'Not allowed' });

    // The conversation is shared: it is the other party's record too, and the evidence for
    // a report or dispute they may not have filed yet. This hard-deleted it for both, and
    // only active orders, disputes and open reports were protected, so a harasser could
    // wipe the thread before the victim reported it. Deleting now hides it for the caller
    // (as delete-for-me does); a new message brings it back.
    await Chat.updateOne({ _id: chatId }, { $addToSet: { deletedFor: id } });

    res.status(204).end();
  } catch (error) {
    serverError(res, error);
  }
};
