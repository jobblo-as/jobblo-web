const Favorite = require('../models/Favorite');
const Service = require('../models/Service');
const mongoose = require('mongoose');
const { serverError } = require('../utils/serverError');
const { parsePagination } = require('../utils/pagination');
const { PUBLIC_SERVICE_STATUSES, isPubliclyVisible } = require('../constants/serviceVisibility');

// Helper function for ObjectId validation
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// ------------------------------------
// GET FAVORITES
// ------------------------------------
exports.getFavorites = async (req, res) => {
  try {
    const userId = req.userId; // Always authenticated user

    // Clients render the whole list, so the page is generous — but no longer unbounded.
    const { limit, skip } = parsePagination(req.query, { defaultLimit: 100 });
    const favorites = await Favorite.find({ user: userId })
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit)
      // A favourite must not become a way to read a listing once it leaves the public
      // set (draft, awaiting_payment, completed...): only public ones, or the caller's own.
      .populate({
        path: 'service',
        match: { $or: [{ status: { $in: PUBLIC_SERVICE_STATUSES } }, { userId }] },
      })
      .populate('user', 'name avatarUrl');
    const visible = favorites.filter((f) => f.service); // clients read fav.service._id

    return res.json({
      success: true,
      count: visible.length,
      data: visible,
    });
  } catch (error) {
    console.error('GET FAVORITES ERROR:', error);
    return serverError(res, error);
  }
};

// ------------------------------------
// ADD FAVORITE
// ------------------------------------
exports.addFavorite = async (req, res) => {
  try {
    const userId = req.userId; // Always authenticated user
    const { serviceId } = req.params;

    if (!isValidId(serviceId)) {
      return res.status(400).json({ error: 'Invalid service ID format' });
    }

    // Check service exists
    const service = await Service.findById(serviceId);
    // Non-public listings are not confirmed to strangers (same 404 as browse/getServiceById).
    if (!service || (!isPubliclyVisible(service) && String(service.userId) !== String(userId))) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Prevent duplicates
    const existing = await Favorite.findOne({ user: userId, service: serviceId });
    if (existing) {
      return res.status(400).json({ error: 'Already favorited' });
    }

    // Create favorite
    const favorite = await Favorite.create({ user: userId, service: serviceId });
    const populated = await favorite.populate('service user', 'name avatarUrl');

    return res.status(201).json({
      success: true,
      message: 'Favorite added',
      data: populated,
    });
  } catch (error) {
    console.error('ADD FAVORITE ERROR:', error);
    return serverError(res, error);
  }
};

// ------------------------------------
// REMOVE FAVORITE
// ------------------------------------
exports.removeFavorite = async (req, res) => {
  try {
    const userId = req.userId; // Always authenticated user
    const { serviceId } = req.params;

    if (!isValidId(serviceId)) {
      return res.status(400).json({ error: 'Invalid service ID format' });
    }

    const deleted = await Favorite.findOneAndDelete({
      user: userId,
      service: serviceId,
    });

    if (!deleted) {
      return res.status(404).json({ error: 'Favorite not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Favorite removed',
    });
  } catch (error) {
    console.error('REMOVE FAVORITE ERROR:', error);
    return serverError(res, error);
  }
};
