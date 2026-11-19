// "Lignende oppdrag" order by title: the owner's example (iPhone 17 → 17, 17 Pro, 17 Pro Max,
// 18, 16, 15, 14 …) and the Norwegian titles the app really has.
const { tokens, rankByTitle } = require('../utils/similarTitles');

const at = (min) => new Date(Date.now() - min * 60_000).toISOString();
const job = (title, min = 10) => ({ title, createdAt: at(min) });
const order = (base, titles) =>
  rankByTitle(
    base,
    titles.map((t, i) => job(t, i))
  ).map((j) => j.title);

test('tokens: lower case, letters and digits apart, punctuation and small words gone', () => {
  expect(tokens('iPhone17 Pro-Max!')).toEqual(['iphone', '17', 'pro', 'max']);
  expect(tokens('Male terrasse, ca. 20 m²')).toEqual(['male', 'terrasse', '20', 'm²']);
  expect(tokens('Vaske leilighet før utflytting')).toEqual([
    'vaske',
    'leilighet',
    'før',
    'utflytting',
  ]);
  expect(tokens('')).toEqual([]);
});

test('the owner example: same, then more words, then the nearest other number', () => {
  expect(
    order('iPhone 17', [
      'iPhone 14',
      'Samsung Galaxy S24',
      'iPhone 16',
      'iPhone 17 Pro Max',
      'iPhone 18',
      'iPhone 15',
      'iPhone 17',
      'iPhone 17 Pro',
    ])
  ).toEqual([
    'iPhone 17',
    'iPhone 17 Pro',
    'iPhone 17 Pro Max',
    'iPhone 18',
    'iPhone 16',
    'iPhone 15',
    'iPhone 14',
    'Samsung Galaxy S24', // nothing in common: last
  ]);
});

test('some words in common beats none; more in common first', () => {
  expect(
    order('Vaske leilighet før utflytting', [
      'Klippe hekk',
      'Vaske vinduer',
      'Vaske leilighet i Oslo',
      'Vaske leilighet før utflytting',
    ])
  ).toEqual([
    'Vaske leilighet før utflytting',
    'Vaske leilighet i Oslo', // 2 of 4 words
    'Vaske vinduer', // 1 of 4
    'Klippe hekk',
  ]);
});

test('inside a step the newest job comes first', () => {
  const old = { ...job('iPhone 17', 300), id: 'old' };
  const fresh = { ...job('iPhone 17', 5), id: 'fresh' };
  const other = { ...job('Sofa', 1), id: 'other' }; // newest, but nothing in common
  expect(rankByTitle('iPhone 17', [old, other, fresh]).map((j) => j.id)).toEqual([
    'fresh',
    'old',
    'other',
  ]);
});

test('a base title of only small words ranks by date alone', () => {
  const ranked = rankByTitle('og i på', [job('B', 20), job('A', 5)]);
  expect(ranked.map((j) => j.title)).toEqual(['A', 'B']);
});
