const mongoose = require('mongoose');
const Chat = require('../../models/ChatMessage');
const ChatReport = require('../../models/ChatReport');
const Order = require('../../models/Order');
const Payment = require('../../models/Payment');
const Dispute = require('../../models/Dispute');
const Notification = require('../../models/Notification');
const {
  asyncHandler,
  sendSuccess,
  sendError,
  buildPagination,
} = require('../../utils/apiResponse');
const { parsePagination, parseObjectId, parseSort, parseDate } = require('../../utils/pagination');
const { logActivity } = require('../../services/admin/activityService');
const { queryString } = require('../../utils/devQuery');

// ── Chat list ──────────────────────────────────────────────────────────────────
const CHAT_SORT_FIELDS = ['createdAt', 'updatedAt'];

const getChats = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const sort = parseSort(req.query.sortBy, req.query.sortOrder, CHAT_SORT_FIELDS, 'createdAt');

  const query = {};

  // Exact Chat ID search (ObjectId only — no regex on ObjectId fields)
  if (req.query.chatId) {
    const cid = parseObjectId(req.query.chatId);
    if (!cid) return sendError(res, 'Ugyldig Chat ID.', 400);
    query._id = cid;
  }

  // Search by Report ID — resolve to chatId
  if (req.query.reportId) {
    const rid = parseObjectId(req.query.reportId);
    if (!rid) return sendError(res, 'Ugyldig rapport-ID.', 400);
    const report = await ChatReport.findById(rid, { chatId: 1 }).lean();
    if (!report) return sendError(res, 'Rapport ikke funnet.', 404);
    query._id = report.chatId;
  }

  // Exact Order ID
  if (req.query.orderId) {
    const oid = parseObjectId(req.query.orderId);
    if (!oid) return sendError(res, 'Ugyldig ordre-ID.', 400);
    query.orderId = oid;
  }

  // Exact Service ID
  if (req.query.serviceId) {
    const sid = parseObjectId(req.query.serviceId);
    if (!sid) return sendError(res, 'Ugyldig tjeneste-ID.', 400);
    query.serviceId = sid;
  }

  // Customer or provider ID
  if (req.query.customerId) {
    const uid = parseObjectId(req.query.customerId);
    if (uid) query.clientId = uid;
  }
  if (req.query.providerId) {
    const uid = parseObjectId(req.query.providerId);
    if (uid) query.providerId = uid;
  }

  if (req.query.status) {
    const validStatuses = [
      'requested',
      'agreed',
      'paid',
      'contracted',
      'in_progress',
      'completed',
      'disputed',
      'cancelled',
      'restricted',
    ];
    if (validStatuses.includes(req.query.status)) query.status = req.query.status;
  }

  // Filter: reported / not reported
  if (req.query.reported === 'true') {
    const reportedChatIds = await ChatReport.distinct('chatId');
    query._id = { $in: reportedChatIds };
  } else if (req.query.reported === 'false') {
    const reportedChatIds = await ChatReport.distinct('chatId');
    query._id = { $nin: reportedChatIds };
  }

  // Filter: SafePay linked / not linked
  if (req.query.safePayLinked === 'true') {
    query.orderId = { $exists: true, $ne: null };
  } else if (req.query.safePayLinked === 'false') {
    // Use $and to avoid conflicting with potential $or from search
    query.$and = [
      ...(query.$and || []),
      { $or: [{ orderId: { $exists: false } }, { orderId: null }] },
    ];
  }

  const dateFrom = parseDate(req.query.startDate);
  const dateTo = parseDate(req.query.endDate);
  if (dateFrom || dateTo) {
    query.createdAt = {};
    if (dateFrom) query.createdAt.$gte = dateFrom;
    if (dateTo) query.createdAt.$lte = new Date(dateTo.setHours(23, 59, 59, 999));
  }

  // Text search across service title, customer name, provider name
  if (req.query.search) {
    const esc = queryString(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = { $regex: esc, $options: 'i' };

    // Search service by title first, then use IDs in chat query
    const Service = require('../../models/Service');
    const User = require('../../models/User');
    const [matchedServices, matchedUsers] = await Promise.all([
      Service.find({ title: regex }, { _id: 1 }).limit(50).lean(),
      User.find({ $or: [{ name: regex }, { email: regex }] }, { _id: 1 })
        .limit(50)
        .lean(),
    ]);
    const serviceIds = matchedServices.map((s) => s._id);
    const userIds = matchedUsers.map((u) => u._id);

    const searchClauses = [];
    if (serviceIds.length) searchClauses.push({ serviceId: { $in: serviceIds } });
    if (userIds.length) {
      searchClauses.push({ clientId: { $in: userIds } });
      searchClauses.push({ providerId: { $in: userIds } });
    }
    if (searchClauses.length) {
      query.$or = searchClauses;
    } else {
      // No matches for this search term
      return sendSuccess(
        res,
        { chats: [] },
        'Ingen chatter funnet.',
        buildPagination(0, page, limit)
      );
    }
  }

  const [total, chats] = await Promise.all([
    Chat.countDocuments(query),
    Chat.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .select('-deletedFor -messages')
      .populate('clientId', 'name email avatarUrl accountStatus verified role')
      .populate('providerId', 'name email avatarUrl accountStatus verified role')
      .populate('serviceId', 'title status price')
      .populate('orderId', 'status paymentStatus agreedPrice')
      .lean(),
  ]);

  // Attach report count + message stats per chat (efficient aggregation)
  const chatIds = chats.map((c) => c._id);
  const [reportCounts, messageStats] = await Promise.all([
    ChatReport.aggregate([
      { $match: { chatId: { $in: chatIds } } },
      { $group: { _id: '$chatId', count: { $sum: 1 } } },
    ]),
    Chat.aggregate([
      { $match: { _id: { $in: chatIds } } },
      {
        $project: {
          messageCount: { $size: { $ifNull: ['$messages', []] } },
          attachmentCount: {
            $size: {
              $filter: {
                input: { $ifNull: ['$messages', []] },
                as: 'm',
                cond: { $gt: [{ $size: { $ifNull: ['$$m.attachments', []] } }, 0] },
              },
            },
          },
          lastMessageAt: {
            $let: {
              vars: { last: { $last: { $ifNull: ['$messages', []] } } },
              in: '$$last.createdAt',
            },
          },
        },
      },
    ]),
  ]);

  const reportCountMap = {};
  reportCounts.forEach((r) => {
    reportCountMap[String(r._id)] = r.count;
  });
  const statsMap = {};
  messageStats.forEach((s) => {
    statsMap[String(s._id)] = s;
  });

  const enriched = chats.map((c) => {
    const stats = statsMap[String(c._id)] ?? {
      messageCount: 0,
      attachmentCount: 0,
      lastMessageAt: null,
    };
    return {
      ...c,
      messages: undefined, // ensure messages array is not sent
      messageCount: stats.messageCount,
      attachmentCount: stats.attachmentCount,
      lastMessageAt: stats.lastMessageAt,
      reportCount: reportCountMap[String(c._id)] ?? 0,
    };
  });

  return sendSuccess(
    res,
    { chats: enriched },
    'Chatter hentet.',
    buildPagination(total, page, limit)
  );
});

// ── Chat detail ────────────────────────────────────────────────────────────────
// One call for the admin chat viewer: metadata, both parties, linked order/payment/dispute,
// the messages and the reports. Reading messages is private, so an access reason is required
// and every open is written to the admin activity log.
const PERSON = 'name email avatarUrl accountStatus verified role averageRating completedJobs';
const person = (u) =>
  u && typeof u === 'object' && u.name !== undefined
    ? { ...u, profileLink: `/dashboard/users/${u._id}` }
    : null;

const getChatById = asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.chatId);
  if (!id) return sendError(res, 'Ugyldig Chat ID.', 400);

  const reason = typeof req.query.accessReason === 'string' ? req.query.accessReason.trim() : '';
  if (reason.length < 5 || reason.length > 500) {
    return sendError(res, 'Tilgangsgrunn er påkrevd (5–500 tegn).', 400);
  }

  const chat = await Chat.findById(id)
    .select('-deletedFor')
    .populate('clientId', PERSON)
    .populate('providerId', PERSON)
    .populate('serviceId', 'title status price categories')
    .populate('orderId', 'status paymentStatus agreedPrice scheduledDate createdAt')
    .populate({ path: 'messages.senderId', select: 'name role', strictPopulate: false })
    .lean();

  if (!chat) return sendError(res, 'Chat ikke funnet.', 404);

  const orderRef = chat.orderId?._id ?? chat.orderId ?? null;
  const [reports, payment, dispute] = await Promise.all([
    ChatReport.find({ chatId: id })
      .sort({ createdAt: -1 })
      .select('scope reportType title status priority messageId reportedBy reportedUser createdAt')
      .populate('reportedBy', 'name email')
      .populate('reportedUser', 'name email')
      .lean(),
    orderRef
      ? Payment.findOne({ orderId: orderRef }).select('status amount stripePaymentIntentId').lean()
      : null,
    orderRef ? Dispute.findOne({ orderId: orderRef }).select('status priority _id').lean() : null,
  ]);

  await logActivity({
    adminId: req.user._id,
    action: 'other',
    targetModel: 'other',
    targetId: id,
    description: `Admin åpnet chat-meldinger. Årsak: ${reason}`,
    metadata: { chatId: id, orderId: orderRef, reason },
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  const reported = new Set(
    (reports || [])
      .map((r) => r.messageId)
      .filter(Boolean)
      .map(String)
  );
  const raw = chat.messages || [];
  const messages = raw.map((m) => ({
    _id: m._id,
    type: m.type ?? 'text',
    text: m.text,
    attachments: m.attachments ?? [],
    systemData: m.systemData ?? null,
    sender:
      m.senderId && typeof m.senderId === 'object' && m.senderId.name !== undefined
        ? { _id: m.senderId._id, name: m.senderId.name, role: m.senderId.role }
        : null,
    isReported: reported.has(String(m._id)),
    createdAt: m.createdAt,
  }));
  const order = chat.orderId && typeof chat.orderId === 'object' ? chat.orderId : null;

  return sendSuccess(res, {
    chat: {
      _id: chat._id,
      status: chat.status,
      agreedPrice: chat.agreedPrice,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messageCount: raw.length,
      attachmentCount: raw.reduce((s, m) => s + (m.attachments?.length ?? 0), 0),
      reportCount: (reports || []).length,
      lastMessageAt: raw.at(-1)?.createdAt ?? null,
    },
    participants: { customer: person(chat.clientId), provider: person(chat.providerId) },
    relatedRecords: {
      serviceId: chat.serviceId?._id ?? null,
      serviceTitle: chat.serviceId?.title ?? null,
      orderId: orderRef,
      safePayOrderId: orderRef,
      paymentStatus: order?.paymentStatus ?? payment?.status ?? null,
      orderStatus: order?.status ?? null,
      disputeStatus: dispute?.status ?? null,
      agreedPrice: order?.agreedPrice ?? chat.agreedPrice ?? null,
      safePayDetailLink: orderRef ? `/dashboard/safepay/${orderRef}` : null,
      reportDetailLink: reports?.[0] ? `/dashboard/chat-reports/${reports[0]._id}` : null,
      disputeId: dispute?._id ?? null,
    },
    messages,
    reports: reports || [],
    accessLogged: true,
    payment: payment ? { status: payment.status, amount: payment.amount } : null,
    dispute: dispute
      ? { _id: dispute._id, status: dispute.status, priority: dispute.priority }
      : null,
  });
});

// ── Chat messages (separate endpoint with audit) ───────────────────────────────
const getChatMessages = asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.chatId);
  if (!id) return sendError(res, 'Ugyldig Chat ID.', 400);

  const { accessReason } = req.query;
  if (!accessReason || String(accessReason).trim().length < 5) {
    return sendError(res, 'Tilgangsgrunn er påkrevd (min. 5 tegn).', 400);
  }

  const chat = await Chat.findById(id)
    .select('messages orderId clientId providerId status')
    .populate({ path: 'messages.senderId', select: 'name email role', strictPopulate: false })
    .lean();

  if (!chat) return sendError(res, 'Chat ikke funnet.', 404);

  // Log mandatory audit trail
  await logActivity({
    adminId: req.user._id,
    action: 'other',
    targetModel: 'other',
    targetId: id,
    description: `Admin åpnet chat-meldinger. Årsak: ${String(accessReason).trim()}`,
    metadata: { chatId: id, orderId: chat.orderId, reason: String(accessReason).trim() },
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  // Get reported message IDs for this chat (to flag them in the viewer)
  const reports = await ChatReport.find(
    { chatId: id, messageId: { $ne: null } },
    { messageId: 1, reportType: 1, status: 1 }
  ).lean();
  const reportedMessageIds = new Set(reports.map((r) => r.messageId));

  const safeMessages = (chat.messages || []).map((m) => ({
    _id: m._id,
    type: m.type ?? 'text',
    text: m.text,
    attachments: m.attachments ?? [],
    systemData: m.systemData,
    sender: m.senderId
      ? { _id: m.senderId._id, name: m.senderId.name, role: m.senderId.role }
      : null,
    isReported: reportedMessageIds.has(String(m._id)),
    createdAt: m.createdAt,
  }));

  return sendSuccess(res, {
    messages: safeMessages,
    accessLogged: true,
    reason: String(accessReason).trim(),
  });
});

// ── Chat reports (for a specific chat) ────────────────────────────────────────
const getChatReports = asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.chatId);
  if (!id) return sendError(res, 'Ugyldig Chat ID.', 400);

  const reports = await ChatReport.find({ chatId: id })
    .sort({ createdAt: -1 })
    .populate('reportedBy', 'name email role')
    .populate('reportedUser', 'name email role')
    .populate('assignedAdminId', 'name email')
    .lean();

  return sendSuccess(res, { reports });
});

// ── Log chat access ────────────────────────────────────────────────────────────
const logChatAccess = asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.chatId);
  if (!id) return sendError(res, 'Ugyldig Chat ID.', 400);

  const { accessReason, orderId } = req.body;
  if (typeof accessReason !== 'string' || !accessReason.trim())
    return sendError(res, 'Tilgangsgrunn er påkrevd.', 400);

  await logActivity({
    adminId: req.user._id,
    action: 'other',
    targetModel: 'other',
    targetId: id,
    description: `Admin-tilgang til chat logget. Årsak: ${accessReason.trim()}`,
    metadata: { chatId: id, orderId: orderId ?? null, reason: accessReason.trim() },
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return sendSuccess(res, { logged: true });
});

module.exports = { getChats, getChatById, getChatMessages, getChatReports, logChatAccess };
