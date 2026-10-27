const mongoose = require('mongoose');

// Subschema for time entries
const timeEntrySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    hours: { type: Number, required: true, min: 0 },
    date: { type: Date, required: true },
    note: { type: String },
  },
  { timestamps: true }
);

const serviceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    description: { type: String },
    price: { type: Number, min: 0, required: true },
    hourlyRate: { type: Number, min: 0 },
    paymentType: { type: String },

    // Lokasjon
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], index: '2dsphere' },
      address: { type: String },
      // Norwegian postnummer (Kartverket), shown with the full address to the chosen provider.
      postalCode: { type: String, trim: true, match: /^\d{4}$/ },
      city: { type: String },
    },

    // Contact details from step 4 of the job form. `select: false` keeps them out
    // of every public read by default — the job listing is served unauthenticated,
    // and the poster's phone number has no business being in that payload. The
    // owner-scoped route (/api/services/my-posted) opts back in explicitly.
    contactPhone: { type: String, select: false },
    contactEmail: { type: String, select: false },

    // Norway location codes
    countyCode: { type: String, index: true },
    municipalityCode: { type: String, index: true },
    areaCode: { type: String, index: true },

    // Faktiske kategorinavn
    categories: [{ type: String, required: true }],

    // Liste over bilde-URLer (Azure URLs)
    images: [{ type: String }],

    // Utvidet metadata for bedre kontroll
    imageMetadata: [
      {
        url: String,
        blobName: String,
        // ogUrl/ogBlobName point at a 1200×630 JPEG derived from the upload, used only
        // for social share cards. Optional so older listings keep working.
        ogUrl: String,
        ogBlobName: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],

    urgent: { type: Boolean, default: false },
    promoted: { type: Boolean, default: false },
    status: {
      type: String,
      enum: [
        'open',
        'closed',
        'awaiting_payment',
        'paid',
        'in_progress',
        'completed',
        'pending',
        'waiting_for_approval',
        'cancelled',
        'expired',
        'draft',
      ],
      default: 'open',
    },
    // Short mutex around "no live order exists → create the contract order"
    // (services/order/contractLock.js). Both contract paths checked then created, so
    // two concurrent awards could produce two orders for one job.
    contractLockAt: { type: Date, default: null },

    tags: [{ type: String }],

    duration: {
      value: { type: Number, min: 0 },
      unit: {
        type: String,
        enum: ['minutes', 'hours', 'days', 'timer', 'minutter', 'dager'],
        default: 'hours',
      },
    },

    fromDate: { type: Date },
    toDate: { type: Date },

    equipment: {
      type: String,
      enum: ['utstyrfri', 'delvis utstyr', 'trengs utstyr'],
      default: 'utstyrfri',
    },

    /** "Ny annonse" choice: a private job or a job for a business (shown on the listing). */
    customerType: {
      type: String,
      enum: ['private', 'business'],
      default: 'private',
    },

    views: { type: Number, default: 0 },
    maxApplicants: { type: Number, default: 0 }, // 0 means unlimited
    // Hours and notes are for the owner and the assigned worker only (progressController
    // selects them with +timeEntries). Kept out of every other read, incl. the public detail cache.
    timeEntries: { type: [timeEntrySchema], select: false },

    // Dynamic checklist for the job
    checklist: [
      {
        id: { type: String, required: true },
        text: { type: String, required: true },
        checked: { type: Boolean, default: false },
        checkedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        checkedAt: { type: Date },
      },
    ],
  },
  { timestamps: true }
);

serviceSchema.index({ location: '2dsphere' });
serviceSchema.index({ createdAt: -1 });
// The public job list filters on status (PUBLIC_SERVICE_STATUSES) and sorts by date or price
// (utils/serviceSort.js). With only { createdAt } Mongo walked every listing — completed and
// cancelled ones included — to find the first public page. These answer it from the index.
serviceSchema.index({ status: 1, createdAt: -1 });
serviceSchema.index({ status: 1, price: 1, createdAt: -1 });
serviceSchema.index({ categories: 1, status: 1, createdAt: -1 });
serviceSchema.index({ userId: 1, createdAt: -1 }); // "my posted jobs", profile listings
// price_high sorts { price: -1, createdAt: -1 }: the index above walked backwards gives
// createdAt ascending, so Mongo sorted every public listing in memory. Same for a category
// filter with either price sort. And the "Fiks ferdig" (urgent) count fetched every public doc.
serviceSchema.index({ status: 1, price: -1, createdAt: -1 });
serviceSchema.index({ categories: 1, status: 1, price: 1, createdAt: -1 });
serviceSchema.index({ categories: 1, status: 1, price: -1, createdAt: -1 });
serviceSchema.index({ status: 1, urgent: 1, createdAt: -1 });

// Any write clears the cached public job reads (utils/cache namespace "services": list, nearby,
// detail), from whichever route or job made it. Except the view counter: it changes on every
// visit, and clearing on it would empty the cache on each page view.
// `timestamps` adds `$set: { updatedAt }` and `$setOnInsert: { createdAt }` to every update.
const TIMESTAMP_OPS = { $set: 'updatedAt', $setOnInsert: 'createdAt' };
const isViewCountOnly = (update) =>
  !!update &&
  Object.keys(update.$inc || {}).join() === 'views' &&
  Object.keys(update).every((op) => op === '$inc' || Object.keys(update[op]).join() === TIMESTAMP_OPS[op]);
for (const op of ['save', 'findOneAndUpdate', 'findOneAndDelete', 'deleteOne', 'deleteMany', 'updateOne', 'updateMany', 'insertMany']) {
  serviceSchema.post(op, function clearServiceCache() {
    if (typeof this?.getUpdate === 'function' && isViewCountOnly(this.getUpdate())) return;
    void require('../utils/cache').invalidate('services');
  });
}

module.exports = mongoose.model('Service', serviceSchema);
