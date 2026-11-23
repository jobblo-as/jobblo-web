// Run: node src/features/renovation/renovation.check.mjs
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// The app imports TS files without an extension (Metro resolves them); let plain Node do the same.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('/api/client'))
      return { url: 'data:text/javascript,export default {}', shortCircuit: true };
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && !/\.(tsx?|m?js|json)$/.test(specifier))
        return next(`${specifier}.ts`, context);
      throw error;
    }
  },
});
const { EMPTY_PLAN, finnCodeOf, fromSavedPlan, toPlanRequest, toSavedPlanBody, withFacts } =
  await import('./planState.ts');
const { toJobDrafts, photosForArea } = await import('./toJobDrafts.ts');

// finnCodeOf: bare code, finnkode= query, FINN path; nothing for text or short numbers.
assert.equal(finnCodeOf('412345678'), '412345678');
assert.equal(finnCodeOf('  412345678 '), '412345678');
assert.equal(
  finnCodeOf('https://www.finn.no/realestate/homes/ad.html?finnkode=412345678'),
  '412345678'
);
assert.equal(finnCodeOf('https://www.finn.no/412345678'), '412345678');
assert.equal(finnCodeOf('https://www.finn.no/412345678?ref=x'), '412345678');
assert.equal(finnCodeOf('12345'), '');
assert.equal(finnCodeOf('Fin leilighet på Grünerløkka'), '');
assert.equal(finnCodeOf(''), '');

// toJobDrafts: one draft per area.
const range = (low, high) => ({ low, high });
const line = (over) => ({
  key: 'rooms',
  label: 'Stuer og soverom',
  scope: 'surface',
  quality: 'standard',
  quantity: 3,
  unit: 'rom',
  includes: 'Maling og gulv.',
  low: 40_000,
  high: 61_000,
  labour: range(25_000, 38_000),
  materials: range(15_000, 23_000),
  weeks: [1, 2],
  certified: [],
  quote: false,
  ...over,
});
const estimate = (areas) => ({
  facts: { sizeM2: 80, rooms: 3, bathrooms: 1 },
  quality: 'standard',
  areas,
  total: { ...range(0, 0), labour: range(0, 0), materials: range(0, 0), weeks: [1, 2] },
  budget: null,
  disclaimer: 'Dette er et anslag.',
});

const [fixed, bath, huge, quoted] = toJobDrafts(
  estimate([
    line(),
    line({
      key: 'bathroom',
      label: 'Bad',
      scope: 'full',
      quality: 'good',
      unit: '',
      low: 250_000,
      high: 400_000,
      certified: ['våtromsfagperson', 'elektriker'],
      quote: true,
    }),
    // Midpoint over the job price limit: a quote request, price capped.
    line({ key: 'exterior', label: 'Fasade', low: 1_200_000, high: 1_600_000 }),
    line({ key: 'windows', label: 'Vinduer', low: 90_000, high: 120_000, quote: true }),
  ]),
  [
    { area: 'bathroom', text: 'Badet er fra 1985.' },
    { area: 'kitchen', text: 'Kjøkkenet er nytt.' },
  ]
);
// Fastpris: the rounded midpoint ((40 000 + 61 000) / 2 = 50 500 -> 51 000).
assert.equal(fixed.paymentType, 'Fastpris');
assert.equal(fixed.price, '51000');
assert.equal(fixed.title, 'Overflateoppussing av stuer og soverom');
assert.equal(fixed.categories, 'Oppussing');
assert.equal(fixed.currentStep, 1);
assert.match(fixed.description, /\(3 rom\)\. Maling og gulv\./);
assert.match(fixed.description, /Ønsket kvalitet: standard\./);
assert.doesNotMatch(fixed.description, /Om dagens standard/);
assert.match(fixed.description, /Dette er et anslag\.$/);
// Certified: Anbud at the low end, with the trades and this area's notes only.
assert.equal(bath.paymentType, 'Anbud');
assert.equal(bath.price, '250000');
assert.equal(bath.title, 'Total oppussing av bad');
assert.match(bath.description, /Ønsket kvalitet: god\./);
assert.match(bath.description, /Om dagens standard:\n- Badet er fra 1985\./);
assert.doesNotMatch(bath.description, /Kjøkkenet/);
assert.match(bath.description, /Krever sertifisert fagperson \(våtromsfagperson, elektriker\)/);
// Above the limit: Anbud, price never over 1 000 000.
assert.equal(huge.paymentType, 'Anbud');
assert.equal(huge.price, '1000000');
// A quote line without certified trades: still Anbud at the low end.
assert.equal(quoted.paymentType, 'Anbud');
assert.equal(quoted.price, '90000');
assert.deepEqual(toJobDrafts(estimate([])), []);

// Plan state -> request: numbers parsed ("85,5" and "1 500 000"), empty fields left out,
// only selected areas sent, per-area quality kept only when set.
const state = {
  ...EMPTY_PLAN,
  title: '  Huset  ',
  finnInput: '412345678',
  sizeM2: '85,5',
  rooms: '3',
  bathrooms: '',
  yearBuilt: '1978',
  homeType: 'enebolig',
  budget: '1 500 000',
  quality: 'good',
  notes: [{ area: 'kitchen', text: 'Gammelt kjøkken.' }],
  areas: {
    kitchen: { scope: 'full' },
    bathroom: { scope: 'surface', quality: 'premium' },
    hallway: undefined,
  },
};
assert.deepEqual(toPlanRequest(state), {
  facts: { sizeM2: 85.5, rooms: 3, bathrooms: undefined },
  quality: 'good',
  areas: [
    { key: 'kitchen', scope: 'full' },
    { key: 'bathroom', scope: 'surface', quality: 'premium' },
  ],
  budget: 1_500_000,
});
const body = toSavedPlanBody(state);
assert.equal(body.title, 'Huset');
assert.equal(body.facts.yearBuilt, 1978);
assert.equal(body.facts.homeType, 'enebolig');
assert.equal(body.finnCode, '412345678');
assert.deepEqual(body.notes, state.notes);
assert.equal(toSavedPlanBody(EMPTY_PLAN).title, 'Min oppussingsplan');
assert.equal(toPlanRequest(EMPTY_PLAN).budget, undefined);
assert.equal(toPlanRequest({ ...EMPTY_PLAN, sizeM2: 'abc' }).facts.sizeM2, undefined);

// Saved plan -> state: own keeps id and share link; area quality equal to the plan's is dropped.
const saved = {
  _id: 'p1',
  shareId: 's1',
  title: 'Huset',
  plan: {
    facts: { sizeM2: 85.5, rooms: 3, bathrooms: 1 },
    quality: 'good',
    areas: [
      { key: 'kitchen', scope: 'full', quality: 'good' },
      { key: 'bathroom', scope: 'surface', quality: 'premium' },
    ],
    budget: 1_500_000,
  },
  yearBuilt: 1978,
  homeType: 'rekkehus',
  notes: state.notes,
  finnCode: '412345678',
  updatedAt: '2026-11-01T00:00:00.000Z',
  estimate: null,
};
const own = fromSavedPlan(saved, true);
assert.equal(own.planId, 'p1');
assert.equal(own.shareId, 's1');
assert.equal(own.sizeM2, '85.5');
assert.equal(own.bathrooms, '1');
assert.equal(own.yearBuilt, '1978');
assert.equal(own.homeType, 'rekkehus');
assert.equal(own.budget, '1500000');
assert.equal(own.listingText, '');
assert.deepEqual(own.areas, {
  kitchen: { scope: 'full' },
  bathroom: { scope: 'surface', quality: 'premium' },
});
// And back again: the same request the plan was saved from.
assert.deepEqual(toPlanRequest(own).areas, toPlanRequest(state).areas);
const copy = fromSavedPlan(
  {
    ...saved,
    yearBuilt: null,
    homeType: null,
    finnCode: null,
    plan: { ...saved.plan, budget: undefined },
  },
  false
);
assert.equal(copy.planId, null);
assert.equal(copy.shareId, null);
assert.equal(copy.yearBuilt, '');
assert.equal(copy.homeType, '');
assert.equal(copy.finnInput, '');
assert.equal(copy.budget, '');

// AI facts: known numbers replace, null keeps what was typed, outdated areas get selected
// without changing a choice the user already made.
const merged = withFacts(
  { ...EMPTY_PLAN, rooms: '4', areas: { kitchen: { scope: 'full' } } },
  {
    sizeM2: 72,
    rooms: null,
    bathrooms: 2,
    yearBuilt: null,
    homeType: 'leilighet',
    standardNotes: [{ area: 'bathroom', text: 'Opprinnelig bad.' }],
    outdatedAreas: ['bathroom', 'kitchen'],
  }
);
assert.equal(merged.sizeM2, '72');
assert.equal(merged.rooms, '4');
assert.equal(merged.bathrooms, '2');
assert.equal(merged.yearBuilt, '');
assert.equal(merged.homeType, 'leilighet');
assert.deepEqual(merged.areas, { kitchen: { scope: 'full' }, bathroom: { scope: 'surface' } });
assert.equal(merged.notes.length, 1);

// photosForArea: the area's own photos first, then whole-home ones, at most 6 per job.
const shots = [
  { id: 1, area: 'kitchen' },
  { id: 2, area: '' },
  { id: 3, area: 'bathroom' },
  { id: 4, area: 'kitchen' },
];
assert.deepEqual(
  photosForArea(shots, 'kitchen').map((p) => p.id),
  [1, 4, 2]
);
assert.deepEqual(
  photosForArea(shots, 'bathroom').map((p) => p.id),
  [3, 2]
);
assert.deepEqual(
  photosForArea(shots, 'hallway').map((p) => p.id),
  [2]
);
assert.equal(
  photosForArea(
    Array.from({ length: 9 }, (_, n) => ({ id: n, area: '' })),
    'kitchen'
  ).length,
  6
);
assert.deepEqual(photosForArea([], 'kitchen'), []);

console.log('renovation planner: ok');
