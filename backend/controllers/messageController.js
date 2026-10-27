const Message = require('../models/Message');
const Notification = require('../models/Notification');
const notificationController = require('./notificationController');
const Order = require('../models/Order');
const User = require('../models/User');
const mongoose = require('mongoose');
const { serverError } = require('../utils/serverError');
const { parsePagination } = require('../utils/pagination');

// Helper to validate ObjectId
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const isUserRelatedToOrder = ({ userId, order }) => {
  return order.customerId.toString() === userId || order.providerId.toString() === userId;
};

const canAccessMessage = ({ userId, order, message }) => {
  return (
    message.senderId.toString() === userId ||
    order.customerId.toString() === userId ||
    order.providerId.toString() === userId
  );
};

/**
 * GET /api/messages
 * Hent alle meldinger relatert til brukerens ordre
 */
exports.getAllMessages = async (req, res) => {
  try {
    const userId = req.userId;

    const orders = await Order.find({
      $or: [{ customerId: userId }, { providerId: userId }],
    })
      .select('_id')
      .lean();

    const orderIds = orders.map((o) => o._id);

    const { skip, limit } = parsePagination(req.query, { defaultLimit: 100 });
    const messages = await Message.find({
      orderId: { $in: orderIds },
      deletedFor: { $ne: userId },
    })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .populate('senderId', 'name avatarUrl')
      .populate('orderId', 'serviceId customerId providerId status');

    res.json(messages);
  } catch (error) {
    serverError(res, error);
  }
};

/**
 * GET /api/messages/order/:orderId
 * Hent meldinger for én ordre
 */
exports.getMessagesForOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!isValidId(orderId)) {
      return res.status(400).json({ error: 'Invalid order ID format' });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (!isUserRelatedToOrder({ userId: req.userId, order }))
      return res.status(403).json({ error: 'Not authorized' });

    const { skip, limit } = parsePagination(req.query, { defaultLimit: 100 });
    const messages = await Message.find({
      orderId,
      deletedFor: { $ne: req.userId },
    })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .populate('senderId', 'name avatarUrl');

    res.json(messages);
  } catch (error) {
    serverError(res, error);
  }
};

/**
 * GET /api/messages/:id
 */
exports.getMessageById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ error: 'Invalid message ID format' });
    }

    const message = await Message.findById(id)
      .populate('senderId', 'name avatarUrl')
      .populate('orderId', 'serviceId customerId providerId status');

    if (!message) return res.status(404).json({ error: 'Message not found' });

    const order = message.orderId;

    if (!canAccessMessage({ userId: req.userId, order: message.orderId, message })) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (message.deletedFor.includes(req.userId)) {
      return res.status(404).json({ error: 'Message deleted' });
    }

    res.json(message);
  } catch (error) {
    serverError(res, error);
  }
};

/**
 * PATCH /api/messages/:id/read
 */
exports.markAsRead = async (req, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;

    if (!isValidId(id)) return res.status(400).json({ error: 'Invalid message ID format' });

    const message = await Message.findById(id);
    if (!message) return res.status(404).json({ error: 'Message not found' });

    // Any user could mark any order message as read. Only a party to its order may.
    const order =
      message.orderId && (await Order.findById(message.orderId).select('customerId providerId'));
    if (!order || !isUserRelatedToOrder({ userId: req.userId, order })) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Check if already read
    const alreadyRead =
      Array.isArray(message.readReceipts) &&
      message.readReceipts.some((r) => r.userId && r.userId.toString() === req.userId);

    if (alreadyRead) {
      return res.status(200).json({ success: true, message: 'Message already marked as read' });
    }

    // Mark as read
    message.readReceipts.push({ userId: req.userId, readAt: Date.now() });
    await message.save();

    res.json({ success: true, message: 'Message marked as read' });
  } catch (err) {
    serverError(res, err);
  }
};

/**
 * PATCH /api/messages/order/:orderId/read
 */
exports.markOrderMessagesAsRead = async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!isValidId(orderId)) return res.status(400).json({ error: 'Invalid order ID format' });

    // No authorization at all: any authenticated user could stamp read receipts on any
    // order's messages — fabricating "the customer read this" records that dispute
    // resolution relies on, and growing readReceipts without bound on a conversation
    // they have nothing to do with. The same helper the read endpoints already use.
    const order = await Order.findById(orderId).select('customerId providerId');
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!isUserRelatedToOrder({ userId: req.userId, order })) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await Message.updateMany(
      {
        orderId,
        'readReceipts.userId': { $ne: req.userId },
      },
      { $push: { readReceipts: { userId: req.userId, readAt: new Date() } } }
    );

    res.json({ success: true });
  } catch (err) {
    serverError(res, err);
  }
};

/**
 * PATCH /api/messages/:id/delete-for-me
 */
exports.deleteForMe = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) return res.status(400).json({ error: 'Invalid message ID format' });

    // Same missing check as markOrderMessagesAsRead: anyone could append themselves to
    // any message's `deletedFor`. Only a party to the message's order may hide it.
    const message = await Message.findById(id).select('orderId');
    if (!message) return res.status(404).json({ error: 'Message not found' });

    const order = await Order.findById(message.orderId).select('customerId providerId');
    if (!order || !isUserRelatedToOrder({ userId: req.userId, order })) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await Message.findByIdAndUpdate(id, {
      $addToSet: { deletedFor: req.userId },
    });

    res.json({ success: true, message: 'Message hidden' });
  } catch (err) {
    serverError(res, err);
  }
};

/**
 * DELETE /api/messages/:id
 * Hides the sender's own message for the sender. It used to hard-delete it, even while the
 * order was in dispute, so the sender could remove evidence the other party relies on.
 */
exports.deleteMessage = async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;

    if (!isValidId(id)) return res.status(400).json({ error: 'Invalid message ID format' });

    const message = await Message.findById(id);
    if (!message) return res.status(404).json({ error: 'Message not found' });

    if (message.senderId.toString() !== req.userId)
      return res.status(403).json({ error: 'Not allowed' });

    await Message.updateOne({ _id: id }, { $addToSet: { deletedFor: req.userId } });

    res.status(204).end();
  } catch (error) {
    serverError(res, error);
  }
};
