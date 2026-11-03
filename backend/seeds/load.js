/**
 * Loads collections from seeds/data/*.json (recorded from a database the demo was built in
 * through the real API, SafePay in Stripe TEST mode). Used by reference/users/jobs/activity.seed.
 *
 * Every document keeps its _id and is upserted by it, so a second run changes nothing and
 * nothing outside these documents is touched. Run on an empty database (seeds/wipe.js) when the
 * target already holds other data: a unique field (an e-mail, a category name) would clash.
 *
 * The data was recorded on one day; every date is moved forward by the time since then, so the
 * jobs are as "new" and the start dates as far ahead as when it was recorded.
 * ponytail: a blanket shift, also for dates that are history (e.g. terms accepted); fine for
 * demo data. The Stripe ids are TEST-mode objects in the Jobblo test account and are not shifted.
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const DATA = path.join(__dirname, 'data');

/** Moves every Date inside `value` by `ms`, in place. */
function shiftDates(value, ms) {
  if (Array.isArray(value)) value.forEach((v, i) => (value[i] = shiftDates(v, ms)));
  else if (value instanceof Date) return new Date(value.getTime() + ms);
  else if (value && typeof value === 'object' && !(value instanceof mongoose.Types.ObjectId)) {
    for (const k of Object.keys(value)) value[k] = shiftDates(value[k], ms);
  }
  return value;
}

/**
 * Upserts documents into collections; returns { file: count }. An entry is a collection name
 * (read from data/<name>.json) or { file, collection } when the file is named differently.
 */
async function load(entries, { now = Date.now() } = {}) {
  const { EJSON } = mongoose.mongo.BSON;
  const { exportedAt } = JSON.parse(fs.readFileSync(path.join(DATA, '_meta.json'), 'utf8'));
  const shift = Math.max(0, now - new Date(exportedAt).getTime());
  const counts = {};

  for (const entry of entries) {
    const { file, collection: name } =
      typeof entry === 'string' ? { file: entry, collection: entry } : entry;
    const docs = EJSON.parse(fs.readFileSync(path.join(DATA, `${file}.json`), 'utf8'));
    if (!docs.length) continue;
    const ops = docs.map((doc) => ({
      replaceOne: { filter: { _id: doc._id }, replacement: shiftDates(doc, shift), upsert: true },
    }));
    try {
      await mongoose.connection.db.collection(name).bulkWrite(ops, { ordered: false });
    } catch (err) {
      if (err.code === 11000 || err.writeErrors?.some((e) => e.code === 11000)) {
        throw new Error(
          `${name}: a document with the same unique value already exists. ` +
            'Empty the database first: npm run db:wipe -- --yes-wipe=<database name>'
        );
      }
      throw err;
    }
    counts[file] = docs.length;
  }
  return counts;
}

module.exports = { load, shiftDates };
