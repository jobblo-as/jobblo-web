require('dotenv').config();
const mongoose = require('mongoose');
const seedConversations = require('./conversations.seed');

async function run() {
  require('./guard').guardOrExit({ uri: process.env.MONGO_URI }); // never on production; asks for --yes-wipe=<db>
  await mongoose.connect(process.env.MONGO_URI);
  console.log('💬 Seeding conversations only');

  await seedConversations();

  console.log('✅ Conversations seeded');
  process.exit();
}

run();
