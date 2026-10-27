require('../config/env'); // backend/.env.development (production: .env.production)
const mongoose = require('mongoose');

const seedUsers = require('./users.seed');
const seedPlans = require('./plan.seed');

async function run() {
  try {
    console.log('Seeder started');

    require('./guard').guardOrExit({ uri: process.env.MONGO_URI }); // never on production; asks for --yes-wipe=<db>
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected');

    const users = await seedUsers();
    console.log(`👤 Users: ${users.length}`);

    const plans = await seedPlans();
    console.log(`💳 Plans: ${plans.length}`);

    console.log('🎉 Database seeded successfully');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  }
}

run();
