/**
 * Ranks job titles by how alike they are to one title ("Lignende oppdrag"). For "iPhone 17":
 *   0. the same title                         iPhone 17
 *   1. every word of it plus more, fewer extras first   iPhone 17 Pro, iPhone 17 Pro Max
 *   2. the same words with another number, nearest first (a tie: the higher one first)
 *                                             iPhone 18, iPhone 16, iPhone 15, iPhone 14 …
 *   3. some words in common, more in common first
 *   4. nothing in common
 * Inside a step the newest job comes first. Pure, so it is unit-tested without a database.
 */

// Small words that say nothing about what the job is.
const STOP_WORDS = new Set([
  'og',
  'i',
  'på',
  'pa',
  'til',
  'med',
  'for',
  'en',
  'et',
  'ei',
  'av',
  'fra',
  'som',
  'min',
  'mitt',
  'mine',
  'ca',
  'the',
  'a',
  'an',
  'and',
  'of',
  'to',
  'in',
  'with',
]);

/** "iPhone17 Pro-Max!" → ['iphone', '17', 'pro', 'max'] (letters and digits split apart). */
function tokens(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .replace(/(\d)(\p{L})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t && !STOP_WORDS.has(t));
}

const isNumber = (t) => /^\d+$/.test(t);

/** How alike `title` is to the base title's tokens: [step, then tie-breakers], lower first. */
function rankTitle(baseTokens, title) {
  const own = tokens(title);
  const ownSet = new Set(own);
  const baseSet = new Set(baseTokens);
  if (!baseSet.size) return [4, 0, 0];

  const missing = [...baseSet].filter((t) => !ownSet.has(t));
  const extras = [...ownSet].filter((t) => !baseSet.has(t)).length;
  if (!missing.length) return extras ? [1, extras, 0] : [0, 0, 0];

  // Same words, another number: "iPhone 18" for "iPhone 17".
  const baseNumbers = baseTokens.filter(isNumber);
  const missingWords = missing.filter((t) => !isNumber(t));
  const ownNumbers = own.filter(isNumber);
  if (baseNumbers.length && ownNumbers.length && !missingWords.length) {
    const diff = Number(ownNumbers[0]) - Number(baseNumbers[0]);
    // Nearest first; at the same distance the higher number (the newer model) first.
    return [2, Math.abs(diff) * 2 + (diff > 0 ? 0 : 1), extras];
  }

  const shared = baseSet.size - missing.length;
  if (shared) return [3, -shared / baseSet.size, extras];
  return [4, 0, 0];
}

/**
 * Sorts jobs (each with `title` and `createdAt`) most alike first, newest first inside a step.
 * Returns a new array; the input is left alone.
 */
function rankByTitle(baseTitle, jobs) {
  const base = tokens(baseTitle);
  return jobs
    .map((job) => ({ job, rank: rankTitle(base, job.title) }))
    .sort((a, b) => {
      for (let i = 0; i < a.rank.length; i += 1) {
        if (a.rank[i] !== b.rank[i]) return a.rank[i] - b.rank[i];
      }
      return new Date(b.job.createdAt || 0) - new Date(a.job.createdAt || 0);
    })
    .map((r) => r.job);
}

module.exports = { tokens, rankTitle, rankByTitle };
