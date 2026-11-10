# MEMORY — project ki abhi ki halat

> Last update: **2026-11-10**. Har task ke baad upar "Log" me ek line (tareekh + kya + kahan). Purani `WORKLOG.md` aur `B2C-FIXLOG.md` ka saar neeche hai.

## Abhi kahan hain

- `main` = production branch, jobblo.no (VPS + nginx + PM2). Push to main → CI → deploy (auto).
- Web, admin dashboard, developer console, mobile app (TestFlight) — sab chal rahe hain.
- Subscription V2 code me hai lekin flags OFF (production-ready nahi) — [TASKS.md](TASKS.md).
- Security Intelligence merged (PR #18); production rollout legal ke baad.
- Backend tests: 183 suites, 2332 pass (5 suites skipped: real Mongo/Redis wale). Web typecheck clean. App typecheck + checks clean.

## Faisle jo yaad rakhne hain

- Ek hi webhook endpoint: `/api/stripe/webhook` (purana `/api/safepay-checkout/webhook` alias).
- Payout ka wahid raasta `releasePayoutToProvider.js`; order transitions sirf `orderState.js`.
- Fee 3% provider se; purane orders apna `checkoutAmountMinor` snapshot rakhte hain.
- Redis optional; Docker production me nahi; migration framework nahi (one-off scripts + detectors).
- Developer access: `developerAccess` readonly/operations (purana `developerLevel` plan replace ho gaya); sensitive actions step-up + ChangeRequest.
- Sirf Norwegian customer UI; admin i18n; developer English.
- "Velg uten SafePay" aur nakli reviews page hamesha ke liye hataye gaye.
- Seed logins badal gaye: `customer1–8@`, `helper1–8@`, `painter@`, `cleaning@`, `moving@`, `carpenter@jobblo.no` (Bitwarden). Purane `user1..12@` ab nahi.
- Server path `/var/www/jobblo` (purane runbook ka `/srv/jobblo` ghalat tha).

## Log (naya upar)

- **2026-11-10** — Docs: saari purani `.md` files hata kar `docs/` me 6 files (PRD, ARCHITECTURE, RULES, DESIGN, TASKS, MEMORY); Agent.md rule set RULES me mila.
- **2026-11-10** — PR #19 (`feat/admin-reports-maintenance`): Global settings page; maintenance mode (poori site ya area, web + app + API); readiness env list; Tjenester job detail; Ordre detail redesign; Jobbrapporter + Chatrapporter fixes aur naya design; chat viewer fix + har open ka access log; Stripe-historikk shadcn; maintenance guard DB ka intezar nahi karta (CI 10s timeouts); `MAXMIND_*` readiness se hataye.
- **2026-11-06** — PR #18 Security Intelligence (install ids, IP intel, risk rules A–F, developer pages; app `X-Install-Id`). PR #17: Kartverket address search (web + app), alag Lokasjon page khatam, filter loading, Logs Explorer, IP page, landing LCP 3.7s → 2.7s, ek hi loader.
- **2026-11-05** — PR #16 "Rapporter en feil" (web + app).
- **Okt end 2026** — VPS deploy pipeline (`deploy.sh`, release tags, PM2 ecosystem, `setup-server.sh`, nginx micro-cache). AI prompt v2 (+20% eval).
- **2026-10-24** — Backend restructure (`bootstrap/`, folder splits, money files nahi). Redis + queues + cache (150 users p95 410 → 221ms). 12 Redis developer pages. jest 1648 green, Playwright 41/41. Ek parallel session ne bhi isi tree me kaam kiya.
- **2026-10-23** — SafePay order `6a982fc4` investigation khuli. Duplicate-payments archive tool drill. Payout refusals ErrorLog me.
- **2026-10-19** — Subscription branch audit: deploy na karein (F-01…F-08).
- **2026-10 (developer dashboard)** — Phases 1–6 shipped + mandatory TOTP 2FA + admin restyle. Env vault hataya.
- **Aug 2026 (B2C launch fixes #1–17, target 24 Aug)** — dead routes, error boundary; pehla Stripe webhook + Order schema fields; unguarded payout endpoint delete (`/api/safepay-checkout/approve` naya); success page payment verify; payout failure sach dikhaye; review eligibility; socket chat authorization; notification ownership; "Velg uten SafePay" + nakli reviews/contract data hataye; job create location/draft fixes; CORS allowlist, trust proxy, upload limits, password strength, consent-gated AdSense, `check-env`; account delete = anonymise; SupportTicket; auth limiter 20 fails/15 min.
- **2026-06-01** — commit `ff7eaab8` ne duplicate Payment rows banayin (code baad me upsert by `orderId` se theek).

## Local setup yaad

- Redis 8.10.2 portable: `C:\Users\GLB\redis` (`start-redis.cmd`; AOF+RDB, 512mb, noeviction). Logon par auto-start nahi.
- Local DB `jobblo-dev`; API :5001; web :5173; e2e backend :5017 + Vite :5176/:5177.
- Backend jest kabhi machine slow ho to app.js wali suites 5s timeout par fail — `--testTimeout=60000` se confirm.
