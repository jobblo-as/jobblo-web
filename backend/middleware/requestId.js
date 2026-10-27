const { randomUUID } = require('crypto');

module.exports = (req, res, next) => {
  // A client-sent id is echoed in a header and stored in logs: only a short, plain one.
  const sent = req.get('x-request-id');
  const id =
    sent && /^[A-Za-z0-9_-]{1,64}$/.test(sent)
      ? sent
      : `REQ-${randomUUID().split('-')[0].toUpperCase()}`;
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  next();
};
