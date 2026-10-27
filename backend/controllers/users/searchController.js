const User = require('../../models/User');
const Service = require('../../models/Service');
const Category = require('../../models/Category');
const List = require('../../models/List');
const { PUBLIC_USER_SELECT, sanitizeUserPublic } = require('../../utils/userProjections');
const { escapeRegex } = require('../../utils/devQuery');
const { PUBLIC_SERVICE_STATUSES } = require('../../constants/serviceVisibility');
const { serverError } = require('../../utils/serverError');
const { memo } = require('../../utils/memo');
const { parsePagination } = require('../../utils/pagination');
const { visibleServices } = require('../listController');

// Search text is matched literally (never run as a regular expression: `(a+)+$` used to stall
// MongoDB, `(` gave a 500) and is never matched against email addresses, which let anyone
// test whether an address has an account (security review C3/H3).
const searchText = (q) => (typeof q === 'string' ? q.trim().slice(0, 100) : '');

/** User search, top providers and the unified search (categories, people, jobs, public lists). */

// Search users
exports.searchUsers = async (req, res) => {
  try {
    const query = searchText(req.query.query || req.query.q);
    if (query.length < 2) {
      return res.status(200).json([]);
    }

    const users = await User.find({
      $or: [
        { name: { $regex: escapeRegex(query), $options: 'i' } },
        { lastName: { $regex: escapeRegex(query), $options: 'i' } },
      ],
      _id: { $ne: req.userId }, // Exclude current user
      isDeleted: { $ne: true },
    })
      .select(PUBLIC_USER_SELECT)
      .limit(10);

    res.status(200).json(users.map(sanitizeUserPublic));
  } catch (err) {
    serverError(res, err);
  }
};

// Lean rows lack the `id` virtual a document's toObject() added (a public field).
const withId = (u) => ({ ...u, id: String(u._id) });
// filter is { _id: not me, isDeleted: not true }, and the viewer passed authenticate, so is not
// deleted: the total is every live user minus one. One count for everyone instead of one per call.
// ponytail: the total can be up to 60 s stale (pagination only); invalidate on user writes if that matters.
const othersTotal = async () =>
  Math.max(
    0,
    (await memo('users:live-count', 60, () => User.countDocuments({ isDeleted: { $ne: true } }))) -
      1
  );

// Get Top 10 Users by Rating and Reviews (only paid subscription users)
exports.getTopUsers = async (req, res) => {
  try {
    // ponytail: page capped at 100 so the location tiers below fetch at most skip+limit (5000) docs each; deeper pages need cursor paging.
    const page = Math.min(100, Math.max(1, parseInt(req.query.page) || 1));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const filter = {
      _id: { $ne: req.userId },
      isDeleted: { $ne: true },
      // TODO: Uncomment below when paid users exist to restrict to paid only
      // subscription: { $ne: 'Standard' },
    };

    const baseSelect =
      'name lastName avatarUrl averageRating reviewCount subscription skills hourlyRate locations postNumber postSted';
    const sort = { reviewCount: -1, averageRating: -1 };

    // Location-aware ordering:
    // 1. Same location — postSted matches viewer city, OR postSted/address
    //    contains a location token from the viewer (e.g. "Haroonabad" from
    //    "Dahranwala - Haroonabad Road"). Works for any country.
    // 2. Same postnr-region (first 2 digits) — nearby for Norwegian post codes.
    // 3. Broader region (first 1 digit).
    // 4. Everyone else (top rated).
    const prefix =
      typeof req.query.postNumber === 'string' ? req.query.postNumber.trim().slice(0, 2) : '';
    const isNumericPrefix = /^\d{2}$/.test(prefix);
    // Capped: every token becomes a regex in two $or branches and two $nin lists.
    const city =
      typeof req.query.postSted === 'string' ? req.query.postSted.trim().slice(0, 100) : '';
    const address =
      typeof req.query.address === 'string' ? req.query.address.trim().slice(0, 100) : '';

    if (isNumericPrefix || city || address) {
      const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match a string ignoring casing and spaces: "Haroon Abad" == "Haroonabad"
      const fuzzyRegex = (c, anchored) => {
        const normalized = c.toLowerCase().replace(/[^a-zæøå0-9]/g, '');
        if (!normalized) return null;
        const pattern = normalized
          .split('')
          .map((ch) => `${escapeRegex(ch)}\\s*`)
          .join('');
        return new RegExp(`${anchored ? '^' : ''}${pattern}${anchored ? '$' : ''}`, 'i');
      };

      const STOP_WORDS = new Set([
        'road',
        'street',
        'gate',
        'gata',
        'veg',
        'vei',
        'veien',
        'rd',
        'st',
        'no',
        'nr',
        'norge',
        'norway',
        'pakistan',
        'punjab',
        'highway',
        'motorway',
      ]);
      const extractTokens = (...strings) => {
        const set = new Set();
        for (const s of strings) {
          const normalized = (s || '')
            .toLowerCase()
            .replace(/[^a-zæøå0-9]+/g, ' ')
            .trim();
          for (const tok of normalized.split(' ')) {
            if (tok.length >= 4 && !STOP_WORDS.has(tok)) set.add(tok);
          }
        }
        return [...set].slice(0, 5);
      };

      const prefix1 = prefix.slice(0, 1);
      const cityReg = fuzzyRegex(city, true);
      const tokens = extractTokens(city, address);
      const tokenRegs = tokens.map((t) => fuzzyRegex(t, false));

      // Tier 1: same location
      const tier1Or = [];
      if (cityReg) tier1Or.push({ postSted: { $regex: cityReg } });
      for (const re of tokenRegs) {
        tier1Or.push({ postSted: { $regex: re } });
        tier1Or.push({ address: { $regex: re } });
      }

      const seen = new Set();
      let nearbyCount = 0;
      const mark = (u, nearby) => ({ ...u, nearby: !!nearby });
      const pushUnique = (arr, u, nearby) => {
        const key = String(u._id);
        if (seen.has(key)) return;
        seen.add(key);
        if (nearby) nearbyCount += 1;
        arr.push(mark(u, nearby));
      };

      const [nearby, samePrefix, region] = await Promise.all([
        tier1Or.length
          ? User.find({ ...filter, $or: tier1Or })
              .select(baseSelect)
              .sort(sort)
              .limit(skip + limit)
              .lean()
          : [],
        isNumericPrefix
          ? User.find({ ...filter, postNumber: { $regex: `^${prefix}` } })
              .select(baseSelect)
              .sort(sort)
              .limit(skip + limit)
              .lean()
          : [],
        isNumericPrefix
          ? User.find({ ...filter, postNumber: { $regex: `^${prefix1}` } })
              .select(baseSelect)
              .sort(sort)
              .limit(skip + limit)
              .lean()
          : [],
      ]);

      const ordered = [];
      nearby.forEach((u) => pushUnique(ordered, u, true));
      samePrefix.forEach((u) => pushUnique(ordered, u, true));
      region.forEach((u) => pushUnique(ordered, u, false));

      const othersFilter = { ...filter };
      if (tier1Or.length) {
        othersFilter.postSted = { $nin: [cityReg, ...tokenRegs].filter(Boolean) };
        othersFilter.address = { $nin: tokenRegs.length ? tokenRegs : [cityReg].filter(Boolean) };
      }
      if (isNumericPrefix) othersFilter.postNumber = { $nin: [new RegExp(`^${prefix1}`)] };

      const othersSkip = Math.max(0, skip - ordered.length);
      const othersLimit = Math.max(0, skip + limit - ordered.length);
      if (othersLimit > 0) {
        const others = await User.find(othersFilter)
          .select(baseSelect)
          .sort(sort)
          .skip(othersSkip)
          .limit(othersLimit)
          .lean();
        others.forEach((u) => pushUnique(ordered, u, false));
      }

      const paginated = ordered
        .slice(skip, skip + limit)
        .map(withId)
        .map(sanitizeUserPublic);
      const total = await othersTotal();

      return res.status(200).json({
        data: paginated,
        location: { nearbyCount },
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      });
    }

    const [topUsers, total] = await Promise.all([
      User.find(filter).select(baseSelect).sort(sort).skip(skip).limit(limit).lean(),
      othersTotal(),
    ]);

    res.status(200).json({
      data: topUsers.map(withId).map(sanitizeUserPublic),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Get top users error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Unified Search for Categories, People, Jobs, and Public Lists with Pagination
exports.searchAll = async (req, res) => {
  try {
    const { type } = req.query;
    const query = searchText(req.query.query);

    if (query.length < 2) {
      return res.status(200).json({
        categories: { results: [], total: 0 },
        people: { results: [], total: 0 },
        jobs: { results: [], total: 0 },
        lists: { results: [], total: 0 },
      });
    }

    const regex = new RegExp(escapeRegex(query), 'i');
    const {
      page,
      limit: numericLimit,
      skip,
    } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 50 });

    // If a specific type is requested, return only that type with pagination
    if (type) {
      let results = [];
      let total = 0;

      if (type === 'categories') {
        total = await Category.countDocuments({ name: regex, isActive: true });
        results = await Category.find({ name: regex, isActive: true })
          .skip(skip)
          .limit(numericLimit);
      } else if (type === 'people') {
        const queryObj = {
          $or: [{ name: regex }, { lastName: regex }],
          _id: { $ne: req.userId },
          isDeleted: { $ne: true },
        };
        total = await User.countDocuments(queryObj);
        results = (
          await User.find(queryObj)
            .select('name lastName avatarUrl averageRating reviewCount')
            .skip(skip)
            .limit(numericLimit)
        ).map(sanitizeUserPublic);
      } else if (type === 'jobs') {
        total = await Service.countDocuments({
          $or: [{ title: regex }, { description: regex }],
          status: { $in: PUBLIC_SERVICE_STATUSES },
        });
        results = await Service.find({
          $or: [{ title: regex }, { description: regex }],
          status: { $in: PUBLIC_SERVICE_STATUSES },
        })
          .skip(skip)
          .limit(numericLimit);
      } else if (type === 'lists') {
        total = await List.countDocuments({ name: regex, public: true });
        results = await List.find({ name: regex, public: true })
          .populate(visibleServices(req.userId))
          .skip(skip)
          .limit(numericLimit);
      }

      return res.status(200).json({
        results,
        total,
        page,
        limit: numericLimit,
        totalPages: Math.ceil(total / numericLimit),
      });
    }

    // Default: return top 3 for each category (for the initial search dropdown)
    // 1. Search Categories
    const categoriesCount = await Category.countDocuments({
      name: regex,
      isActive: true,
    });
    const categories = await Category.find({
      name: regex,
      isActive: true,
    }).limit(3);

    // 2. Search Jobs (Services)
    const jobsCount = await Service.countDocuments({
      $or: [{ title: regex }, { description: regex }],
      status: { $in: PUBLIC_SERVICE_STATUSES },
    });
    const jobs = await Service.find({
      $or: [{ title: regex }, { description: regex }],
      status: { $in: PUBLIC_SERVICE_STATUSES },
    }).limit(3);

    // 3. Search People (Users)
    const peopleCount = await User.countDocuments({
      $or: [{ name: regex }, { lastName: regex }],
      _id: { $ne: req.userId },
      isDeleted: { $ne: true },
    });
    const people = (
      await User.find({
        $or: [{ name: regex }, { lastName: regex }],
        _id: { $ne: req.userId },
        isDeleted: { $ne: true },
      })
        .select('name lastName avatarUrl averageRating reviewCount')
        .limit(3)
    ).map(sanitizeUserPublic);

    // 4. Search Public Lists
    const listsCount = await List.countDocuments({
      name: regex,
      public: true,
    });
    const lists = await List.find({
      name: regex,
      public: true,
    })
      .populate(visibleServices(req.userId))
      .limit(3);

    res.status(200).json({
      categories: { results: categories, total: categoriesCount },
      jobs: { results: jobs, total: jobsCount },
      people: { results: people, total: peopleCount },
      lists: { results: lists, total: listsCount },
    });
  } catch (error) {
    console.error('Unified search error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
