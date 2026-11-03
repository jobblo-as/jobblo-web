# Jobblo database seeders

For a LOCAL or test database only. Every command refuses when `NODE_ENV=production`, and asks
you to confirm the database by name with `--yes-wipe=<database name from MONGO_URI>`
(see `seeds/guard.js`). `MONGO_URI` comes from `backend/.env.development`, e.g.

```env
MONGO_URI=mongodb://127.0.0.1:27017/jobblo-dev
```

Run from `backend/`.

## Empty the database

Removes every document from every collection (indexes stay):

```bash
npm run db:wipe -- --yes-wipe=jobblo-dev
```

## Seed

Subscription plans + the demo data:

```bash
npm run db:seed -- --yes-wipe=jobblo-dev
```

Plans only:

```bash
node seeds/run-plan.js --yes-wipe=jobblo-dev
```

Fresh start: `db:wipe`, then `db:seed`.

## The demo data (`seeds/data/*.json`)

One seed per part, run in this order by `index.js`, all loaded through `load.js`:

| Seed                 | What                                                        |
| -------------------- | ----------------------------------------------------------- |
| `plan.seed.js`       | Subscription plans                                          |
| `categories.seed.js` | The 9 job categories (icon and order)                       |
| `reference.seed.js`  | Global config, homepage content (no location tree)          |
| `users.seed.js`      | Test users (~20)                                            |
| `admin.seed.js`      | Super admin admin@jobblo.no (MFA on first login)            |
| `jobs.seed.js`       | Test jobs (~50)                                             |
| `activity.seed.js`   | Applications, chats, SafePay orders, reviews, notifications |

- 20 users: `customer1–8@jobblo.no` (post jobs), `helper1–8@jobblo.no` (private helpers),
  `painter@`, `cleaning@`, `moving@`, `carpenter@jobblo.no` (businesses). Some profiles complete,
  some partial. Passwords are in Bitwarden, folder "Jobblo Test" (not in this repo).
- 50 jobs in the 9 categories: Oslo 26, Bergen 7, Bærum 6, Drammen 6, Akershus 5. Fixed price,
  hourly and open bidding; 22 with a photo (Unsplash), some with dates, some flexible.
- 44 applications on 25 jobs, chats, and 5 jobs taken through SafePay to completed with reviews
  both ways (plus jobs left at awaiting payment, paid, in progress and waiting for approval).
- Categories, global config (`STRIPE_TEST_MODE` on) and the homepage content. No Kartverket/SSB
  location tree: the seed leaves norwaycounties, norwaymunicipalities and norwayareas alone.

The SafePay records point at Stripe TEST-mode objects in the Jobblo test account. Dates are moved
forward to the day you seed. Seeding again changes nothing (documents are upserted by `_id`).
