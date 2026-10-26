# Jobblo Database Seeders

This folder contains seed scripts to populate the local development database
with realistic demo data for Jobblo.

⚠️ **Seeders are intended for LOCAL DEVELOPMENT ONLY**

---

## 1️⃣ Prerequisites

- Node.js installed
- MongoDB running locally
- `.env` file configured with:

```env
MONGO_URI=mongodb://localhost:27017/jobblo-dev
```

> **Seeding deletes data.** Every script empties its collections first. It refuses to run when
> `NODE_ENV=production`, and asks you to confirm the database by name:
> `--yes-wipe=<database name from MONGO_URI>` (below: `jobblo-dev`). See `seeds/guard.js`.

2️⃣ Run ALL seeders (recommended first run)

This will clear and re-create all data in the correct order: (all of your exisiting data will be deleted)

node seeds/index.js --yes-wipe=jobblo-dev

This seeds:

Users
Categories
Services
Orders
Reviews
Notifications

3️⃣ Run individual seeders

For Categories:
node seeds/run-categories.js --yes-wipe=jobblo-dev

For Conversations:
node seeds/run-conversations.js --yes-wipe=jobblo-dev

For Favourties:
node seeds/run-favorites.js --yes-wipe=jobblo-dev

For Filters:
node seeds/run-filters.js --yes-wipe=jobblo-dev

For Plans:
node seeds/run-plan.js --yes-wipe=jobblo-dev

For JobbloShop:
node seeds/run-jobbloShop.js --yes-wipe=jobblo-dev



5️⃣ Notes

Running a seeder will overwrite data in its collection
Seed data is in Norwegian (demo content)
Images use placeholder/CDN URLs
Designed to support frontend UI development
