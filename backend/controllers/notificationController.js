const Notification = require('../models/Notification');
const User = require('../models/User');
const mongoose = require('mongoose');
const { notify, broadcast, unreadQuery, forViewer } = require('../services/notifications');
const { serverError } = require('../utils/serverError');
const { parsePagination } = require('../utils/pagination');

// GET /api/notifications - Get all notifications for a user
exports.getAllNotifications = async (req, res) => {
  try {
    const userId = req.userId; // Use req.userId set by auth middleware
    const { type } = req.query;
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 5 });

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Filter criteria
    const query = {
      $or: [{ userId: userId }, { userId: null, isSystem: true }],
    };

    // Add type filter if provided
    if (type && type !== 'all') {
      query.type = type;
    }

    // 1. Get total count for frontend pagination controls
    const total = await Notification.countDocuments(query);

    // 2. Fetch paginated notifications
    // A broadcast's `readBy` holds every user who ever read it; never load it per tray.
    const notifications = await Notification.find(query)
      .select('-readBy')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('userId', 'name email')
      .populate('senderId', 'name lastName avatarUrl')
      .populate('orderId')
      .populate('requestId')
      .lean();

    // Only whether THIS viewer read each broadcast on the page.
    // ponytail: readBy still grows unbounded on the document; a per-user read-receipt
    // collection (notificationId, userId) is the upgrade.
    const broadcastIds = notifications.filter((n) => !n.userId).map((n) => n._id);
    const readIds = new Set(
      broadcastIds.length
        ? (
            await Notification.find({ _id: { $in: broadcastIds }, readBy: userId })
              .select('_id')
              .lean()
          ).map((n) => String(n._id))
        : []
    );

    // Response format with metadata
    res.json({
      success: true,
      total,
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / limit),
      data: notifications.map((n) =>
        forViewer({ ...n, readBy: readIds.has(String(n._id)) ? [userId] : [] }, userId)
      ),
    });
  } catch (error) {
    serverError(res, error);
  }
};

// PUT /api/notifications/:id/read - Mark notification as read
exports.markAsRead = async (req, res) => {
  try {
    const notificationId = req.params.id;

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      return res.status(400).json({ error: 'Invalid notification ID format' });
    }

    // Check if notification exists
    const notification = await Notification.findById(notificationId);
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    // (F-53) Ownership. This previously did findById then findByIdAndUpdate with no
    // comparison at all, so any authenticated user could mark any other user's
    // notification as read. `userId` is null on system broadcasts, which are addressed
    // to everyone and stay allowed.
    if (notification.userId && String(notification.userId) !== String(req.userId)) {
      return res.status(403).json({ error: 'Ikke tilgang til dette varselet.' });
    }

    // Update notification to be read. A broadcast is shared, so only the caller's
    // `readBy` entry changes — `read: true` here marked it read for every user.
    const updatedNotification = await Notification.findByIdAndUpdate(
      notificationId,
      notification.userId ? { read: true } : { $addToSet: { readBy: req.userId } },
      { new: true }
    )
      .populate('userId', 'name email')
      .populate('senderId', 'name lastName avatarUrl')
      .populate('orderId')
      .populate('requestId')
      .lean();

    res.json(updatedNotification && forViewer(updatedNotification, req.userId));
  } catch (error) {
    serverError(res, error);
  }
};

// PUT /api/notifications/read-all - Mark all notifications as read for a user
exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.userId; // Use req.userId set by auth middleware

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    await Notification.updateMany({ userId, read: false }, { $set: { read: true } });
    await Notification.updateMany(
      { userId: null, isSystem: true, readBy: { $ne: userId } },
      { $addToSet: { readBy: userId } }
    );

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    serverError(res, error);
  }
};

// DELETE /api/notifications/:id - Delete a notification
exports.deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid notification ID' });
    }

    // (F-53) Ownership. This previously deleted by id with no check, so any
    // authenticated user could delete any other user's notifications.
    const notification = await Notification.findById(id);
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    if (!notification.userId) {
      // A system broadcast is one shared document; deleting it would remove the
      // admin's announcement for every user. Per-user dismissal would need a
      // `deletedFor` array on the model — tracked separately, see B2C-FIXLOG.
      return res.status(403).json({ error: 'Systemvarsler kan ikke slettes.' });
    }

    if (String(notification.userId) !== String(req.userId)) {
      return res.status(403).json({ error: 'Ikke tilgang til dette varselet.' });
    }

    await Notification.findByIdAndDelete(id);

    res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    serverError(res, error);
  }
};

// DELETE /api/notifications/delete-all - Delete all notifications for a user
exports.deleteAllNotifications = async (req, res) => {
  try {
    const userId = req.userId; // Use req.userId set by auth middleware

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    await Notification.deleteMany({ userId });

    res.json({ success: true, message: 'All notifications deleted' });
  } catch (error) {
    serverError(res, error);
  }
};

// GET /api/notifications/unread-count - Get unread count for a user
exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.userId; // Use req.userId set by auth middleware

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const count = await Notification.countDocuments(unreadQuery(userId));

    res.json({ count });
  } catch (error) {
    serverError(res, error);
  }
};

/**
 * Kept as a thin wrapper so the two callers that still use it (messages, favourites)
 * keep working. All it does now is forward to `services/notifications`, which is the
 * single place that creates and delivers. The `io` argument is ignored — the service
 * resolves the socket server itself.
 */
exports.createAndEmitNotification = async (_io, data) => notify(data);

// POST /api/notifications/test - Create test notification
exports.createTestNotification = async (req, res) => {
  try {
    const { type, content } = req.body;
    const io = req.app.get('io');

    // (F-53) The route was unauthenticated and took the recipient from the body, so
    // anyone on the internet could inject notifications into any user's tray — a ready
    // phishing surface inside the product's own UI. It is now authenticated and can
    // only ever target the caller.
    const userId = req.userId;

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Create test notification
    const testNotification = await exports.createAndEmitNotification(io, {
      userId,
      type: type || 'alert',
      content: content || 'Dette er en test-notifikasjon fra Jobblo API',
    });

    res.status(201).json(testNotification);
  } catch (error) {
    serverError(res, error);
  }
};

// POST /api/notifications/system - Create system notification for all users (admin only)
exports.createSystemNotification = async (req, res) => {
  try {
    const { type, content } = req.body;
    const io = req.app.get('io');

    if (!type || !content) {
      return res.status(400).json({ error: 'Type & content required' });
    }

    const notification = await broadcast({ type, content });

    res.status(201).json({
      success: true,
      message: 'System notification created',
      data: notification,
    });
  } catch (error) {
    serverError(res, error);
  }
};
