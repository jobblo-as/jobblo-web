/** The risk rules, in evaluation order. Each: { id, config, evaluate(ctx, cfg) → hits[] }. */
module.exports = [
  require('./multiIp'),
  require('./vpnTransition'),
  require('./multiAccount'),
  require('./loginAbuse'),
  require('./requestAbuse'),
  require('./sensitiveOps'),
];
