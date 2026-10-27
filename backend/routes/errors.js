const express = require('express');
const router = express.Router();
const { asyncHandler, sendSuccess, sendError } = require('../utils/apiResponse');
const ErrorLog = require('../models/ErrorLog');
const { redactSensitive, redactText } = require('../utils/sanitizer');
const { makeLimiter } = require('../middleware/rateLimiter');

// No login on this route, so it gets its own budget: one browser in an error loop, or a script,
// can't fill ErrorLog. The body is capped at 32 kb in app.js (before the global 12 mb parser).
const clientErrorLimiter = makeLimiter('client-errors', {
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'For mange feilrapporter. Prøv igjen senere.' },
});

const cut = (v, n) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, n);

// POST /api/errors/client - accept sanitized client-side error reports
router.post('/client', clientErrorLimiter, asyncHandler(async (req, res) => {
  const { errorCode = 'FRONTEND_RENDER_ERROR', message = '', route = '', metadata = {} } = req.body || {};
  try {
    const sanitized = redactSensitive(metadata);
    const referenceId = `FRONT-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
    const text = redactText(cut(message, 4000));
    // Anyone can post here, so a report can never look like a server error: the code is
    // always CLIENT_/FRONTEND_-prefixed and plain, and the severity never above "warning".
    const code = cut(errorCode, 60).toUpperCase().replace(/[^A-Z0-9_]/g, '_') || 'FRONTEND_RENDER_ERROR';
    await ErrorLog.create({
      referenceId,
      errorCode: /^(CLIENT|FRONTEND)_/.test(code) ? code : `CLIENT_${code}`,
      severity: 'warning',
      message: text.slice(0, 500),
      technicalMessage: text,
      source: 'frontend',
      route: cut(route, 500),
      metadata: sanitized,
    });
    return sendSuccess(res, { referenceId }, 'Client error recorded.');
  } catch (err) {
    console.error('[ClientErrorRoute] Failed to persist:', err.message);
    return sendError(res, 'Failed to record client error.', 500);
  }
}));

module.exports = router;
