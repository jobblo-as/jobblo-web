const Order = require('../../models/Order');
const Service = require('../../models/Service');
const JobRequest = require('../../models/JobRequest');
const Chat = require('../../models/ChatMessage');

const LIVE_ORDER_STATUSES = ['awaiting_payment', 'paid', 'in_progress', 'ready_for_review', 'disputed'];

/**
 * After an unpaid award is cancelled (abandoned checkout, admin cancel): mark its chat
 * cancelled and, when no other live order holds the service, put the listing back on the
 * market and give the applicants that award auto-declined their applications back.
 *
 * Awarding sets Service.status 'awaiting_payment' and nothing else ever set it back, so a
 * cancelled award hid the job from search for good. Withdrawn and owner-declined
 * applications are never touched. Returns true when the listing was reopened.
 */
async function releaseListingAfterCancel(order) {
  if (order.chatId) {
    await Chat.updateOne({ _id: order.chatId }, { $set: { status: 'cancelled' } }).catch((err) =>
      console.error('releaseListingAfterCancel: chat status sync failed: %s', err.message)
    );
  }

  const stillHeld = await Order.findOne({
    serviceId: order.serviceId,
    _id: { $ne: order._id },
    status: { $in: LIVE_ORDER_STATUSES },
  }).select('_id');
  if (stillHeld) return false;

  const service = await Service.findOneAndUpdate(
    { _id: order.serviceId, status: 'awaiting_payment' },
    { $set: { status: 'open' } }
  );
  if (!service) return false;

  const declined = await JobRequest.find({
    serviceId: order.serviceId,
    status: 'declined',
    autoDeclinedByOrderId: order._id,
    withdrawnAt: null,
  }).select('_id');
  // Row by row: the applicant may have re-applied meanwhile, and the partial unique index
  // (one pending per applicant per job) then refuses this row. That one stays declined.
  for (const { _id } of declined) {
    await JobRequest.updateOne(
      { _id, status: 'declined' },
      { $set: { status: 'pending', autoDeclinedByOrderId: null } }
    ).catch((err) => {
      if (err.code !== 11000) throw err;
    });
  }
  return true;
}

/**
 * The chat's contract, if it is still one. A cancelled or declined order leaves
 * chat.orderId pointing at it, and treating that as "contract exists" blocked a new
 * contract (400) and price changes (409) in that chat forever. Accepts a populated or
 * plain orderId; returns the order id or null.
 */
async function liveContractOrderId(chat) {
  const ref = chat?.orderId;
  if (!ref) return null;
  const id = ref._id || ref;
  const status = ref.status ?? (await Order.findById(id).select('status').lean())?.status;
  return status && !['cancelled', 'declined'].includes(status) ? id : null;
}

module.exports = { releaseListingAfterCancel, liveContractOrderId, LIVE_ORDER_STATUSES };
