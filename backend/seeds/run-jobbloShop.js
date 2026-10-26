require('dotenv').config();
const mongoose = require('mongoose');
const seedJobbloShop = require('./jobbloShop..seed');

async function run() {
  require('./guard').guardOrExit({ uri: process.env.MONGO_URI }); // never on production; asks for --yes-wipe=<db>
  await mongoose.connect(process.env.MONGO_URI);
  console.log('💳 Seeding JobbloShop only');

  await seedJobbloShop();

  console.log('✅ JobbloShop seeded');
  process.exit();
}

run();
