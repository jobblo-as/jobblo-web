const mongoose = require('mongoose');

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
// A deep page is a slow server-side skip over the whole collection; nobody pages past this.
const MAX_PAGE = 1000;

/**
 * Parse and validate pagination params from query string.
 * Enforces a maximum page size to prevent full-collection fetches.
 */
const parsePagination = (query = {}, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) => {
  const page = Math.min(MAX_PAGE, Math.max(1, parseInt(query.page, 10) || 1));
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
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

module.exports = { parsePagination, parseObjectId, parseSort, parseDate, MAX_LIMIT, DEFAULT_LIMIT, MAX_PAGE };
