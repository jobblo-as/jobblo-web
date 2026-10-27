const Order = require('../../models/Order');
const {
  asyncHandler,
  sendSuccess,
  sendError,
  buildPagination,
} = require('../../utils/apiResponse');
const { parsePagination, parseObjectId, parseSort, parseDate } = require('../../utils/pagination');
const { logActivity } = require('../../services/admin/activityService');
const {
  isValidTransition,
  assertNoActiveDispute,
  assertTerminalIsMoneySafe,
  OrderTransitionError,
} = require('../../services/order/orderState');
const { releaseListingAfterCancel } = require('../../services/order/releaseListing');

const SORT_FIELDS = ['createdAt', 'updatedAt', 'agreedPrice', 'status'];

/**
 * GET /api/admin/orders
 * Paginated, filterable order list.
 */
const getOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const sort = parseSort(req.query.sortBy, req.query.sortOrder, SORT_FIELDS, 'createdAt');

  const query = {};

  if (req.query.status) {
    const valid = [
      'pending',
      'accepted',
      'declined',
      'in_progress',
      'completed',
      'cancelled',
      'awaiting_payment',
      'paid',
    ];
    if (valid.includes(req.query.status)) query.status = req.query.status;
  }
  if (req.query.paymentStatus) {
    const valid = ['unpaid', 'pending', 'paid', 'refunded'];
    if (valid.includes(req.query.paymentStatus)) query.paymentStatus = req.query.paymentStatus;
  }

  const dateFrom = parseDate(req.query.dateFrom);
  const dateTo = parseDate(req.query.dateTo);
  if (dateFrom || dateTo) {
    query.createdAt = {};
    if (dateFrom) query.createdAt.$gte = dateFrom;
    if (dateTo) query.createdAt.$lte = new Date(dateTo.setHours(23, 59, 59, 999));
  }

  // Customer or provider filter
  const customerId = parseObjectId(req.query.customerId);
  if (customerId) query.customerId = customerId;
  const providerId = parseObjectId(req.query.providerId);
  if (providerId) query.providerId = providerId;
  const serviceId = parseObjectId(req.query.serviceId);
  if (serviceId) query.serviceId = serviceId;

  const [total, orders] = await Promise.all([
    Order.countDocuments(query),
    Order.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .select('-checklist -priceNegotiation -history -beforeImages -afterImages -attachments')
      .populate('customerId', 'name email avatarUrl')
      .populate('providerId', 'name email avatarUrl')
      .populate('serviceId', 'title price status')
      .lean(),
  ]);

  return sendSuccess(res, { orders }, 'Ordrer hentet.', buildPagination(total, page, limit));
});

/**
 * GET /api/admin/orders/:id
 */
const getOrderById = asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.id);
  if (!id) return sendError(res, 'Ugyldig ordre-ID.', 400);

  const order = await Order.findById(id)
    .populate('customerId', 'name email avatarUrl phone')
    .populate('providerId', 'name email avatarUrl phone')
    .populate('serviceId', 'title price status categories images')
    .lean();

  if (!order) return sendError(res, 'Ordre ikke funnet.', 404);

  return sendSuccess(res, { order });
});

/**
 * PUT /api/admin/orders/:id/status
 * Admin can only add a note or cancel a pending order.
 * Cannot bypass payment integrity (no forced 'paid' status).
 */
const updateOrderStatus = asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.id);
  if (!id) return sendError(res, 'Ugyldig ordre-ID.', 400);

  const { status, adminNote } = req.body;
  const ADMIN_ALLOWED = ['cancelled'];
  if (status && !ADMIN_ALLOWED.includes(status)) {
    return sendError(res, `Admin kan kun sette status til: ${ADMIN_ALLOWED.join(', ')}.`, 400);
  }

  const note = adminNote ? String(adminNote).substring(0, 500) : null;
  let order;
  if (status === 'cancelled') {
    // This was an unconditional findByIdAndUpdate: an admin could cancel a PAID order
    // with no refund, stranding the captured money (payout refuses cancelled orders).
    // Same guards as transitionOrder (transition table, active-dispute freeze, "held money
    // needs a refund or payout"), but the compare-and-swap also requires that no checkout
    // session is open or being created: a payment after cancellation would be captured
    // against a cancelled order, and checking that in a separate read raced a new checkout.
    // ponytail: mirrors transitionOrder; a `where` option there would let this reuse it.
    const NO_ACTIVE_CHECKOUT = { $nin: ['open', 'pending'] };
    try {
      const current = await Order.findById(id);
      if (!current) return sendError(res, 'Ordre ikke funnet.', 404);
      if (current.status === 'cancelled') {
        order = current;
      } else {
        if (NO_ACTIVE_CHECKOUT.$nin.includes(current.checkoutSessionStatus)) {
          return sendError(res, 'Ordren har en aktiv betaling og kan ikke avbrytes nå.', 409);
        }
        if (!isValidTransition(current.status, 'cancelled')) {
          return sendError(res, `Ugyldig statusovergang: ${current.status} → cancelled`, 409);
        }
        await assertNoActiveDispute(id);
        await assertTerminalIsMoneySafe(current, 'cancelled');
        order = await Order.findOneAndUpdate(
          { _id: id, status: current.status, checkoutSessionStatus: NO_ACTIVE_CHECKOUT },
          {
            $set: { status: 'cancelled' },
            $push: {
              history: {
                action: 'admin_cancelled',
                userId: req.user._id,
                timestamp: new Date(),
                data: { from: current.status, to: 'cancelled', reason: note },
              },
            },
          },
          { new: true }
        );
        if (!order)
          return sendError(
            res,
            'Ordren ble endret samtidig, eller har en aktiv betaling. Prøv igjen.',
            409
          );
        // An unpaid award left the listing hidden ('awaiting_payment') and its applicants declined.
        await releaseListingAfterCancel(order);
      }
    } catch (err) {
      if (err instanceof OrderTransitionError) return sendError(res, err.message, 409);
      throw err;
    }
  } else {
    order = note
      ? await Order.findByIdAndUpdate(
          id,
          {
            $push: {
              history: {
                action: 'admin_note',
                userId: req.user._id,
                timestamp: new Date(),
                data: { note },
              },
            },
          },
          { new: true }
        ).lean()
      : await Order.findById(id).lean();
    if (!order) return sendError(res, 'Ordre ikke funnet.', 404);
  }

  await logActivity({
    adminId: req.user._id,
    action: 'order_updated',
    targetModel: 'Order',
    targetId: id,
    description: `Ordre status endret til "${status ?? 'note added'}" av admin`,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return sendSuccess(res, { order }, 'Ordre oppdatert.');
});

module.exports = { getOrders, getOrderById, updateOrderStatus };
