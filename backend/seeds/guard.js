/**
 * Every seed script empties collections (users, plans) before inserting test data, and an
 * env file can point at the PRODUCTION database (its
 * MONGO_URI is a local 127.0.0.1 address too, so "local only" would not protect it).
 *
 * So a seed run must (1) never happen with NODE_ENV=production and (2) be confirmed by
 * naming the database that will be wiped: `node seeds/index.js --yes-wipe=jobblo-dev`.
 * Security review H5.
 */

/** "mongodb://user:pass@host:27017/db?x" → { host: 'host:27017', db: 'db' } — no credentials. */
function describeTarget(uri) {
  const m = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)\/?([^?]*)/.exec(String(uri || ''));
  if (!m) throw new Error('MONGO_URI is missing or not a MongoDB URI.');
  return { host: m[1], db: decodeURIComponent(m[2]) || 'test' };
}

/** Throws unless seeding is allowed; returns "host/db" for logging. */
function assertSafeToSeed({
  uri = process.env.MONGO_URI,
  env = process.env,
  argv = process.argv,
} = {}) {
  const { host, db } = describeTarget(uri);
  const target = `${host}/${db}`;
  if (env.NODE_ENV === 'production') {
    throw new Error(`Refusing to seed: NODE_ENV=production (${target}). Seed scripts delete data.`);
  }
  const confirmed = argv.find((a) => a.startsWith('--yes-wipe='))?.slice('--yes-wipe='.length);
  if (confirmed !== db) {
    throw new Error(
      `Seeding deletes existing data in ${target}. Run again with --yes-wipe=${db} to confirm.`
    );
  }
  return target;
}

/** For entry scripts: check, or print the reason and exit before connecting to anything. */
function guardOrExit(opts) {
  try {
    const target = assertSafeToSeed(opts);
    console.log(`Seeding ${target}`);
    return target;
  } catch (err) {
    console.error(`✋ ${err.message}`);
    process.exit(1);
  }
}

module.exports = { assertSafeToSeed, describeTarget, guardOrExit };
