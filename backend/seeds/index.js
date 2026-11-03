require('../config/env'); // backend/.env.development (production: .env.production)
const mongoose = require('mongoose');

const seedPlans = require('./plan.seed');
const seedCategories = require('./categories.seed');
const seedReference = require('./reference.seed');
const seedUsers = require('./users.seed');
const seedAdmin = require('./admin.seed');
const seedJobs = require('./jobs.seed');
const seedActivity = require('./activity.seed');

const total = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);

async function run() {
  try {
    console.log('Seeder started');

    require('./guard').guardOrExit({ uri: process.env.MONGO_URI }); // never on production; asks for --yes-wipe=<db>
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected');

    await seedPlans(); // logs its own count (it returns nothing)
    console.log(`🏷️  Categories: ${(await seedCategories()).categories}`);
    console.log(`🗂️  Config, homepage: ${total(await seedReference())}`);
    console.log(`👤 Users: ${(await seedUsers()).users}`);
    console.log(`🛡️  Super admin: ${(await seedAdmin()).admin} (admin@jobblo.no)`);
    console.log(`🧰 Jobs: ${(await seedJobs()).services}`);
    const activity = await seedActivity();
    console.log(
      `💬 Activity: ${activity.jobrequests} applications, ${activity.chats} chats, ` +
        `${activity.orders} orders, ${activity.reviews} reviews`
    );

    console.log('🎉 Database seeded successfully');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed:', err.message);
    process.exit(1);
  }
}

run();
