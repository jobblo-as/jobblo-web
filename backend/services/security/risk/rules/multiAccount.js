/**
 * Rule C — several accounts signed in on one installation. A family computer or a shared work
 * browser does this too, so it is only "possible" for an app id and "likely" for a browser,
 * and medium unless the number is large.
 */
const h = require('./helpers');

module.exports = {
  id: 'C_MULTI_ACCOUNT',
  config: 'multiAccount',
  evaluate(ctx, cfg) {
    const rows = ctx.observations.filter(
      (o) => o.userId && h.within(o.lastSeen, cfg.windowDays * h.DAY, ctx.now)
    );
    const users = h.uniq(rows.map((o) => o.userId));
    if (users.length < cfg.minAccounts) return [];
    const high = users.length >= cfg.minAccounts * 2;
    const firstPerUser = users.map(
      (u) =>
        rows
          .filter((o) => String(o.userId) === u)
          .sort((a, b) => h.t(a.firstSeen) - h.t(b.firstSeen))[0]
    );
    return [
      {
        ruleId: this.id,
        title: 'Several accounts on one installation',
        summary: `${users.length} accounts in ${cfg.windowDays} days (threshold ${cfg.minAccounts}). Could be a shared computer.`,
        severity: high ? 'high' : 'medium',
        confidence: h.baseConfidence(ctx.device),
        weight: high ? 40 : 25,
        ips: h.uniq(rows.map((o) => o.ip)).slice(0, 20),
        userIds: users,
        evidence: firstPerUser.slice(0, 20).map((o) => ({
          label: `Account ${o.userId} first seen from ${o.ip}`,
          at: o.firstSeen,
          ref: { type: 'user', id: String(o.userId) },
        })),
        ...h.span(rows),
      },
    ];
  },
};
