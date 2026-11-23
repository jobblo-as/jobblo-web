const { renovation: CONFIG } = require('../../config/jobblo-pricing-config.json');

/**
 * Renovation planner ("Oppussingskalkulator"): the price estimate.
 *
 * Pure arithmetic over `renovation` in jobblo-pricing-config.json. No AI here on purpose:
 * the same plan must always give the same numbers, and the numbers must come from the
 * rates the business set, not from a model. The AI only reads the listing text
 * (aiController.renovationFacts); this turns the user's choices into kroner.
 */

const SCOPES = ['surface', 'full'];
const QUALITIES = CONFIG.qualities;
const AREA_KEYS = CONFIG.areas.map((a) => a.key);
const AREAS = new Map(CONFIG.areas.map((a) => [a.key, a]));

const QUALITY_NO = { budget: 'Budsjett', standard: 'Standard', good: 'God', premium: 'Premium' };
const SCOPE_NO = { surface: 'Overflate', full: 'Total' };

/** Home types the AI may read from a listing and the user may pick. Shown, not priced. */
const HOME_TYPES = ['leilighet', 'rekkehus', 'tomannsbolig', 'enebolig', 'hytte', 'annet'];
const HOME_TYPE_NO = {
  leilighet: 'Leilighet',
  rekkehus: 'Rekkehus',
  tomannsbolig: 'Tomannsbolig',
  enebolig: 'Enebolig',
  hytte: 'Hytte',
  annet: 'Annet',
};

const LIMITS = {
  sizeM2: [10, 2000],
  rooms: [0, 30],
  bathrooms: [0, 10],
  budget: [0, 100_000_000],
};

const roundTo = (value) => Math.round(value / CONFIG.roundTo) * CONFIG.roundTo;
const kr = (value) => value.toLocaleString('nb-NO').replace(/ /g, ' ');

/** A whole number inside [min, max], or undefined when the input is not a usable number. */
function boundedNumber(value, [min, max]) {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return Math.round(n);
}

/**
 * Checks and normalises the request body. Returns `{ error }` or `{ plan }`.
 * Body: { facts: { sizeM2, rooms, bathrooms }, quality, areas: [{ key, scope, quality? }], budget? }
 */
function parsePlan(body) {
  const input = body && typeof body === 'object' ? body : {};
  const facts = input.facts && typeof input.facts === 'object' ? input.facts : {};

  const quality = QUALITIES.includes(input.quality) ? input.quality : 'standard';
  if (!Array.isArray(input.areas) || input.areas.length === 0)
    return { error: 'Velg minst ett område.' };
  if (input.areas.length > AREA_KEYS.length) return { error: 'For mange områder.' };

  const seen = new Set();
  const areas = [];
  for (const area of input.areas) {
    if (!area || typeof area !== 'object') return { error: 'Ugyldig område.' };
    if (!AREA_KEYS.includes(area.key)) return { error: 'Ukjent område.' };
    if (!SCOPES.includes(area.scope)) return { error: 'Velg overflate eller total.' };
    if (area.quality !== undefined && !QUALITIES.includes(area.quality))
      return { error: 'Ugyldig kvalitet.' };
    if (seen.has(area.key)) continue;
    seen.add(area.key);
    areas.push({ key: area.key, scope: area.scope, quality: area.quality || quality });
  }

  const hasBudget = input.budget !== undefined && input.budget !== null && input.budget !== '';
  const budget = hasBudget ? boundedNumber(input.budget, LIMITS.budget) : undefined;
  if (hasBudget && budget === undefined) return { error: 'Ugyldig budsjett.' };

  return {
    plan: {
      facts: {
        sizeM2: boundedNumber(facts.sizeM2, LIMITS.sizeM2) ?? CONFIG.defaults.sizeM2,
        rooms: boundedNumber(facts.rooms, LIMITS.rooms) ?? CONFIG.defaults.rooms,
        bathrooms: boundedNumber(facts.bathrooms, LIMITS.bathrooms) ?? CONFIG.defaults.bathrooms,
      },
      quality,
      areas,
      budget,
    },
  };
}

/** How many units an area's rate is multiplied by, and what that unit is called. */
function quantityFor(area, facts) {
  switch (area.unit) {
    case 'bathroom':
      return { quantity: Math.max(1, facts.bathrooms), unitLabel: 'bad' };
    case 'm2':
      return { quantity: Math.max(1, Math.round(facts.sizeM2 * area.floorShare)), unitLabel: 'm²' };
    case 'window':
      return {
        quantity: Math.max(1, facts.rooms * area.unitsPerRoom),
        unitLabel: 'stk',
      };
    default:
      return { quantity: 1, unitLabel: '' };
  }
}

/** One area at one scope and quality: low/high, split into labour and materials. */
function priceArea(key, scope, quality, facts) {
  const area = AREAS.get(key);
  const rule = area[scope];
  const { quantity, unitLabel } = quantityFor(area, facts);
  const [bandLow, bandHigh] = CONFIG.qualityBands[quality];
  const [rateLow, rateHigh] = rule.range;
  const at = (share) => (rateLow + (rateHigh - rateLow) * share) * quantity;

  const low = roundTo(at(bandLow));
  const high = Math.max(low, roundTo(at(bandHigh)));
  const labour = { low: roundTo(low * rule.labourShare), high: roundTo(high * rule.labourShare) };
  const materials = { low: low - labour.low, high: high - labour.high };

  return {
    key,
    label: area.no,
    scope,
    quality,
    quantity,
    unit: unitLabel,
    includes: rule.includes,
    low,
    high,
    labour,
    materials,
    weeks: rule.weeks,
    certified: rule.certified,
    // Certified trades are never given a fixed price on Jobblo: the job asks for quotes.
    quote: Boolean(area.quote) || rule.certified.length > 0,
  };
}

const mid = (line) => (line.low + line.high) / 2;

/**
 * Cheaper versions of the plan, biggest saving first: total → overflate, then one quality
 * step down. Each is one change to one area, so the user can see what it costs them.
 */
function savingsFor(lines, facts) {
  const options = [];
  const option = (line, change, cheaper, what) => {
    const saving = roundTo(mid(line) - mid(cheaper));
    options.push({
      key: line.key,
      change,
      saving,
      text: `${what} på ${line.label.toLowerCase()} sparer ca. ${kr(saving)} kr.`,
    });
  };
  for (const line of lines) {
    if (line.scope === 'full') {
      const cheaper = priceArea(line.key, 'surface', line.quality, facts);
      option(line, { scope: 'surface' }, cheaper, 'Overflate i stedet for total');
    }
    const step = QUALITIES.indexOf(line.quality);
    if (step > 0) {
      const lower = QUALITIES[step - 1];
      const cheaper = priceArea(line.key, line.scope, lower, facts);
      const what = `${QUALITY_NO[lower]} i stedet for ${QUALITY_NO[line.quality].toLowerCase()}`;
      option(line, { quality: lower }, cheaper, what);
    }
  }
  return options.filter((o) => o.saving > 0).sort((a, b) => b.saving - a.saving);
}

/** The full estimate for a parsed plan (see parsePlan). */
function estimate(plan) {
  const lines = plan.areas.map((a) => priceArea(a.key, a.scope, a.quality, plan.facts));
  const sum = (pick) => lines.reduce((total, line) => total + pick(line), 0);
  const total = {
    low: sum((l) => l.low),
    high: sum((l) => l.high),
    labour: { low: sum((l) => l.labour.low), high: sum((l) => l.labour.high) },
    materials: { low: sum((l) => l.materials.low), high: sum((l) => l.materials.high) },
    // Areas are usually done one after another; this is the longest it should take.
    weeks: [Math.max(...lines.map((l) => l.weeks[0])), sum((l) => l.weeks[1])],
  };

  let budget = null;
  if (plan.budget !== undefined) {
    const status =
      total.high <= plan.budget ? 'within' : total.low > plan.budget ? 'over' : 'borderline';
    const overBy = Math.max(0, roundTo((total.low + total.high) / 2 - plan.budget));
    budget = {
      amount: plan.budget,
      status,
      overBy,
      // ponytail: single-change suggestions only, not a search over combinations. Enough
      // for a first version; upgrade to a greedy combination if users ask "what fits?".
      suggestions: status === 'within' ? [] : savingsFor(lines, plan.facts).slice(0, 3),
    };
  }

  return {
    facts: plan.facts,
    quality: plan.quality,
    areas: lines,
    total,
    budget,
    disclaimer: CONFIG.disclaimer.no,
  };
}

/** Area list for the client: keys, labels and what each scope includes. */
function catalogue() {
  return {
    areas: CONFIG.areas.map((a) => ({
      key: a.key,
      label: a.no,
      surface: a.surface.includes,
      full: a.full.includes,
    })),
    qualities: QUALITIES.map((key) => ({ key, label: QUALITY_NO[key] })),
    scopes: SCOPES.map((key) => ({ key, label: SCOPE_NO[key] })),
    homeTypes: HOME_TYPES.map((key) => ({ key, label: HOME_TYPE_NO[key] })),
    defaults: CONFIG.defaults,
    disclaimer: CONFIG.disclaimer.no,
  };
}

module.exports = {
  parsePlan,
  estimate,
  catalogue,
  AREA_KEYS,
  QUALITIES,
  SCOPES,
  LIMITS,
  HOME_TYPES,
};
