/**
 * Empties EVERY collection in the database MONGO_URI points at (backend/.env.development).
 * Indexes and collections stay, only the documents go, so the app starts as usual afterwards.
 *
 *   node seeds/wipe.js --yes-wipe=<database name>      (npm run db:wipe -- --yes-wipe=<name>)
 *
 * Refuses with NODE_ENV=production and without the database named on the command line
 * (seeds/guard.js), so an env file pointing somewhere unexpected cannot be wiped by accident.
 */
require('../config/env');
const mongoose = require('mongoose');

async function run() {
  const target = require('./guard').guardOrExit({ uri: process.env.MONGO_URI });
  await mongoose.connect(process.env.MONGO_URI);
  const collections = (await mongoose.connection.db.listCollections().toArray())
    .map((c) => c.name)
    .filter((name) => !name.startsWith('system.'));

  let removed = 0;
  for (const name of collections) {
    const { deletedCount } = await mongoose.connection.db.collection(name).deleteMany({});
    removed += deletedCount;
  }
  console.log(`🧹 ${target}: ${removed} documents removed from ${collections.length} collections`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('❌ Wipe failed:', err.message);
  process.exit(1);
});
