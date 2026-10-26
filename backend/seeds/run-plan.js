const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const seedPlans = require('./plan.seed');

async function run() {
  require('./guard').guardOrExit({ uri: process.env.MONGO_URI }); // never on production; asks for --yes-wipe=<db>
  await mongoose.connect(process.env.MONGO_URI);
  console.log('💳 Seeding plans only');

  await seedPlans();

  console.log('✅ Plans seeded');
  process.exit();
}

run();
