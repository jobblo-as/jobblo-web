const mongoose = require('mongoose');

/**
 * One finding of a risk rule (services/security/risk), kept so it can be investigated: what
 * fired, why (evidence), on which installation / accounts / IPs, since when, and what a
 * developer decided. One alert per rule and installation (dedupeKey): the rule firing again
 * updates lastSeen and count instead of opening a second one.
 *
 * Statuses: open → investigating → resolved | false_positive | escalated (a FraudCase was
 * opened for the accounts). A resolved alert that fires again is reopened; a false positive
 * stays closed (only its lastSeen moves). Closed alerts are removed a year after closing.
 */
const evidenceSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, maxlength: 300 },
    at: { type: Date, default: null },
    /** What the line points at, for the dashboard to link: { type: 'ip'|'user'|'event', id }. */
    ref: { type: { type: String }, id: String },
  },
  { _id: false }
);

const noteSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null = system
    text: { type: String, required: true, maxlength: 1000 },
    status: { type: String, default: null },
  },
  { _id: false }
);

const securityAlertSchema = new mongoose.Schema(
  {
    dedupeKey: { type: String, required: true, unique: true },
    ruleId: { type: String, required: true },
    title: { type: String, required: true, maxlength: 200 },
    summary: { type: String, default: null, maxlength: 500 },
    severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], required: true },
    /** How sure the association is: confirmed > likely > possible. Never "proof". */
    confidence: { type: String, enum: ['confirmed', 'likely', 'possible'], required: true },
    weight: { type: Number, default: 0 },
    deviceKey: { type: String, default: null },
    userIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    ips: { type: [String], default: [] },
    evidence: { type: [evidenceSchema], default: [] },
    firstSeen: { type: Date, required: true },
    lastSeen: { type: Date, required: true },
    count: { type: Number, default: 1 },
    status: {
      type: String,
      enum: ['open', 'investigating', 'resolved', 'false_positive', 'escalated'],
      default: 'open',
    },
    notes: { type: [noteSchema], default: [] },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

securityAlertSchema.index({ status: 1, lastSeen: -1 });
securityAlertSchema.index({ deviceKey: 1, status: 1 });
securityAlertSchema.index({ userIds: 1, lastSeen: -1 });
securityAlertSchema.index({ ruleId: 1, lastSeen: -1 });
securityAlertSchema.index({ severity: 1, lastSeen: -1 });
// TTL only applies once closedAt is set: open alerts never expire.
securityAlertSchema.index({ closedAt: 1 }, { expireAfterSeconds: 365 * 24 * 3600 });

module.exports = mongoose.model('SecurityAlert', securityAlertSchema);
