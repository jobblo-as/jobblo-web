const mongoose = require('mongoose');

/**
 * A saved renovation plan ("Mine oppussingsplaner"). Only the user's choices are stored;
 * the estimate is recomputed from the current pricing config whenever it is shown, so a
 * rate change reaches old plans. `shareId` is set only while the owner shares the plan: the
 * public link is /oppussingskalkulator/delt/<shareId>, read-only and without the owner.
 */
const renovationPlanSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, default: 'Min oppussingsplan', maxlength: 120 },
    // The normalised plan from services/renovation/estimate.parsePlan (never the raw body).
    plan: {
      facts: { sizeM2: Number, rooms: Number, bathrooms: Number },
      quality: String,
      areas: [{ _id: false, key: String, scope: String, quality: String }],
      budget: Number,
    },
    yearBuilt: Number,
    homeType: String, // one of estimate.HOME_TYPES, checked on save
    notes: [{ _id: false, area: String, text: { type: String, maxlength: 160 } }],
    finnCode: { type: String, maxlength: 12 },
    shareId: { type: String, unique: true, sparse: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RenovationPlan', renovationPlanSchema);
