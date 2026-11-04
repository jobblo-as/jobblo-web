require('../config/env'); // backend/.env.development (production: .env.production)
const mongoose = require('mongoose');
const seedCategories = require('./categories.seed');

async function run() {
  require('./guard').guardOrExit({ uri: process.env.MONGO_URI }); // never on production; asks for --yes-wipe=<db>
  await mongoose.connect(process.env.MONGO_URI);
  console.log('🏷️  Seeding categories only');

  const { categories } = await seedCategories();

  console.log(`✅ Categories seeded: ${categories}`);
  process.exit();
}

run().catch((err) => {
  console.error('❌ Seeding failed:', err.message);
  process.exit(1);
});
