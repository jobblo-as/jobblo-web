const { logApplicationError } = require('./errorLogger');

/**
 * The 500 answer for a caught error. Controllers used to send `error.message`, which put
 * raw MongoDB/Stripe text (collection names, ids, e-mails in duplicate-key errors) in the
 * response (M1). The details go to the error log under the request id instead, and the
 * client gets that id so support can find the entry.
 */
function serverError(res, err, message = 'Noe gikk galt. Prøv igjen senere.') {
  // Overload, not a fault: the bounded password-hash queue is full (utils/passwordUtils.js).
  if (err?.code === 'PASSWORD_HASH_BUSY') {
    res.set?.('Retry-After', '5');
    return res
      .status(503)
      .json({
        success: false,
        error: 'Serveren er opptatt. Prøv igjen om litt.',
        code: 'SERVER_BUSY',
      });
  }
  const req = res.req || {};
  const referenceId = req.requestId || res.getHeader?.('X-Request-ID') || undefined;
  logApplicationError({
    error: err,
    // No query string: search terms and e-mails in it ended up in the error log.
    requestPath: (req.baseUrl || '') + (req.path || ''),
    httpMethod: req.method,
    httpStatus: 500,
    ip: req.ip,
    userAgent: req.get?.('user-agent'),
    userId: req.user?._id || req.userId || null,
    correlationId: referenceId,
  }).catch(() => undefined);
  return res.status(500).json({ success: false, error: message, message, referenceId });
}

/** For catch-alls around a create/update: a validation problem is the caller's (400), anything else is ours. */
function inputOrServerError(res, err) {
  if (err?.name === 'ValidationError') return res.status(400).json({ error: err.message });
  if (err?.name === 'CastError') return res.status(400).json({ error: 'Ugyldig verdi.' });
  return serverError(res, err);
}

module.exports = { serverError, inputOrServerError };
