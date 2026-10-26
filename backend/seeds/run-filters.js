require('dotenv').config();
const mongoose = require('mongoose');
const seedFilters = require('./filters.seed');

async function run() {
  require('./guard').guardOrExit({ uri: process.env.MONGO_URI }); // never on production; asks for --yes-wipe=<db>
  await mongoose.connect(process.env.MONGO_URI);
  console.log('🔍 Seeding filters only');

  await seedFilters();

  console.log('✅ Filters seeded successfully');
  process.exit();
}

run();
