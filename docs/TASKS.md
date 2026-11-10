# TASKS — kaam chhote steps me

> Har task chhota, ek PR. Har task [RULES.md](RULES.md) ka "kaam ka tareeqa" follow kare (tests + ek runnable check). Khatam hone par yahan se hatayein aur [MEMORY.md](MEMORY.md) me ek line likhein.
> Priority: **P0** = launch/paise/security blocker · **P1** = launch se pehle · **P2** = baad me.

## P0 — paise, production, security

### Production config

- [ ] `STRIPE_WEBHOOK_SECRET` (live) set karein → [ARCHITECTURE.md §8](ARCHITECTURE.md#8-stripe-webhook-setup) ke steps → `/api/admin/stripe/webhook-readiness` = healthy.
- [ ] Production me `subscriptionplans` seed check (`npm run db:seed:plans -- --yes-wipe=<db>` sirf missing dalta hai). Khaali ho to har application raw 403 deti hai.
- [ ] Offsite backup (`BACKUP_OFFSITE_CMD` + rclone crypt) + cron + pehli drill ([ARCHITECTURE.md §9.1](ARCHITECTURE.md#91-backup-aur-disaster-recovery)).
- [ ] External uptime monitor (jobblo.no + `/api/filter/options`).
- [ ] Duplicate-payments archive production par `--apply` ([§9.2](ARCHITECTURE.md#92-duplicate-payments-archive-scriptsarchive-orphan-duplicate-paymentsjs)) — do log review.

### SafePay

- [ ] Order `6a982fc4…` (36 NOK, kabhi payout nahi): `pi_3UBEy7…` kis Stripe account ka hai, capture/accounting check, test data hai ya nahi — faisla.
- [ ] Fee ki confirmation: backend provider se 3% kaatta hai; app agent ke mutabiq app customer par bhi 3% dikhata hai (~6% asar). Product owner se tay → web, app, backend ek jaisa.
- [ ] `persistConnectAccount` `restricted` status kabhi save nahi karta — fix + test.
- [ ] User terms "ikke ansvarlig for betalingsoppgjør" kehti hain jo SafePay escrow se takrata hai — legal ke saath text theek.

### Subscription V2 (production-ready nahi — flags OFF rakhein)

- [ ] F-01: do TEST paid Pro upgrades Plus par atke (lifecycle lock held) — sirf delivery saboot + approval ke saath reconcile.
- [ ] F-02: `applyVerifiedPlanChange` me partial write — atomic/resumable + fault-injection test.
- [ ] F-03: compatibility gate auth se pehle `SUBSCRIPTION_REBUILD_IN_PROGRESS` deta hai → V2 ka apna code.
- [ ] F-04: job detail UI V1 `monthlyContactUsage` + band extra-contact purchase use karta hai.
- [ ] F-05: contact reserve aur `JobRequest` insert ke beech crash window.
- [ ] F-06: scheduler isolation.
- [ ] F-07/F-08: dependency advisories (sharp, nodemailer, jade, axios, react-router, vite, proxy-addr).
- [ ] Enable se pehle: consumer-law withdrawal review, refunds, extra-contact V2 fulfilment, usage-period index migration, Stripe Smart Retries (7 din).

### Security Intelligence rollout

- [ ] Legal: LIA, DPIA, ekomloven cookie faisla, privacy policy update.
- [ ] Production me `DEVICE_ID_SECRET` + indexes background me → backend → frontend → app deploy → ek din dekhein → ek hafte baad thresholds tune.
- [ ] MaxMind provider banayein (IP page abhi seedha ip-api call karta hai, jo production me off hai); phir `MAXMIND_*` readiness list me wapas.

## P1 — launch se pehle

### Admin / developer

- [ ] Report "Løs" karne par annonse/user par asal action (hide/delete annonse, user suspend) — abhi sirf label.
- [ ] Job report aane par admins ko, aur faisle par reporter ko notification.
- [ ] Chat report outcomes (`user_suspended`, `chat_restricted` …) abhi sirf label — asal action jodna.
- [ ] Mobile app me 2FA screen nahi → admin/developer app use nahi kar sakte.
- [ ] TTL: `errorlogs` (90d hai), `adminactivities`, `notifications` par TTL nahi.
- [ ] Admin `deleteUser` sirf soft-delete karta hai, personal data rehta hai → anonymise jaisa account delete.
- [ ] Purane `SafePayHistory` rows backfill; legacy `Transaction` rows schema fail (45 baghair `planId`, 12 `type: safepay`).

### Web

- [ ] System notifications ka read state per user (`readBy`); `markAllAsRead` system notifications skip karta hai.
- [ ] Frontend `chat-error` socket event sune.
- [ ] `getAllReviews` paginate.
- [ ] `/Publish-job/:id` contact fields prefill (`getServiceById` par optional auth).
- [ ] Preview map ka Oslo fallback.
- [ ] `usePaymentCalculation` Norwegian units (`timer`, `dager`, `minutter`).
- [ ] `/Anmeldelser` asli data ke saath.
- [ ] Dead code F-63 (14 paths) hatana — human `git rm`.
- [ ] ESLint backlog (ratchet 56) kam karein; [DESIGN.md §4](DESIGN.md#4-pata-hai-theek-karna-baqi) ke design mismatches.

### App

- [ ] Device par 32-case manual navigation test matrix (ab tak device par test nahi).
- [ ] Session revoke par us device ka push token band nahi hota; khule sockets disconnect nahi hote.
- [ ] Payout screen: Stripe onboarding se wapsi par gap.
- [ ] Disputes: list screen, attachments, user-side close (backend endpoints bhi).
- [ ] Sign-out ke dauraan aaya push tap login ke baad resume hota hai ya nahi — verify.
- [ ] `expo-doctor`: 10 Expo packages SDK 58 ke latest patch se peeche (`npx expo install --check`, phir device test).
- [ ] TestFlight client review (23 Okt 2026) ke P0/P1 items ka status device par confirm.

## P2 — baad me

- [ ] Production DB → MongoDB Atlas (Cloud Backup + PITR).
- [ ] Scaling: nginx `ip_hash` ke peeche doosra API process (upstream commented hai).
- [ ] Sentry wire karein (installed, inert) + app force-update check.
- [ ] Checkout par Vipps/Apple Pay (backend payment method forward kare).
- [ ] `revieweeRole` naming debt (poora, aadha nahi).
- [ ] Dashboard: reconciliation notes/approval, scheduled reports, ticket attachments, flag rollout %, SMS, bounce tracking, distributed tracing.
- [ ] Web dark mode toggle (tokens maujood).
- [ ] Legacy infra (argo-cd, terraform, traefik) rakhna hai ya hatana — faisla.
