const Transaction = require('../models/Transaction');
const User = require('../models/User');
const mongoose = require('mongoose');
const { serverError } = require('../utils/serverError');
const { parsePagination } = require('../utils/pagination');
const { escapeRegex } = require('../utils/devQuery');
// GET ALL TRANSACTIONS (FOR ADMIN)
exports.getTransactions = async (req, res) => {
  try {
    const { search, type } = req.query;
    const { limit, skip } = parsePagination(req.query, { defaultLimit: 10 });
    const searchRe =
      typeof search === 'string' && search.trim() ? escapeRegex(search.trim().slice(0, 100)) : null;
    let query = {};

    // 1. Type Filter (subscription / extra_contact)
    if (type) {
      query.type = type;
    }

    // 2. Search Logic (Email + Transaction ID)
    if (searchRe) {
      // Pehle Users collection mein search karein ke kya koi user is email se match karta hai
      const matchedUsers = await User.find({
        email: { $regex: searchRe, $options: 'i' },
      }).select('_id');

      const userIds = matchedUsers.map((user) => user._id);

      // Ab Transaction query mein check karein
      query.$or = [
        { stripeSessionId: { $regex: searchRe, $options: 'i' } }, // Search by ID
        { planName: { $regex: searchRe, $options: 'i' } }, // Search by Plan
        { userId: { $in: userIds } }, // Search by matched User IDs
      ];
    }

    const transactions = await Transaction.find(query)
      .populate('userId', 'email name') // Email populate karna zaroori hai table ke liye
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Transaction.countDocuments(query);

    res.status(200).json({
      transactions,
      totalPages: Math.ceil(total / limit),
      totalTransactions: total,
    });
  } catch (error) {
    console.error('Backend Error:', error);
    serverError(res, error);
  }
};

// GET USER TRANSACTIONS (FOR USER DASHBOARD)
exports.getUserTransactions = async (req, res) => {
  try {
    const { limit, skip } = parsePagination(req.query, { defaultLimit: 10 });
    // The job a Hast was for (title for the details row); never the Stripe session id,
    // which the admin list already leaves out.
    const transactions = await Transaction.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-stripeSessionId')
      .populate('serviceId', 'title');

    const total = await Transaction.countDocuments({ userId: req.user.id });
    res.status(200).json({
      success: true,
      transactions,
      totalPages: Math.ceil(total / Number(limit)),
      totalTransactions: total,
    });
  } catch (error) {
    serverError(res, error);
  }
};

// GET SINGLE TRANSACTION
exports.getTransactionById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid transaction ID' });
    }

    // Owner-scoped in the query itself: another user's transaction is indistinguishable
    // from a missing one (404), so ids cannot be probed. Admin policy matches requireAdmin.
    const filter = req.user.role === 'superAdmin' ? { _id: id } : { _id: id, userId: req.userId };
    const transaction = await Transaction.findOne(filter)
      .populate('userId', 'name lastName email')
      .populate('serviceId', 'title');

    if (!transaction) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }

    res.status(200).json({ success: true, transaction });
  } catch (error) {
    console.error('getTransactionById failed:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

exports.updateTransactionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // Example: { "status": "refunded" }

    // Check karein ke status valid hai ya nahi (enum ke mutabiq)
    const validStatuses = ['pending', 'succeeded', 'failed', 'refunded'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }

    // Transaction dhoondo aur update karo
    const updatedTransaction = await Transaction.findByIdAndUpdate(
      id,
      {
        status: status,
        refunded: status === 'refunded' ? true : false, // Agar status refunded hai to boolean bhi true kar do
      },
      { new: true } // Updated document wapis mangwao
    );

    if (!updatedTransaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    res.status(200).json({
      message: `Transaction status updated to ${status}`,
      transaction: updatedTransaction,
    });
  } catch (error) {
    console.error('Update Status Error:', error);
    serverError(res, error);
  }
};
