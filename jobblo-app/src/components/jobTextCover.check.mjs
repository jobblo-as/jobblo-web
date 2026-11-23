// Run: node src/components/jobTextCover.check.mjs
// Jobs without photos (Abdi): a job without its own photo shows a text card in its category's
// colour, never a category stock photo, which people could take for the actual job. Guards the
// source, since the views cannot run in plain Node.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// Every place that shows a job's picture: the card, the welcome list, the job page.
for (const path of ['./JobCard.tsx', './landing/Jobs.tsx', '../../app/(app)/jobs/[id].tsx']) {
  const src = read(path);
  assert.ok(src.includes('<JobTextCover'), `${path}: a job without a photo gets JobTextCover`);
  assert.ok(
    !/categoryImage\(|jobImageSource\(/.test(src),
    `${path}: no category stock photo in a job's place`
  );
}

// The stand-in helpers are gone, so nothing can bring the stock photo back by accident.
const util = read('../utils/categoryImage.ts');
assert.ok(!/export function (categoryImage|jobImageSource)\b/.test(util), 'stock helpers removed');

// One colour per category, the web's values.
for (const [key, bg] of [
  ['hagearbeid', '#E3F1DE'],
  ['flytting', '#E7ECF8'],
  ['maling', '#FBF0DC'],
]) {
  assert.ok(util.includes(`[PHOTOS.${key}, { bg: '${bg}'`), `tint for ${key}`);
}

// The card's own photo still wins, and a broken photo falls back to the text card.
const card = read('./JobCard.tsx');
assert.ok(/const hasPhoto = Boolean\(imageUrl\) && !imageFailed/.test(card), 'photo first');
assert.ok(card.includes('onError={() => setImageFailed(true)}'), 'broken photo → text card');

// Task 4, list view: the row never shows a stock photo either, and Utforsk rebuilds its
// FlatList (key) when the toggle changes the column count (RN cannot change numColumns live).
const row = read('./JobListRow.tsx');
assert.ok(row.includes('<JobTextCover job={job} iconOnly />'), 'list row: category thumbnail');
assert.ok(!/categoryImage\(|jobImageSource\(/.test(row), 'list row: no stock photo');
const explore = read('../../app/(app)/explore.tsx');
assert.ok(explore.includes('key={view}'), 'explore: FlatList keyed by view');
assert.ok(
  explore.includes("numColumns={view === 'list' ? 1 : 2}"),
  'explore: 1 column in list view'
);
assert.ok(read('./search/SearchResultsHeader.tsx').includes('Vis som liste'), 'toggle beside sort');

console.log('jobTextCover: ok');
