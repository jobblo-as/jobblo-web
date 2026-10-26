const mongoose = require('mongoose');

const favoriteSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  },
  { timestamps: true }
);

// "My favorites" and the already-favorited check; both were collection scans.
// Not unique: Cosmos cannot add a unique index to a non-empty collection.
favoriteSchema.index({ user: 1, service: 1 });

module.exports = mongoose.model('Favorite', favoriteSchema);
