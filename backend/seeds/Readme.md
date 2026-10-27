# Jobblo database seeders

Two seeders are kept: demo **users** and the subscription **plans**. Both are for a LOCAL
database only.

> **Seeding deletes data.** Each seeder empties its collection first. It refuses to run when
> `NODE_ENV=production`, and asks you to confirm the database by name with
> `--yes-wipe=<database name from MONGO_URI>`. See `seeds/guard.js`.

`MONGO_URI` comes from `backend/.env.development`, e.g.

```env
MONGO_URI=mongodb://127.0.0.1:27017/jobblo-dev
```

Users and plans (from `backend/`):

```bash
node seeds/index.js --yes-wipe=jobblo-dev
```

Plans only:

```bash
node seeds/run-plan.js --yes-wipe=jobblo-dev
```
