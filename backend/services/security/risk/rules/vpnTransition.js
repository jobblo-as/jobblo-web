/**
 * Rule B — an installation first seen on an ordinary (residential/mobile) network, later on a
 * network classified as VPN/proxy or Tor. Context, not wrongdoing: low severity (medium for
 * Tor), and only as sure as the IP classification behind it.
 */
const h = require('./helpers');

const NORMAL = ['residential', 'mobile'];
const MASKED = ['vpn_proxy', 'tor'];

module.exports = {
  id: 'B_VPN_TRANSITION',
  config: 'vpnTransition',
  evaluate(ctx, cfg) {
    const rows = h
      .publicObs(ctx.observations)
      .filter((o) => h.within(o.lastSeen, cfg.windowDays * h.DAY, ctx.now))
      .sort((a, b) => h.t(a.firstSeen) - h.t(b.firstSeen));
    const normal = rows.find((o) => NORMAL.includes(o.network?.class));
    if (!normal) return [];
    const masked = rows.filter(
      (o) => MASKED.includes(o.network?.class) && h.t(o.firstSeen) >= h.t(normal.firstSeen)
    );
    if (!masked.length) return [];
    const tor = masked.some((o) => o.network.class === 'tor');
    const best = masked.find((o) => o.network.confidence === 'high') || masked[0];
    const all = [normal, ...masked];
    return [
      {
        ruleId: this.id,
        title: tor ? 'Moved to the Tor network' : 'Moved to a VPN or proxy network',
        summary: `Seen on ${normal.network.class} (${normal.ip}), then on ${masked.length} masked network(s). A VPN alone is not fraud.`,
        severity: tor ? 'medium' : 'low',
        confidence: h.networkConfidence(best.network.confidence),
        weight: tor ? 15 : 10,
        ips: h.uniq(all.map((o) => o.ip)),
        userIds: h.uniq(all.map((o) => o.userId)),
        evidence: all.slice(0, 20).map(h.ipEvidence),
        ...h.span(all),
      },
    ];
  },
};
