const mongoose = require('mongoose');
const ChatReport = require('../../models/ChatReport');
const Order = require('../../models/Order');
const Payment = require('../../models/Payment');
const Chat = require('../../models/ChatMessage');
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
const {
  openDispute,
  DISPUTE_ELIGIBLE_STATUSES,
} = require('../../services/admin/safePayStateService');
const { notify } = require('../../services/notifications');

const SORT_FIELDS = ['createdAt', 'updatedAt'];
/** A trimmed, non-empty string of at most `max` chars, or null (also for non-strings). */
const text = (v, max) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);
const TERMINAL_STATUSES = ['resolved', 'dismissed', 'closed'];

// ── Reports list ──────────────────────────────────────────────────────────────
const getReports = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const sort = parseSort(req.query.sortBy, req.query.sortOrder, SORT_FIELDS, 'createdAt');

  const query = {};

  if (req.query.status && ChatReport.schema.path('status').enumValues.includes(req.query.status)) {
    query.status = req.query.status;
  }
  if (
    req.query.priority &&
    ChatReport.schema.path('priority').enumValues.includes(req.query.priority)
  ) {
    query.priority = req.query.priority;
  }
  if (ChatReport.VALID_REPORT_TYPES.includes(req.query.reportType))
    query.reportType = req.query.reportType;
  if (req.query.assignedToMe === 'true') query.assignedAdminId = req.user._id;
  if (req.query.unassigned === 'true') query.assignedAdminId = null;

  const chatId = parseObjectId(req.query.chatId);
  if (chatId) query.chatId = chatId;
  const safePayOrderId = parseObjectId(req.query.safePayOrderId);
  if (safePayOrderId) query.safePayOrderId = safePayOrderId;

  const dateFrom = parseDate(req.query.startDate);
  const dateTo = parseDate(req.query.endDate);
  if (dateFrom || dateTo) {
    query.createdAt = {};
    if (dateFrom) query.createdAt.$gte = dateFrom;
    if (dateTo) query.createdAt.$lte = new Date(dateTo.setHours(23, 59, 59, 999));
  }

  const [total, reports] = await Promise.all([
    ChatReport.countDocuments(query),
    ChatReport.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .select('-internalNotes -officialMessages -timeline -evidence')
      .populate('reportedBy', 'name email role avatarUrl')
      .populate('reportedUser', 'name email role avatarUrl')
      .populate('chatId', 'status orderId')
      .populate('serviceId', 'title')
      .populate('assignedAdminId', 'name email')
      .lean(),
  ]);

  return sendSuccess(res, { reports }, 'Rapporter hentet.', buildPagination(total, page, limit));
});

// ── Reports summary ───────────────────────────────────────────────────────────
const getReportsSummary = asyncHandler(async (req, res) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const active = { $nin: TERMINAL_STATUSES };
  const [statusCounts, resolvedThisMonth, unassigned, safePayLinked, urgent, high] =
    await Promise.all([
      ChatReport.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      ChatReport.countDocuments({
        status: { $in: ['resolved', 'dismissed'] },
        'resolution.resolvedAt': { $gte: startOfMonth },
      }),
      ChatReport.countDocuments({ assignedAdminId: null, status: active }),
      ChatReport.countDocuments({ safePayOrderId: { $ne: null } }),
      ChatReport.countDocuments({ priority: 'urgent', status: active }),
      ChatReport.countDocuments({ priority: 'high', status: active }),
    ]);

  const byStatus = {};
  statusCounts.forEach((s) => {
    byStatus[s._id] = s.count;
  });

  return sendSuccess(res, {
    open: byStatus['open'] ?? 0,
    under_review: byStatus['under_review'] ?? 0,
    action_required: byStatus['action_required'] ?? 0,
    waiting_for_reporter: byStatus['waiting_for_reporter'] ?? 0,
    waiting_for_reported_user: byStatus['waiting_for_reported_user'] ?? 0,
    resolved: byStatus['resolved'] ?? 0,
    dismissed: byStatus['dismissed'] ?? 0,
    closed: byStatus['closed'] ?? 0,
    total: statusCounts.reduce((n, x) => n + x.count, 0),
    resolvedThisMonth,
    unassigned,
    safePayLinked,
    urgent,
    high,
  });
});

// ── Report detail ─────────────────────────────────────────────────────────────
const getReportById = asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.reportId);
  if (!id) return sendError(res, 'Ugyldig rapport-ID.', 400);

  const report = await ChatReport.findById(id)
    .populate('reportedBy', 'name email role avatarUrl accountStatus verified')
    .populate('reportedUser', 'name email role avatarUrl accountStatus verified')
    .populate('chatId', 'status orderId clientId providerId agreedPrice')
    .populate('serviceId', 'title price status')
    .populate('orderId', 'status paymentStatus agreedPrice')
    .populate('safePayOrderId', 'status paymentStatus agreedPrice')
    .populate('assignedAdminId', 'name email')
    .populate('disputeId', 'status priority _id')
    .populate('resolution.resolvedBy', 'name email')
    .populate('timeline.actorId', 'name email')
    .lean();

  if (!report) return sendError(res, 'Rapport ikke funnet.', 404);

  return sendSuccess(res, { report });
});

// ── Assign ────────────────────────────────────────────────────────────────────
const assignReport = asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.reportId);
  if (!id) return sendError(res, 'Ugyldig rapport-ID.', 400);

  const report = await ChatReport.findById(id);
  if (!report) return sendError(res, 'Rapport ikke funnet.', 404);
  if (TERMINAL_STATUSES.includes(report.status))
    return sendError(res, 'Rapporten er avsluttet.', 400);

  report.assignedAdminId = req.user._id;
  if (report.status === 'open') report.status = 'under_review';
  report.timeline.push({
    action: 'assigned',
    actorId: req.user._id,
    description: `Tildelt til ${req.user.name}`,
  });
  await report.save();

  await logActivity({
    adminId: req.user._id,
    action: 'other',
    targetModel: 'other',
    targetId: id,
    description: `Rapport tildelt til ${req.user.name}`,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return sendSuccess(res, { report }, 'Rapport tildelt.');
});

// ── Priority ──────────────────────────────────────────────────────────────────
const updatePriority = asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.reportId);
  if (!id) return sendError(res, 'Ugyldig rapport-ID.', 400);
  const { priority } = req.body;
  if (!priority || !['low', 'medium', 'high', 'urgent'].includes(priority)) {
    return sendError(res, 'Ugyldig prioritet.', 400);
  }
  const report = await ChatReport.findById(id);
  if (!report) return sendError(res, 'Rapport ikke funnet.', 404);
  report.priority = priority;
  report.timeline.push({
    action: 'priority_changed',
    actorId: req.user._id,
    description: `Prioritet satt til ${priority}`,
  });
  await report.save();
  return sendSuccess(res, { report }, 'Prioritet oppdatert.');
});

// ── Status ────────────────────────────────────────────────────────────────────
const updateStatus = asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.reportId);
  if (!id) return sendError(res, 'Ugyldig rapport-ID.', 400);
  const { status, note } = req.body;
  const validStatuses = ChatReport.schema.path('status').enumValues;
  if (!status || !validStatuses.includes(status)) return sendError(res, 'Ugyldig status.', 400);

  const report = await ChatReport.findById(id);
  if (!report) return sendError(res, 'Rapport ikke funnet.', 404);
  if (TERMINAL_STATUSES.includes(report.status))
    return sendError(res, 'Rapporten er avsluttet.', 400);

  report.status = status;
  report.timeline.push({
    action: `status_changed_to_${status}`,
    actorId: req.user._id,
    description: text(note, 500) ?? `Status: ${status}`,
  });
  await report.save();
  return sendSuccess(res, { report }, 'Status oppdatert.');
});

// ── Internal note ─────────────────────────────────────────────────────────────
const addInternalNote = asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.reportId);
  if (!id) return sendError(res, 'Ugyldig rapport-ID.', 400);
  const note = text(req.body.note, 2000);
  if (!note) return sendError(res, 'Notat er påkrevd (maks 2000 tegn).', 400);

  const report = await ChatReport.findById(id);
  if (!report) return sendError(res, 'Rapport ikke funnet.', 404);
  report.internalNotes.push({ adminId: req.user._id, note });
  report.timeline.push({
    action: 'internal_note_added',
    actorId: req.user._id,
    description: 'Internt notat lagt til',
  });
  await report.save();
  return sendSuccess(res, {}, 'Notat lagret.');
});

// ── Request information ───────────────────────────────────────────────────────
const requestInformation = asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.reportId);
  if (!id) return sendError(res, 'Ugyldig rapport-ID.', 400);
  const { from } = req.body;
  const message = text(req.body.message, 2000);
  if (!from || !['reporter', 'reported_user'].includes(from))
    return sendError(res, 'Spesifiser "from": reporter eller reported_user.', 400);
  if (!message) return sendError(res, 'Melding er påkrevd (maks 2000 tegn).', 400);

  const report = await ChatReport.findById(id);
  if (!report) return sendError(res, 'Rapport ikke funnet.', 404);
  if (TERMINAL_STATUSES.includes(report.status))
    return sendError(res, 'Rapporten er avsluttet.', 400);

  report.officialMessages.push({
    senderId: req.user._id,
    recipientId: from === 'reporter' ? report.reportedBy : report.reportedUser,
    message,
  });
  report.status = from === 'reporter' ? 'waiting_for_reporter' : 'waiting_for_reported_user';
  report.timeline.push({
    action: `information_requested_from_${from}`,
    actorId: req.user._id,
    description: `Admin ba om informasjon fra ${from}`,
  });
  await report.save();

  // Notify the user
  const notifyId = from === 'reporter' ? report.reportedBy : report.reportedUser;
  await notify({
    userId: notifyId,
    type: 'alert',
    content: 'Support ber om mer informasjon om en rapport du er involvert i.',
  });

  return sendSuccess(res, {}, 'Informasjonsforespørsel sendt.');
});

// ── Official message ──────────────────────────────────────────────────────────
const addOfficialMessage = asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.reportId);
  if (!id) return sendError(res, 'Ugyldig rapport-ID.', 400);
  const message = text(req.body.message, 2000);
  if (!message) return sendError(res, 'Melding er påkrevd (maks 2000 tegn).', 400);
  const report = await ChatReport.findById(id);
  if (!report) return sendError(res, 'Rapport ikke funnet.', 404);
  // The admin page sends recipientType ('reporter' | 'reported_user'); an explicit id also works.
  const { recipientType } = req.body;
  const rId =
    recipientType === 'reporter'
      ? report.reportedBy
      : recipientType === 'reported_user'
        ? report.reportedUser
        : parseObjectId(req.body.recipientId);
  // Only the two people in the report can receive an official message.
  if (!rId || ![report.reportedBy, report.reportedUser].some((u) => u && String(u) === String(rId)))
    return sendError(res, 'Mottakeren må være den som rapporterte eller den rapporterte.', 400);
  report.officialMessages.push({ senderId: req.user._id, recipientId: rId, message });
  report.timeline.push({
    action: 'official_message_sent',
    actorId: req.user._id,
    description: 'Offisiell melding sendt',
  });
  await report.save();
  await notify({
    userId: rId,
    type: 'alert',
    content: 'Du har fått en melding fra Jobblo support om en rapport.',
  });
  return sendSuccess(res, {}, 'Melding sendt.');
});

// ── Resolve ───────────────────────────────────────────────────────────────────
async function closeReport(req, res, status) {
  const id = parseObjectId(req.params.reportId);
  if (!id) return sendError(res, 'Ugyldig rapport-ID.', 400);
  const outcome = status === 'dismissed' ? 'no_violation' : req.body.outcome;
  const reason = text(req.body.reason, 1000);

  const VALID_OUTCOMES = [
    'no_violation',
    'warning_issued',
    'content_violation',
    'user_restricted',
    'user_suspended',
    'chat_restricted',
    'safepay_dispute_opened',
    'payment_review_required',
    'fraud_escalated',
    'resolved_between_users',
    'other',
  ];
  if (!outcome || !VALID_OUTCOMES.includes(outcome)) return sendError(res, 'Ugyldig utfall.', 400);
  if (!reason) return sendError(res, 'Begrunnelse er påkrevd (maks 1000 tegn).', 400);

  const report = await ChatReport.findById(id);
  if (!report) return sendError(res, 'Rapport ikke funnet.', 404);
  if (TERMINAL_STATUSES.includes(report.status))
    return sendError(res, 'Rapporten er allerede avsluttet.', 409);

  report.status = status;
  report.resolution = { outcome, reason, resolvedBy: req.user._id, resolvedAt: new Date() };
  report.timeline.push({
    action: status,
    actorId: req.user._id,
    description: `${status === 'dismissed' ? 'Avvist.' : `Løst: ${outcome}.`} ${reason}`.slice(
      0,
      500
    ), // timeline cap
  });
  await report.save();

  await logActivity({
    adminId: req.user._id,
    action: 'other',
    targetModel: 'other',
    targetId: id,
    description: `Rapport ${status === 'dismissed' ? 'avvist' : `løst: ${outcome}`}`,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return sendSuccess(res, { report }, status === 'dismissed' ? 'Rapport avvist.' : 'Rapport løst.');
}
const resolveReport = asyncHandler((req, res) => closeReport(req, res, 'resolved'));
const dismissReport = asyncHandler((req, res) => closeReport(req, res, 'dismissed'));

// ── Reopen ────────────────────────────────────────────────────────────────────
const reopenReport = asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.reportId);
  if (!id) return sendError(res, 'Ugyldig rapport-ID.', 400);
  const reason = text(req.body.reason, 2000);
  if (!reason) return sendError(res, 'Årsak er påkrevd.', 400);

  const report = await ChatReport.findById(id);
  if (!report) return sendError(res, 'Rapport ikke funnet.', 404);
  if (!TERMINAL_STATUSES.includes(report.status))
    return sendError(res, 'Kun avsluttede rapporter kan gjenåpnes.', 400);

  report.status = 'under_review';
  report.timeline.push({
    action: 'reopened',
    actorId: req.user._id,
    description: `Gjenåpnet: ${reason}`.slice(0, 500), // timeline cap
  });
  await report.save();
  return sendSuccess(res, { report }, 'Rapport gjenåpnet.');
});

// ── Create SafePay dispute from report ────────────────────────────────────────
const createDisputeFromReport = asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.reportId);
  if (!id) return sendError(res, 'Ugyldig rapport-ID.', 400);

  const report = await ChatReport.findById(id);
  if (!report) return sendError(res, 'Rapport ikke funnet.', 404);
  if (report.disputeId)
    return sendError(res, 'Tvist er allerede opprettet for denne rapporten.', 409);

  const orderId = report.safePayOrderId ?? report.orderId;
  if (!orderId) return sendError(res, 'Ingen SafePay-ordre knyttet til rapporten.', 400);

  const order = await Order.findById(orderId).select('status customerId providerId').lean();
  if (!order) return sendError(res, 'Ordre ikke funnet.', 404);

  if (!DISPUTE_ELIGIBLE_STATUSES.includes(order.status)) {
    return sendError(res, `Tvist kan ikke åpnes for ordre med status: ${order.status}.`, 400);
  }

  // Prevent duplicate active dispute
  const existingDispute = await Dispute.findOne({
    orderId,
    status: {
      $in: [
        'open',
        'under_review',
        'waiting_for_customer',
        'waiting_for_provider',
        'evidence_submitted',
      ],
    },
  });
  if (existingDispute)
    return sendError(res, 'Det finnes allerede en aktiv tvist for denne ordren.', 409);

  const dispute = await openDispute({
    orderId,
    openedByUserId: req.user._id,
    openedByRole: 'customer',
    reasonCategory: 'other',
    title: `Tvist åpnet fra chatrapport: ${report.title}`,
    description: report.description,
    adminId: req.user._id,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  report.disputeId = dispute._id;
  report.timeline.push({
    action: 'safepay_dispute_opened',
    actorId: req.user._id,
    description: `SafePay-tvist opprettet: ${dispute._id}`,
  });
  await report.save();

  return sendSuccess(res, { dispute, report }, 'SafePay-tvist opprettet fra rapport.');
});

module.exports = {
  getReports,
  getReportsSummary,
  getReportById,
  assignReport,
  updatePriority,
  updateStatus,
  addInternalNote,
  requestInformation,
  addOfficialMessage,
  resolveReport,
  dismissReport,
  reopenReport,
  createDisputeFromReport,
};
