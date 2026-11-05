/**
 * Rule F — an account or payout change (profile e-mail/phone/password, MFA, sessions, Stripe
 * Connect) from an installation-IP pair first seen in the last hours, or from a VPN/proxy/Tor
 * network. Both together is high: the account-takeover pattern.
 */
const h = require('./helpers');

const MASKED = ['vpn_proxy', 'tor'];

module.exports = {
  id: 'F_SENSITIVE_OPS',
  config: 'sensitiveOps',
  evaluate(ctx, cfg) {
    const rows = ctx.observations.filter((o) => {
      const n = o.events?.sensitive ?? (o.events?.get ? o.events.get('sensitive') : 0);
      return n > 0 && h.within(o.lastSeen, cfg.newPairHours * h.HOUR, ctx.now);
    });
    const flagged = rows
      .map((o) => ({
        o,
        fresh: h.t(o.lastSeen) - h.t(o.firstSeen) <= cfg.newPairHours * h.HOUR,
        masked: MASKED.includes(o.network?.class),
      }))
      .filter((r) => r.fresh || r.masked);
    if (!flagged.length) return [];
    const both = flagged.some((r) => r.fresh && r.masked);
    const all = flagged.map((r) => r.o);
    return [
      {
        ruleId: this.id,
        title: 'Account or payout change from a new or masked network',
        summary: both
          ? 'A sensitive change from a newly seen network that is also a VPN/proxy or Tor.'
          : flagged.some((r) => r.masked)
            ? 'A sensitive change from a VPN/proxy or Tor network.'
            : 'A sensitive change from an installation-IP pair first seen recently.',
        severity: both ? 'high' : 'medium',
        confidence: h.baseConfidence(ctx.device),
        weight: both ? 35 : 20,
        ips: h.uniq(all.map((o) => o.ip)),
        userIds: h.uniq(all.map((o) => o.userId)),
        evidence: all.slice(0, 20).map(h.ipEvidence),
        ...h.span(all),
      },
    ];
  },
};
