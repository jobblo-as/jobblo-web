const Service = require('../../models/Service');
const {
  asyncHandler,
  sendSuccess,
  sendError,
  buildPagination,
} = require('../../utils/apiResponse');
const { parsePagination, parseObjectId, parseSort, parseDate } = require('../../utils/pagination');
const { logActivity } = require('../../services/admin/activityService');
const { queryString } = require('../../utils/devQuery');

const SORT_FIELDS = ['createdAt', 'updatedAt', 'price', 'title', 'views'];
const VALID_STATUSES = [
  'open',
  'closed',
  'in_progress',
  'completed',
  'pending',
  'waiting_for_approval',
  'cancelled',
  'expired',
  'draft',
];

/**
 * GET /api/admin/services
 */
const getServices = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const sort = parseSort(req.query.sortBy, req.query.sortOrder, SORT_FIELDS, 'createdAt');

  const query = {};

  if (req.query.search) {
    const esc = queryString(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = [
      { title: { $regex: esc, $options: 'i' } },
      { description: { $regex: esc, $options: 'i' } },
    ];
  }
  if (req.query.status && VALID_STATUSES.includes(req.query.status)) {
    query.status = req.query.status;
  }
  if (req.query.category) {
    query.categories = { $in: [req.query.category] };
  }
  const dateFrom = parseDate(req.query.dateFrom);
  const dateTo = parseDate(req.query.dateTo);
  if (dateFrom || dateTo) {
    query.createdAt = {};
    if (dateFrom) query.createdAt.$gte = dateFrom;
    if (dateTo) query.createdAt.$lte = new Date(dateTo.setHours(23, 59, 59, 999));
  }

  const [total, services] = await Promise.all([
    Service.countDocuments(query),
    Service.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .select('-checklist -timeEntries -imageMetadata')
      .populate('userId', 'name email avatarUrl role')
      .lean(),
  ]);

  return sendSuccess(res, { services }, 'Tjenester hentet.', buildPagination(total, page, limit));
});

/**
 * GET /api/admin/services/:id
 */
const getServiceById = asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.id);
  if (!id) return sendError(res, 'Ugyldig tjeneste-ID.', 400);

  const service = await Service.findById(id)
    .populate('userId', 'name email avatarUrl phone role subscription')
    .lean();

  if (!service) return sendError(res, 'Tjeneste ikke funnet.', 404);
  return sendSuccess(res, { service });
});

/**
 * PUT /api/admin/services/:id/status
 */
const updateServiceStatus = asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.id);
  if (!id) return sendError(res, 'Ugyldig tjeneste-ID.', 400);

  const { status } = req.body;
  if (!status || !VALID_STATUSES.includes(status)) {
    return sendError(res, `Ugyldig status. Tillatte: ${VALID_STATUSES.join(', ')}.`, 400);
  }

  const service = await Service.findByIdAndUpdate(id, { status }, { new: true }).lean();
  if (!service) return sendError(res, 'Tjeneste ikke funnet.', 404);

  await logActivity({
    adminId: req.user._id,
    action: 'service_activated',
    targetModel: 'Service',
    targetId: id,
    description: `Tjeneste status satt til "${status}": ${service.title}`,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return sendSuccess(res, { service }, 'Tjenestestatus oppdatert.');
});

/**
 * DELETE /api/admin/services/:id
 */
const deleteService = asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.id);
  if (!id) return sendError(res, 'Ugyldig tjeneste-ID.', 400);

  const service = await Service.findById(id);
  if (!service) return sendError(res, 'Tjeneste ikke funnet.', 404);

  await service.deleteOne();

  // Listing metadata may have been client-forged in the past; deleteListingImage only
  // removes blobs it can verify belong to this listing alone.
  const { deleteListingImage } = require('../../utils/azureUpload');
  for (const meta of service.imageMetadata || []) await deleteListingImage(meta, service._id);

  await logActivity({
    adminId: req.user._id,
    action: 'service_deleted',
    targetModel: 'Service',
    targetId: id,
    description: `Tjeneste slettet: ${service.title}`,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return sendSuccess(res, {}, 'Tjeneste slettet.');
});

/**
 * PUT /api/admin/services/:id
 * Full content edit — admin bypasses ownership & lifecycle guards.
 * Accepts both JSON and multipart/form-data (same as the user-facing edit).
 */
const updateService = asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.id);
  if (!id) return sendError(res, 'Ugyldig tjeneste-ID.', 400);

  const service = await Service.findById(id);
  if (!service) return sendError(res, 'Tjeneste ikke funnet.', 404);

  const b = req.body;

  // ── Scalar fields ──────────────────────────────────────────────────────────
  const EDITABLE = [
    'title',
    'description',
    'paymentType',
    'equipment',
    'status',
    'urgent',
    'promoted',
    'countyCode',
    'municipalityCode',
    'areaCode',
  ];
  for (const field of EDITABLE) {
    if (b[field] !== undefined) service[field] = b[field];
  }
  if (b.price !== undefined) service.price = Number(b.price);
  if (b.hourlyRate !== undefined) service.hourlyRate = Number(b.hourlyRate);
  if (b.maxApplicants !== undefined) service.maxApplicants = Number(b.maxApplicants);
  if (b.fromDate !== undefined) service.fromDate = b.fromDate || null;
  if (b.toDate !== undefined) service.toDate = b.toDate || null;

  // ── Arrays (FormData sends repeated keys; JSON sends real arrays) ──────────
  if (b.categories !== undefined) {
    service.categories = Array.isArray(b.categories) ? b.categories : [b.categories];
  }
  if (b.tags !== undefined) {
    service.tags = Array.isArray(b.tags) ? b.tags : [b.tags];
  }

  // ── Duration ──────────────────────────────────────────────────────────────
  if (b['duration[value]'] !== undefined || b['duration[unit]'] !== undefined) {
    service.duration = {
      value: Number(b['duration[value]'] ?? service.duration?.value ?? 0),
      unit: b['duration[unit]'] ?? service.duration?.unit ?? 'hours',
    };
  } else if (b.duration) {
    service.duration = b.duration;
  }

  // ── Location (supports both nested object and bracket notation) ───────────
  const locAddress = b['location[address]'] ?? b.location?.address;
  const locCity = b['location[city]'] ?? b.location?.city;
  const locLng = b['location[coordinates][0]'] ?? b.location?.coordinates?.[0];
  const locLat = b['location[coordinates][1]'] ?? b.location?.coordinates?.[1];
  if (locAddress !== undefined || locCity !== undefined || locLng !== undefined) {
    const existing = service.location?.toObject?.() ?? service.location ?? {};
    service.location = {
      ...existing,
      type: 'Point',
      ...(locAddress !== undefined && { address: locAddress }),
      ...(locCity !== undefined && { city: locCity }),
      ...(locLng !== undefined &&
        locLat !== undefined && {
          coordinates: [Number(locLng), Number(locLat)],
        }),
    };
  }

  // ── Contact fields ─────────────────────────────────────────────────────────
  if (b.contactPhone !== undefined) service.contactPhone = b.contactPhone;
  if (b.contactEmail !== undefined) service.contactEmail = b.contactEmail;

  // ── Checklist ──────────────────────────────────────────────────────────────
  if (b.checklist) {
    try {
      const parsed = typeof b.checklist === 'string' ? JSON.parse(b.checklist) : b.checklist;
      service.checklist = parsed.map((item) => {
        const existing = service.checklist.find((c) => c.id === item.id);
        return {
          id: item.id,
          text: item.text,
          checked: existing?.checked ?? false,
          checkedBy: existing?.checkedBy ?? null,
          checkedAt: existing?.checkedAt ?? null,
        };
      });
    } catch {
      /* ignore bad checklist — don't block the save */
    }
  }

  // ── Image deletion ─────────────────────────────────────────────────────────
  const removedImageMetadata = [];
  if (b.imagesToDelete) {
    const toDelete = Array.isArray(b.imagesToDelete) ? b.imagesToDelete : [b.imagesToDelete];
    for (const url of toDelete) {
      if (typeof url !== 'string') continue;
      removedImageMetadata.push(...service.imageMetadata.filter((m) => m.url === url));
      service.images = service.images.filter((u) => u !== url);
      service.imageMetadata = service.imageMetadata.filter((m) => m.url !== url);
    }
  }

  // ── New image uploads (via multer, same as user route) ────────────────────
  if (req.files?.length) {
    service.images.push(...req.files.map((f) => f.path));
    service.imageMetadata.push(
      ...req.files.map((f) => ({
        url: f.path,
        blobName: f.filename,
        ogUrl: f.ogPath,
        ogBlobName: f.ogFilename,
        uploadedAt: new Date(),
      }))
    );
  }

  await service.save();

  // After the save, and verified per blob (see deleteListingImage).
  const { deleteListingImage } = require('../../utils/azureUpload');
  for (const meta of removedImageMetadata) await deleteListingImage(meta, service._id);

  await logActivity({
    adminId: req.user._id,
    action: 'service_updated',
    targetModel: 'Service',
    targetId: id,
    description: `Tjeneste redigert av admin: ${service.title}`,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return sendSuccess(res, { service }, 'Tjeneste oppdatert.');
});

/**
 * GET /api/admin/services/:id/activity
 * Everything that happened on one job, for the admin detail page: who applied, the awards
 * (orders) with their payment and payout, Hast / extra-contact purchases, reviews, reports and
 * a single timeline. Each order links to /dashboard/orders/:id for the full money lifecycle.
 * Only display fields are selected — no Stripe secrets, URLs or contact details of applicants.
 */
const PERSON = 'name lastName email avatarUrl role';
const getServiceActivity = asyncHandler(async (req, res) => {
  const id = parseObjectId(req.params.id);
  if (!id) return sendError(res, 'Ugyldig tjeneste-ID.', 400);
  const m = (name) => require(`../../models/${name}`);

  const service = await Service.findById(id)
    .select(
      'title status price hourlyRate paymentType categories images location createdAt updatedAt userId urgent'
    )
    .populate('userId', PERSON)
    .lean();
  if (!service) return sendError(res, 'Tjeneste ikke funnet.', 404);

  const [
    requests,
    orders,
    payouts,
    safePay,
    urgent,
    extraContacts,
    reviews,
    reports,
    favorites,
    disputes,
  ] = await Promise.all([
    m('JobRequest')
      .find({ serviceId: id })
      .select('providerId status message withdrawnAt createdAt updatedAt')
      .populate('providerId', PERSON)
      .sort({ createdAt: 1 })
      .lean(),
    m('Order')
      .find({ serviceId: id })
      .select(
        'customerId providerId status paymentStatus initialPrice agreedPrice price paymentConfirmedAt startedAt readyForReviewAt completedAt cancellationReason createdAt updatedAt'
      )
      .populate('providerId', PERSON)
      .populate('customerId', PERSON)
      .sort({ createdAt: 1 })
      .lean(),
    m('Payout')
      .find({ serviceId: id })
      .select(
        'orderId providerId status grossAmount platformFee netProviderAmount currency transferCompletedAt failureReason createdAt'
      )
      .lean(),
    m('SafePayHistory')
      .find({ serviceId: id })
      .select('orderId status amounts paymentDate refundStatus refundCompletedAt createdAt')
      .lean(),
    m('UrgentPurchase')
      .find({ serviceId: id })
      .select('userId status amountMinor currency paidAt refundedAt createdAt')
      .lean(),
    m('ExtraContactPurchase')
      .find({ serviceId: id })
      .select('userId status amountMinor currency paidAt createdAt')
      .populate('userId', PERSON)
      .lean(),
    m('Review')
      .find({ serviceId: id })
      .select('reviewerId revieweeId revieweeRole rating comment createdAt')
      .populate('reviewerId', PERSON)
      .lean(),
    m('JobReport')
      .find({ serviceId: id })
      .select('reportedBy reportType description status createdAt')
      .populate('reportedBy', PERSON)
      .lean(),
    m('Favorite').countDocuments({ service: id }),
    m('Dispute').find({ serviceId: id }).select('orderId status title createdAt').lean(),
  ]);

  const kr = (n) => (Number.isFinite(n) ? `${Math.round(n).toLocaleString('nb-NO')} kr` : '? kr');
  const name = (u) => (u ? [u.name, u.lastName].filter(Boolean).join(' ') : 'Ukjent');
  const events = [
    {
      at: service.createdAt,
      kind: 'created',
      text: `Oppdraget ble lagt ut av ${name(service.userId)}`,
    },
    ...requests.map((r) => ({
      at: r.createdAt,
      kind: 'request',
      text: `${name(r.providerId)} sendte forespørsel`,
    })),
    ...requests
      .filter((r) => r.withdrawnAt)
      .map((r) => ({
        at: r.withdrawnAt,
        kind: 'withdrawn',
        text: `${name(r.providerId)} trakk forespørselen`,
      })),
    ...orders.flatMap((o) => [
      { at: o.createdAt, kind: 'order', text: `Tildelt ${name(o.providerId)}`, orderId: o._id },
      o.paymentConfirmedAt && {
        at: o.paymentConfirmedAt,
        kind: 'paid',
        text: `Betaling mottatt (${kr(o.agreedPrice ?? o.price)})`,
        orderId: o._id,
      },
      o.startedAt && { at: o.startedAt, kind: 'started', text: 'Arbeidet startet', orderId: o._id },
      o.readyForReviewAt && {
        at: o.readyForReviewAt,
        kind: 'review',
        text: 'Levert til godkjenning',
        orderId: o._id,
      },
      o.completedAt && { at: o.completedAt, kind: 'completed', text: 'Fullført', orderId: o._id },
    ]),
    ...payouts
      .filter((p) => p.transferCompletedAt)
      .map((p) => ({
        at: p.transferCompletedAt,
        kind: 'payout',
        text: `Utbetalt ${kr(p.netProviderAmount)} til utfører`,
        orderId: p.orderId,
      })),
    ...urgent
      .filter((u) => u.paidAt)
      .map((u) => ({
        at: u.paidAt,
        kind: 'urgent',
        text: `Hast kjøpt (${kr(u.amountMinor / 100)})`,
      })),
    ...extraContacts
      .filter((x) => x.paidAt)
      .map((x) => ({
        at: x.paidAt,
        kind: 'extra_contact',
        text: `${name(x.userId)} kjøpte ekstra kontakt (${kr(x.amountMinor / 100)})`,
      })),
    ...disputes.map((d) => ({
      at: d.createdAt,
      kind: 'dispute',
      text: `Tvist åpnet: ${d.title}`,
      orderId: d.orderId,
    })),
    ...reviews.map((r) => ({
      at: r.createdAt,
      kind: 'review_given',
      text: `${name(r.reviewerId)} ga ${r.rating}/5`,
    })),
    ...reports.map((r) => ({
      at: r.createdAt,
      kind: 'report',
      text: `Rapportert av ${name(r.reportedBy)} (${r.reportType})`,
    })),
  ]
    .filter((e) => e && e.at)
    .sort((a, b) => new Date(a.at) - new Date(b.at));

  const count = (status) => requests.filter((r) => r.status === status && !r.withdrawnAt).length;
  return sendSuccess(res, {
    service,
    stats: {
      requests: requests.length,
      pending: count('pending'),
      accepted: count('accepted'),
      declined: count('declined'),
      withdrawn: requests.filter((r) => r.withdrawnAt).length,
      orders: orders.length,
      paid: orders.filter((o) => o.paymentConfirmedAt || o.paymentStatus === 'paid').length,
      favorites,
      reports: reports.length,
      disputes: disputes.length,
    },
    requests,
    orders,
    payouts,
    safePay,
    urgent,
    extraContacts,
    reviews,
    reports,
    disputes,
    timeline: events,
  });
});

module.exports = {
  getServices,
  getServiceById,
  getServiceActivity,
  updateServiceStatus,
  updateService,
  deleteService,
};
