/**
 * Rule D — repeated failed sign-ins from one installation. High when the failures also come
 * from changing networks (or countries) — the pattern of credential stuffing through proxies;
 * medium when it is only many failures from one place (someone who forgot a password does a
 * few, not dozens).
 */
const h = require('./helpers');

module.exports = {
  id: 'D_LOGIN_ABUSE',
  config: 'loginAbuse',
  evaluate(ctx, cfg) {
    const fails = ctx.securityEvents.filter(
      (e) => e.type === 'login_failed' && h.within(e.at, cfg.windowMin * h.MIN, ctx.now)
    );
    if (fails.length < cfg.minFailures) return [];
    const ips = h.uniq(fails.map((e) => e.ip));
    const byIp = new Map(ctx.observations.map((o) => [o.ip, o]));
    const prefixes = h.uniq(ips.map((ip) => byIp.get(ip)?.ipPrefix || ip));
    const countries = h.uniq(ips.map((ip) => byIp.get(ip)?.network?.countryCode));
    const moving = prefixes.length >= 2 || countries.length >= 2;
    if (!moving && fails.length < cfg.minFailures * 2) return [];
    const accounts = h.uniq(fails.map((e) => e.emailHash)).length;
    return [
      {
        ruleId: this.id,
        title: moving ? 'Failed sign-ins from changing networks' : 'Many failed sign-ins',
        summary: `${fails.length} failed sign-ins in ${cfg.windowMin} min from ${prefixes.length} network(s)${countries.length > 1 ? `, ${countries.length} countries` : ''}, against ${accounts || 'unknown'} account(s).`,
        severity: moving ? 'high' : 'medium',
        confidence: h.baseConfidence(ctx.device),
        weight: moving ? 30 : 20,
        ips,
        userIds: [],
        evidence: ips.slice(0, 20).map((ip) => {
          const o = byIp.get(ip);
          return o
            ? h.ipEvidence(o)
            : { label: `${ip} · failed sign-in`, at: null, ref: { type: 'ip', id: ip } };
        }),
        ...h.span(fails, 'at'),
      },
    ];
  },
};
