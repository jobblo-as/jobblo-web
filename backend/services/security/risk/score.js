/**
 * Explainable risk score for one installation, from its live alerts (open / investigating /
 * escalated): each rule counts once at its weight, scaled by how sure the association is, and
 * different rules agreeing add a corroboration bonus. 0–100, banded by the configured bands.
 * A score is a reason to look, never a verdict — nothing acts on it automatically.
 */
const CONFIDENCE = { confirmed: 1, likely: 0.8, possible: 0.6 };
const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];
const LIVE = ['open', 'investigating', 'escalated'];

/** Pure. alerts → { score, band, rules, reasons[] }. */
function scoreAlerts(alerts, bands) {
  const live = (alerts || []).filter((a) => LIVE.includes(a.status || 'open'));
  const perRule = new Map();
  for (const a of live) {
    const value = (a.weight || 0) * (CONFIDENCE[a.confidence] ?? 0.6);
    if (value > (perRule.get(a.ruleId)?.value ?? -1)) perRule.set(a.ruleId, { value, a });
  }
  const rules = perRule.size;
  let score = [...perRule.values()].reduce((sum, r) => sum + r.value, 0);
  if (rules >= 2) score += 10;
  if (rules >= 3) score += 10;
  score = Math.min(100, Math.round(score));
  const band =
    score >= bands.critical
      ? 'critical'
      : score >= bands.high
        ? 'high'
        : score >= bands.medium
          ? 'medium'
          : 'low';
  const reasons = [...perRule.values()]
    .sort((x, y) => y.value - x.value)
    .map(({ value, a }) => `${a.ruleId}: +${Math.round(value)} (${a.severity}, ${a.confidence})`);
  if (rules >= 2) reasons.push(`corroboration: +${rules >= 3 ? 20 : 10} (${rules} rules)`);
  return { score, band, rules, reasons };
}

/** What a developer should consider at this band. Recommendations only. */
const RECOMMENDATION = {
  low: 'No action. Keep for context.',
  medium: 'Review the evidence when convenient.',
  high: 'Investigate. Consider a step-up check or rate limit through Developer actions.',
  critical: 'Investigate now. Consider blocking the IP or escalating the accounts to a fraud case.',
};

const maxSeverity = (a, b) => (SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b);

module.exports = { scoreAlerts, RECOMMENDATION, maxSeverity, CONFIDENCE, LIVE };
