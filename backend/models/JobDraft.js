const mongoose = require('mongoose');

/**
 * An unpublished job form, saved as the poster types ("Dine utkast"). Not a Service: a draft
 * may lack everything a Service requires, and it must never reach a public query.
 * `data` is the form state as JSON text, read back only by its owner.
 */
const jobDraftSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, default: '', maxlength: 200 },
    data: { type: String, required: true, maxlength: 32000 },
    // Photos uploaded for this draft (POST /api/job-drafts/:id/images), so the draft keeps its
    // pictures on every device. Server-written only: publishing trusts these, never `data`.
    images: [{ _id: false, url: String, blobName: String, ogUrl: String, ogBlobName: String }],
  },
  { timestamps: true }
);

// Abandoned drafts go away on their own after 90 days without an edit.
jobDraftSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

module.exports = mongoose.model('JobDraft', jobDraftSchema);
