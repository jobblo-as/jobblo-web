const mongoose = require('mongoose');

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
// A deep page is a slow server-side skip over the whole collection; nobody pages past this.
const MAX_PAGE = 1000;

/**
 * Parse and validate pagination params from query string.
 * Enforces a maximum page size to prevent full-collection fetches.
 */
const parsePagination = (
  query = {},
  { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}
) => {
  const page = Math.min(MAX_PAGE, Math.max(1, parseInt(query.page, 10) || 1));
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

// The largest page any list endpoint serves (developer log explorer); each endpoint still
// caps lower through parsePagination / its own clamp.
// ponytail: one global ceiling, so 150 on a max-100 endpoint is clamped to 100, not refused;
// per-route maxima in this check would turn that into a 400 too.
const MAX_REQUEST_LIMIT = 300;
const WHOLE_NUMBER = /^\d{1,6}$/;

/**
 * Before every /api route: `page` / `limit`, when sent, must be whole numbers in range.
 * Text, decimals, negatives, 0, repeated params and absurd values are a 400, not silently
 * replaced by a default.
 */
const rejectBadPagination = (req, res, next) => {
  for (const [key, max] of [
    ['page', MAX_PAGE],
    ['limit', MAX_REQUEST_LIMIT],
  ]) {
    const raw = req.query?.[key];
    if (raw === undefined || raw === '') continue;
    const n = typeof raw === 'string' && WHOLE_NUMBER.test(raw) ? Number(raw) : NaN;
    if (!(n >= 1 && n <= max)) {
      return res.status(400).json({
        error: `Ugyldig «${key}»: må være et heltall fra 1 til ${max}.`,
        code: 'INVALID_PAGINATION',
      });
    }
  }
  next();
};

/**
 * Validate that a string is a valid MongoDB ObjectId.
 * Returns the ObjectId if valid, null otherwise.
 */
const parseObjectId = (id) => {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
};

/**
 * Whitelist and parse sort parameters.
 * @param {string} sortBy - Field to sort by
 * @param {string} sortOrder - 'asc' or 'desc'
 * @param {string[]} allowedFields - Fields permitted for sorting
 * @param {string} defaultField - Default sort field
 */
const parseSort = (sortBy, sortOrder, allowedFields, defaultField = 'createdAt') => {
  const field = allowedFields.includes(sortBy) ? sortBy : defaultField;
  const order = sortOrder === 'asc' ? 1 : -1;
  return { [field]: order };
};

/**
 * Parse an ISO date string safely.
 * Returns null if the value is invalid or missing.
 */
const parseDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
};

module.exports = {
  parsePagination,
  rejectBadPagination,
  parseObjectId,
  parseSort,
  parseDate,
  MAX_LIMIT,
  DEFAULT_LIMIT,
  MAX_PAGE,
  MAX_REQUEST_LIMIT,
};
