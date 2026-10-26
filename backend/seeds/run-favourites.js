require('dotenv').config();
const mongoose = require('mongoose');
const seedFavorites = require('./favourites.seed');

async function run() {
  require('./guard').guardOrExit({ uri: process.env.MONGO_URI }); // never on production; asks for --yes-wipe=<db>
  await mongoose.connect(process.env.MONGO_URI);
  console.log('❤️ Seeding favorites only');

  await seedFavorites();

  console.log('✅ Favorites seeded');
  process.exit();
}

run();
