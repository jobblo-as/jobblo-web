/**
 * Rule E — the rate limiter kept refusing this installation. The limiter already protects the
 * API; this makes the pattern visible per installation, across IPs.
 */
const h = require('./helpers');

module.exports = {
  id: 'E_REQUEST_ABUSE',
  config: 'requestAbuse',
  evaluate(ctx, cfg) {
    const limited = ctx.securityEvents.filter(
      (e) => e.type === 'rate_limited' && h.within(e.at, cfg.windowMin * h.MIN, ctx.now)
    );
    if (limited.length < cfg.minRateLimited) return [];
    const high = limited.length >= cfg.minRateLimited * 3;
    const routes = new Map();
    for (const e of limited) routes.set(e.route, (routes.get(e.route) || 0) + 1);
    const top = [...routes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return [
      {
        ruleId: this.id,
        title: 'Request bursts refused by the rate limiter',
        summary: `${limited.length} rate-limited requests in ${cfg.windowMin} min (threshold ${cfg.minRateLimited}).`,
        severity: high ? 'high' : 'medium',
        confidence: h.baseConfidence(ctx.device),
        weight: high ? 30 : 20,
        ips: h.uniq(limited.map((e) => e.ip)).slice(0, 20),
        userIds: h.uniq(limited.map((e) => e.userId)),
        evidence: top.map(([route, n]) => ({
          label: `${n} × ${route || '(unknown route)'}`,
          at: null,
          ref: { type: 'event', id: 'rate_limited' },
        })),
        ...h.span(limited, 'at'),
      },
    ];
  },
};
