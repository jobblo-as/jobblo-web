const Service = require('../../models/Service');
const Order = require('../../models/Order');
const { evaluateListingCapabilities } = require('../../utils/listingCapabilities');
const { PUBLIC_SERVICE_STATUSES } = require('../../constants/serviceVisibility');
const { recordSearch } = require('../../services/monitoring/searchHealth');
const { withDefaults, selectedDefaults } = require('../../utils/lean');
const User = require('../../models/User');
const { resolveSort } = require('../../utils/serviceSort');
const { escapeRegex, isValidId } = require('./serviceHelpers');
const cache = require('../../utils/cache');
const { memo } = require('../../utils/memo');
const viewCounter = require('../../utils/viewCounter');
const { firstView } = require('../../utils/firstView');
const { parsePagination } = require('../../utils/pagination');
const { serverError } = require('../../utils/serverError');
const { queryString } = require('../../utils/devQuery');

/** A public listing as served by getServiceById, cached for 30 s (cleared on any Service write). */
const detailKey = (id) => `services:detail:${id}`;
const LIST_EXCLUDE = '-imageMetadata -checklist';
const LIST_SELLER = 'name avatarUrl verified role orgNumber companyName';
// Public seller-card fields only (rating count, completed jobs, member since).
const DETAIL_SELLER = 'name lastName avatarUrl averageRating reviewCount completedJobs createdAt verified role orgNumber companyName';
/** Lean rows with the populated seller's selected defaults back, as hydrated docs had them. */
const withSeller = (rows, select) => withDefaults(Service, (Array.isArray(rows) ? rows : [rows]).map((r) => r && { ...r, userId: r.userId && typeof r.userId === 'object' && r.userId._id ? selectedDefaults(User, r.userId, select) : r.userId }));

/** Reading listings: public list with filters and sort, detail, and the owner's own listings. */

// ------------------- Get All Services -------------------

exports.getAllServices = async (req, res) => {
  const startedAt = Date.now();
  try {
    const {
      category,
      search,
      minPrice,
      maxPrice,
      sort,
      userId,
      page = 1,
      limit = 25,
      urgent,
      countyCodes,
      municipalityCodes,
      areaCodes,
      lat,
      lng,
      radius,
    } = req.query;

    const query = {};

    // Express parses `?userId[$ne]=null` into an OBJECT, and this value went straight
    // into the query. That skipped the public-status filter below and returned drafts,
    // cancelled and completed listings to anonymous callers. Only accept a real id.
    const ownerId = isValidId(userId) ? userId : null;

    // The public status filter is now unconditional. Passing ANY `userId` used to
    // remove it, so one user could enumerate another's drafts, cancelled and
    // completed jobs. This route is unauthenticated; owners read their own listings
    // (including non-public ones) through GET /api/services/my-posted, which is
    // authenticated and scoped to the caller.
    query.status = { $in: PUBLIC_SERVICE_STATUSES };

    if (ownerId) {
      query.userId = ownerId;
    }

    if (urgent === 'true') {
      query.urgent = true;
    }

    if (category && typeof category === 'string') {
      const categoriesArray = category.split(',').map((c) => c.trim());
      query.categories = { $in: categoriesArray };
    }

    const searchConditions = [];
    if (search && typeof search === 'string') {
      // Unescaped, a search term is a regex: `(a+)+$` is a ReDoS and `.*` forces a
      // full collection scan. The admin controller already escapes; this did not.
      const safeSearch = escapeRegex(search.slice(0, 200));
      searchConditions.push(
        { title: { $regex: safeSearch, $options: 'i' } },
        { description: { $regex: safeSearch, $options: 'i' } }
      );
    }

    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    // Location code filters — use $and so location + search don't overwrite each other
    const locationConditions = [];

    if (countyCodes) {
      const codes = queryString(countyCodes)
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (codes.length > 0) {
        // Match jobs stored directly with countyCode OR jobs stored with a municipality
        // that belongs to the selected county (for backwards compatibility)
        // Static reference data: memoized for an hour instead of a query per filtered request.
        const munCodes = await memo(`geo:muni-codes:${[...codes].sort().join(',')}`, 3600, async () => {
          const NorwayMunicipality = require('../../models/NorwayMunicipality');
          return (await NorwayMunicipality.find({ countyCode: { $in: codes } }).select('code').lean()).map((m) => m.code);
        });

        const countyOrConditions = [{ countyCode: { $in: codes } }];
        if (munCodes.length > 0) {
          countyOrConditions.push({ municipalityCode: { $in: munCodes } });
        }
        locationConditions.push({ $or: countyOrConditions });
      }
    }

    if (municipalityCodes) {
      const codes = queryString(municipalityCodes)
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (codes.length > 0) {
        locationConditions.push({ municipalityCode: { $in: codes } });
      }
    }

    if (areaCodes) {
      const codes = queryString(areaCodes)
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (codes.length > 0) {
        locationConditions.push({ areaCode: { $in: codes } });
      }
    }

    // Geo filter: lat/lng/radius (meters) → services within a circle around the point
    const latNum = Number(lat);
    const lngNum = Number(lng);
    const radiusNum = Number(radius);
    if (
      lat &&
      lng &&
      radius &&
      !isNaN(latNum) &&
      !isNaN(lngNum) &&
      !isNaN(radiusNum) &&
      radiusNum > 0
    ) {
      query['location.coordinates'] = {
        $geoWithin: { $centerSphere: [[lngNum, latNum], radiusNum / 6378100] },
      };
    }

    // Combine location conditions with $or (match any selected region)
    // Combine search and location using $and so neither overwrites the other
    const andConditions = [];
    if (searchConditions.length > 0) {
      andConditions.push({ $or: searchConditions });
    }
    if (locationConditions.length > 0) {
      andConditions.push({ $or: locationConditions });
    }
    if (andConditions.length > 0) {
      query.$and = andConditions;
    }

    // Sort field came straight from the query string, so any unindexed field could be
    // forced into an in-memory sort. The whitelist that fixed that is still here — it
    // just lives in utils/serviceSort.js now, next to the vocabulary the options
    // endpoint advertises. The two used to be written out separately and had drifted
    // completely apart: the picker offered `price_low`, this endpoint accepted only
    // `price`, so every choice fell through to the default and sorting did nothing.
    const { sort: sortOption } = resolveSort(sort);

    // `limit` was parsed with no ceiling, so `?limit=1000000` returned the whole
    // collection in one response. MAX_LIMIT matches utils/pagination.js, which the
    // admin routes already use.
    // parsePagination also caps the page (an anonymous ?page=1e9 was a full-collection skip).
    const { page: safePage, limit: safeLimit, skip } = parsePagination({ page, limit }, { defaultLimit: 25 });

    // find() and countDocuments() ran sequentially for no reason.
    const [services, total] = await Promise.all([
      // lean: hydrating every listing was half of the API's CPU under load; withDefaults
      // (below) restores the exact JSON a hydrated document produced.
      // No card reads imageMetadata (blob names, OG variants) or the checklist: about a third of
      // the list's bytes. The detail endpoint, which both web and app load, still returns them.
      Service.find(query)
        .select(LIST_EXCLUDE)
        .populate({
          path: 'userId',
          select: LIST_SELLER,
          match: { isDeleted: { $ne: true } },
        })
        .lean()
        .skip(skip)
        .limit(safeLimit)
        .sort(sortOption),
      // Shared by every page of one filter, single-flight on a miss; the "services" namespace is
      // cleared on any Service write (models/Service.js), like the cached pages themselves.
      memo(`services:count:${JSON.stringify(query)}`, 30, () => Service.countDocuments(query)),
    ]);

    // Search health (developer console): first page only, so paging is not counted twice.
    if (safePage === 1 && !ownerId) {
      recordSearch({
        kind: 'list',
        text: typeof search === 'string' ? search : null,
        categories: query.categories?.$in,
        regions: [countyCodes, municipalityCodes, areaCodes].filter((c) => typeof c === 'string').reduce((a, c) => a + c.split(',').filter(Boolean).length, 0),
        radiusKm: query['location.coordinates'] ? Math.round(radiusNum / 1000) : null,
        results: total,
        ms: Date.now() - startedAt,
      });
    }

    res.json({
      data: withSeller(services, LIST_SELLER),
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ------------------- Get Service By ID -------------------

exports.getServiceById = async (req, res) => {
  try {
    const { id } = req.params;

    // A malformed id used to reach findByIdAndUpdate and throw a CastError → 500.
    if (!isValidId(id)) return res.status(400).json({ error: 'Invalid service ID' });

    // Only public listings are cached, so the visibility check below has already passed for them.
    const cached = await cache.get(detailKey(id));
    if (cached) {
      const viewerId = req.userId ? String(req.userId) : null;
      if (viewerId !== String(cached.userId?._id || cached.userId) && await firstView(req, id)) {
        void viewCounter.count(id);
        cached.views = (cached.views || 0) + 1;
      }
      return res.json(cached);
    }

    // Read BEFORE deciding whether to count the view. This used to be a single
    // findByIdAndUpdate with `$inc: { views: 1 }` and no status filter at all, so
    // drafts, cancelled, completed and awaiting_payment listings were all readable by
    // id — exactly the set the list endpoint was hardened to hide — and the counter
    // rose on the owner's own refreshes and on every crawler hit, while `views` is a
    // sortable public field.
    // lean + withDefaults: the same JSON as the hydrated document's toObject(), without hydrating.
    const found = await Service.findById(id)
      .populate({
        path: 'userId',
        select: DETAIL_SELLER,
        match: { isDeleted: { $ne: true } },
      })
      .lean();

    if (!found) return res.status(404).json({ error: 'Service not found' });
    const [service] = withSeller(found, DETAIL_SELLER);

    const viewerId = req.userId ? String(req.userId) : null;
    const ownerId = String(service.userId?._id || service.userId);
    const isOwner = Boolean(viewerId) && viewerId === ownerId;

    if (!PUBLIC_SERVICE_STATUSES.includes(service.status) && !isOwner) {
      // A party to the contract still needs to open the job they are working on.
      const involved = viewerId
        ? await Order.findOne({
            serviceId: service._id,
            $or: [{ customerId: viewerId }, { providerId: viewerId }],
          }).select('_id')
        : null;

      if (!involved) {
        // 404 rather than 403 — a non-public listing should not confirm it exists.
        return res.status(404).json({ error: 'Service not found' });
      }
    }

    // Count a view only when a visitor other than the owner reads a live listing.
    // Not awaited: the reader does not wait for the counter write (under load every reader
    // of a popular job queued on that one document). A failed increment is a lost view, not
    // a failed page.
    // One view per viewer per listing per 24 h (utils/firstView), so a refresh loop can't buy "Trending".
    if (!isOwner && PUBLIC_SERVICE_STATUSES.includes(service.status) && await firstView(req, String(service._id))) {
      void viewCounter.count(service._id); // buffered: one bulkWrite per 15 s (utils/viewCounter)
      service.views = (service.views || 0) + 1;
    }

    const serviceData = service;
    if (PUBLIC_SERVICE_STATUSES.includes(service.status)) void cache.set(detailKey(id), serviceData, 30);

    res.json(serviceData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};


// GET /api/users/:id/services — a user's listings. Others see only public ones; this
// used to hand anyone their drafts, cancelled and completed jobs. Served from here, not
// users/profileController, because the visibility rule lives with the other service reads.
exports.getUserServices = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: 'Invalid user ID format' });

    const query = { userId: id };
    if (String(id) !== String(req.userId)) query.status = { $in: PUBLIC_SERVICE_STATUSES };
    // Clients read the whole array (profile grid), so the page is generous.
    const { limit, skip } = parsePagination(req.query, { defaultLimit: 100 });

    res.json(await Service.find(query).sort({ _id: -1 }).skip(skip).limit(limit));
  } catch (err) {
    serverError(res, err);
  }
};

// ------------------- My Services -------------------

exports.getMyPostedServices = async (req, res) => {
  try {
    // Only place the select:false contact fields are returned — this route is
    // owner-scoped, and the edit form needs them to avoid saving blanks back.
    const services = await Service.find({ userId: req.userId })
      .select('+contactPhone +contactEmail')
      .populate('userId', 'name email avatarUrl verified role orgNumber companyName')
      .sort({ _id: -1 })
      .lean();

    /**
     * Attach what the owner may actually do with each listing.
     *
     * Without this the interface has to guess from `service.status`, which is written
     * by a different code path than the Order and has historically drifted from it. The
     * result was a delete button that looked available on a listing with money in
     * escrow and returned an opaque error when pressed. The server decides, the client
     * renders the decision, and the endpoints enforce the same rule on write.
     *
     * One query for every listing rather than one per listing.
     */
    const orders = await Order.find({ serviceId: { $in: services.map((s) => s._id) } })
      .select('serviceId status')
      .lean();

    const ordersByService = new Map();
    for (const order of orders) {
      const key = String(order.serviceId);
      if (!ordersByService.has(key)) ordersByService.set(key, []);
      ordersByService.get(key).push(order);
    }

    res.json(
      services.map((service) => ({
        ...service,
        capabilities: evaluateListingCapabilities({
          service,
          orders: ordersByService.get(String(service._id)) || [],
        }),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};
