const UpcomingFeature = require('../models/UpcomingFeature');
const { serverError, inputOrServerError } = require('../utils/serverError');

// Get all features
exports.getAllFeatures = async (req, res) => {
  try {
    const features = await UpcomingFeature.find().sort({ createdAt: -1 });
    res.json(features);
  } catch (err) {
    serverError(res, err);
  }
};

// Create a new feature (Admin only usually, but for now open or protected by middleware)
exports.createFeature = async (req, res) => {
  try {
    const feature = new UpcomingFeature(req.body);
    await feature.save();
    res.status(201).json(feature);
  } catch (err) {
    inputOrServerError(res, err);
  }
};

// Update a feature
exports.updateFeature = async (req, res) => {
  try {
    const { id } = req.params;
    const feature = await UpcomingFeature.findByIdAndUpdate(id, req.body, { new: true });
    if (!feature) return res.status(404).json({ error: 'Feature not found' });
    res.json(feature);
  } catch (err) {
    inputOrServerError(res, err);
  }
};

// Delete a feature
exports.deleteFeature = async (req, res) => {
  try {
    const { id } = req.params;
    const feature = await UpcomingFeature.findByIdAndDelete(id);
    if (!feature) return res.status(404).json({ error: 'Feature not found' });
    res.json({ message: 'Feature deleted' });
  } catch (err) {
    serverError(res, err);
  }
};
