const mongoose = require('mongoose');

/**
 * Support requests from the Kundesenter form.
 *
 * The form used to call nothing and then report "Saken din er sendt", so
 * customers with a payment or dispute problem believed they had reached support
 * and waited. This gives the message somewhere to actually land.
 */
const supportTicketSchema = new mongoose.Schema(
  {
    // Null for logged-out visitors — they supply an e-mail instead.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    email: { type: String, required: true, trim: true, lowercase: true },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    message: { type: String, required: true, trim: true, maxlength: 5000 },
    status: {
      type: String,
      enum: ['open', 'in_progress', 'resolved', 'closed'],
      default: 'open',
      index: true,
    },
    // 'bug': a "Rapporter en feil" report from the web or the app, with the page it was sent
    // from, the reporter's screenshots (private container) and the device.
    kind: { type: String, enum: ['support', 'bug'], default: 'support', index: true },
    pageUrl: { type: String, trim: true, maxlength: 2000, default: null },
    screenshots: { type: [String], default: [] },
    client: {
      _id: false,
      platform: { type: String, enum: ['web', 'ios', 'android'] },
      appVersion: { type: String, trim: true, maxlength: 40 },
      userAgent: { type: String, trim: true, maxlength: 500 },
      screen: { type: String, trim: true, maxlength: 40 },
    },
    // Set when the request arrives from a specific order, so support has context.
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },

    // Technical triage (developer dashboard). Customer-facing fields above are unchanged.
    priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    escalated: { type: Boolean, default: false },
    relatedErrorRef: { type: String, default: null }, // ErrorLog referenceId
    incidentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident', default: null },
    resolvedAt: { type: Date, default: null },
    history: [
      {
        _id: false,
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        kind: { type: String, enum: ['note', 'status', 'priority', 'assign', 'escalate', 'link'] },
        text: { type: String, maxlength: 2000 },
        internal: { type: Boolean, default: true },
      },
    ],
  },
  { timestamps: true }
);

supportTicketSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
