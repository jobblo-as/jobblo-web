/**
 * Rule A — one installation on several networks within a short window.
 * A "network" is an IP prefix (/24, /48); on a mobile network it is the whole AS, because a
 * phone moving between cell towers changes address all the time. Private IPs never count.
 */
const h = require('./helpers');

module.exports = {
  id: 'A_MULTI_IP',
  config: 'multiIp',
  evaluate(ctx, cfg) {
    const now = ctx.now;
    const recent = h
      .publicObs(ctx.observations)
      .filter((o) => h.within(o.lastSeen, cfg.windowMin * h.MIN, now));
    const networks = new Map();
    for (const o of recent) {
      const key =
        o.network?.class === 'mobile' && o.network?.asn
          ? `as:${o.network.asn}`
          : o.ipPrefix || o.ip;
      if (!networks.has(key)) networks.set(key, o);
    }
    if (networks.size < cfg.minNetworks) return [];
    const rows = [...networks.values()];
    const high = networks.size >= cfg.minNetworks * 2;
    return [
      {
        ruleId: this.id,
        title: 'One installation on many networks',
        summary: `${networks.size} networks in ${cfg.windowMin} min (threshold ${cfg.minNetworks}).`,
        severity: high ? 'high' : 'medium',
        confidence: h.baseConfidence(ctx.device),
        weight: high ? 30 : 20,
        ips: h.uniq(rows.map((o) => o.ip)),
        userIds: h.uniq(rows.map((o) => o.userId)),
        evidence: rows.slice(0, 20).map(h.ipEvidence),
        ...h.span(rows),
      },
    ];
  },
};
