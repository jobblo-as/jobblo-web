# ARCHITECTURE — Jobblo kaise bana hai

> Kya aur kyun → [PRD.md](PRD.md). Coding rules → [RULES.md](RULES.md). Design → [DESIGN.md](DESIGN.md).

## 1. Repo ka naqsha

```
jobblo/
├─ backend/        Express + MongoDB (Mongoose) + socket.io + Stripe   (Node 22)
├─ frontend/       React 19 + Vite 7 + TypeScript (web, admin, developer console)
├─ jobblo-app/     Expo SDK 58 + expo-router + NativeWind (iOS/Android)
├─ design-tokens/  tokens.json → web aur app ke tokens generate karta hai
├─ deploy/         nginx configs + setup-server.sh (VPS)
├─ .github/        CI, deploy, auto-merge workflows
├─ docs/           yeh 6 docs (+ security/ ki PDF/HTML reports)
├─ infra/, jobblo-argo-cd/, traefik-proxy/, docker-compose.yml   ← legacy/local, production me nahi
```

Teeno packages alag `package.json` ke saath hain; npm har package ke apne folder me chalta hai.

```
 Browser (jobblo.no)          iOS/Android app
        │  HTTPS                    │  HTTPS (+ X-Install-Id)
        ▼                           ▼
   nginx (TLS, micro-cache, /assets, socket sticky ip_hash)
        │
        ▼
   PM2 "jobblo-api" → cluster.js (WEB_CONCURRENCY workers) → app.js :5001
        │            │              │
     MongoDB      Redis (optional) Stripe / Azure Blob / SMTP / FCM+Expo / OpenAI / Vipps / Google / Apple / Idura
```

## 2. Backend

### 2.1 Boot

- `server.js` → `config/env.js` (`.env.<NODE_ENV>`; production sirf `backend/.env.production` padhta hai).
- `cluster.js`: `WEB_CONCURRENCY=N|auto` workers. Redis ke baghair sirf 1 process. Worker slot 1 single-instance kaam chalata hai (scheduler, alerts, synthetic, capacity, config drift). PM2 fork mode me (`pm2 -i` nahi, warna scheduler nahi chalta).
- `bootstrap/index.js`: production me non-loopback `HOST` par boot se inkaar (jab tak `ALLOW_PUBLIC_HOST=true`) → `db.js` (`MONGO_URI`) → `app.js` → http → socket.io (Redis adapter agar Redis) → listen `PORT` (5001) → `bootstrap/background.js` ke STARTERS → `bootstrap/shutdown.js` (scheduler → io → http → queue → redis → mongo, `SHUTDOWN_TIMEOUT_MS` 10s).

### 2.2 `app.js` middleware order (badalne se pehle soch lein)

1. `trust proxy` (loopback ya `TRUST_PROXY`)
2. **Stripe webhooks** — JSON parser aur rate limiter se **pehle**, raw body: `POST /api/stripe/webhook` (canonical) aur `POST /api/safepay-checkout/webhook` (legacy alias) → `services/stripe/webhookDispatcher.js`
3. `req.ip` ek dafa resolve · Apple form_post callback (apna parser)
4. CORS (`ALLOWED_ORIGINS`/`FRONTEND_URL`) · CSRF origin guard · requestMetrics · fault simulator · API contract sampler · `ipBlockGuard` · `apiLimiter`
5. Body parsers (256kb; `/api/errors/client` 32kb) · cookieParser · `deviceCookie` (`jb_did`)
6. `GET /api/maintenance` (public) → `maintenanceGuard`
7. Non-string cookies drop (NoSQL injection) · requestId · Azure SAS signing · passport · session sirf `/api/auth` par
8. Swagger `/api/docs` (production me sirf `ENABLE_API_DOCS`) · pagination guard · `routes/api.js` · notFound/uploadErrors/errorHandler

Rate limiters `middleware/rateLimiter.js` (`makeLimiter`, Redis ho to shared, fail-open): api, auth, auth-register, otp-send, otp-verify, admin, finance-sync (+ ai, errors, support, mobile, rum, campaign events).

### 2.3 Auth

- `middleware/auth.js`: `authenticate` (Bearer pehle, phir `accessToken` cookie; JWT purpose `access`; `Session` row honi chahiye; MFA gate), `optionalAuthenticate`, `requireRole`, `requireAdmin` (= superAdmin), `requireDeveloper` (developer ya superAdmin).
- Login → `Session` + access JWT (1 ghanta) + refresh JWT (7 din), dono httpOnly cookies, Bearer ke taur par bhi. `refresh-token` rotate karta hai (purane token ki choti grace window). Logout → session aur us session ke push tokens band.
- Providers: Google (`config/passport.js`), Vipps (`vippsController.js`), Apple (native id_token ya web form_post), BankID/Idura (`iduraAuthController.js`, ek BankID identity = ek user, `IdentityClaim`).
- Mobile OAuth: `/api/auth/mobile/*` + PKCE S256 + one-time `MobileOAuthCode` → `/auth/mobile/exchange`. Deep link me kabhi token nahi.
- MFA (TOTP, secret `MFA_ENCRYPTION_KEY` se encrypted) superAdmin/developer ke liye zaroori → `MFA_REQUIRED` 403.
- Password reset: OTP queue se email (`issueOtp`/`checkOtp`). Password: 8+ chars, lower+upper+digit.

### 2.4 Routes (`routes/api.js`)

| Mount                                                                                                                                   | Kaam                                                                                                                | Auth                 |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `/api/auth`, `/api/auth/web`, `/api/auth/mobile`                                                                                        | Register, email code, terms, login/logout/refresh, profile, MFA, sessions, password reset, Google/Vipps/Apple/Idura | mixed                |
| `/api/users`                                                                                                                            | Search, top, block, public profile, portfolio, certificates                                                         | auth                 |
| `/api/services`                                                                                                                         | Browse, nearby, my-posted, price-stats, create/update/delete (images), checklist, `/:id/reports`                    | zyada tar auth       |
| `/api/job-drafts`                                                                                                                       | Form drafts (web + app ek hi shape)                                                                                 | auth                 |
| `/api/favorites`, `/api/lists`                                                                                                          | Saved jobs, shared lists                                                                                            | auth                 |
| `/api/orders`                                                                                                                           | `POST /request` (apply), accept/decline, order list/detail                                                          | auth                 |
| `/api/chats`                                                                                                                            | Create-or-get, list, messages, contract (award), agreed-price, delete, reports                                      | auth                 |
| `/api/messages`                                                                                                                         | Purane order messages (legacy)                                                                                      | auth                 |
| `/api/safepay`                                                                                                                          | Contract, start, ready-for-review, evidence, checklists, reconcile-payment, history, finance, disputes              | auth                 |
| `/api/safepay-checkout`                                                                                                                 | Session banana, status, approve (payout), review photos, mobile-return                                              | auth                 |
| `/api/connect`                                                                                                                          | Stripe Connect account + onboarding link + status                                                                   | auth                 |
| `/api/stripe`                                                                                                                           | Subscription V2, extra contact, Hast, legacy subscription                                                           | auth                 |
| `/api/plans`, `/api/transactions`, `/api/jobbloShop`                                                                                    | Plans, transactions, shop                                                                                           | mixed                |
| `/api/applicants`, `/api/my-applications`                                                                                               | Owner ke applicants, meri applications                                                                              | auth                 |
| `/api/notifications`, `/api/push-tokens`                                                                                                | Tray, unread, push tokens + preferences                                                                             | auth                 |
| `/api/categories`, `/api/filter`, `/api/location-filter`, `/api/explore`, `/api/hero`, `/api/upcoming`, `/api/config`, `/api/campaigns` | Catalog/content (writes admin)                                                                                      | mostly public        |
| `/api/ai`                                                                                                                               | AI listing helpers                                                                                                  | auth                 |
| `/api/support`, `/api/errors`, `/api/rum`, `/api/mobile`, `/api/quality`                                                                | Tickets, client errors, web vitals, app telemetry, CI ingest                                                        | mixed                |
| `/api/admin` (`routes/admin/index.js` + legacy `routes/admin.js`)                                                                       | Admin dashboard                                                                                                     | superAdmin           |
| `/api/developer`                                                                                                                        | ~147 developer console endpoints                                                                                    | developer/superAdmin |
| `GET /api/maintenance`                                                                                                                  | Kya band hai                                                                                                        | public               |

Ajeeb baatein: `routes/publicStats.js` mounted nahi; `/api/coupons` 503 deta hai (`subscriptionRebuildInProgress`). Health check ke liye `/api/filter/options` istemal hota hai (alag `/api/health` nahi).

### 2.5 Models (`backend/models/`)

- **Marketplace:** `User` (role, accountType, Connect fields, BankID, `developerAccess`), `Service` (job post, GeoJSON, status, urgent), `JobDraft`, `JobRequest` (application), `Order` (contract), `Category`, `Favorite`, `List`, `Review`, `Norway{County,Municipality,Area}`, `Campaign`, `JobbloShop`, `UpcomingFeature`.
- **Chat:** `ChatMessage.js` model **`Chat`** register karta hai (embedded messages); `Conversation`/`Message` legacy; `ChatReport`, `JobReport`.
- **Paisa:** `Payment` (ek order = ek payment, unique `orderId`), `Payout`, `SafePayHistory` (escrow ledger), `Dispute`, `Transaction`, `StripeEvent` (webhook idempotency), `StripeTransferRecord`, `StripeBankPayoutRecord`, `StripeFinancialOperation`, `StripeFinancialSyncState`, `StripePaymentIncident`, `StripeWebhookHealth`, `ExtraContactPurchase`, `UrgentPurchase`.
- **Subscription V2:** `SubscriptionPlan`, `SubscriptionV2` (ek per user), `SubscriptionUsagePeriod`, `SubscriptionBillingOperationV2`, `SubscriptionWebhookEventV2`, `SubscriptionRecoveryEmailV2`. Purana `subscriptions` collection chhua nahi jata.
- **Auth/security:** `Session`, `StepUpOtp`, `MobileOAuthCode`, `IdentityClaim`, `AuthEvent`, `DeviceInstallation`, `DeviceObservation`, `SecurityEvent`, `SecurityAlert`, `IpBlock`, `FraudCase`.
- **Notifications:** `Notification`, `PushToken` (→ Session), `DeliveryLog`.
- **Ops:** `AdminActivity` (audit), `ChangeRequest`, `GlobalConfig` (key/value: `STRIPE_TEST_MODE`, `maintenance_mode`, feature flags, `security.riskConfig`), `ErrorLog` (90d TTL), `SupportTicket`, aur monitoring models (`ApiMetricMinute`, `SchedulerRun`, `BackupRun`, `Deployment`, `RumEvent`, `MobileEvent`, `QualityRun`, ... zyada tar 30d TTL).

**Customer/provider ulta naam (yaad rakhein):** `Order` me customer = job poster, provider = worker. `JobRequest` me customer = applicant, provider = poster. `Chat` me `clientId`/`providerId` kisi bhi order me. IDs hamesha `String(x?._id ?? x)` se compare karein.

### 2.6 Statuses

- **Order:** pending, accepted, declined, awaiting_payment, paid, in_progress, ready_for_review, completed, cancelled, disputed. Transitions sirf `services/order/orderState.js` (`ORDER_TRANSITIONS`).
- **paymentStatus:** unpaid, pending, paid, refunded. UI ko `status` par chalayein, `paymentStatus` par nahi.
- **Service:** open … closed/expired/draft, `waiting_for_approval` (= order ka `ready_for_review`).
- **Payout:** pending → released_internal → processing → transferred / failed / reconciliation_required. releaseSource: customer_approve, dispute_release, admin_override, legacy_complete.
- **Dispute:** active jab tak resolved/closed/cancelled na ho.

### 2.7 Paise ke units aur Stripe mode

- Business fields **NOK kroner** (major): `price`, `agreedPrice`, `Payment.amount`, `Payout` gross/net, `SubscriptionPlan.price`.
- `*Minor` fields **øre** (×100): `checkoutAmountMinor`, `capturedAmountMinor`, refunds, `ExtraContactPurchase.amountMinor`, `UrgentPurchase.amountMinor`. Conversion sirf Stripe boundary par `Math.round(kr * 100)`. Admin finance API minor units deta hai.
- Fee 3%: `utils/safePayAmounts.js` (`SAFEPAY_FEE_RATE`); web/app me `utils/safePayFee.ts`.
- Mode: GlobalConfig `STRIPE_TEST_MODE` (strict parse; khaali = live). Key prefix mode se match hona chahiye (`sk_test_`/`sk_live_`), modes ke beech koi fallback nahi. API version `2025-12-15.clover`. Webhook dono modes ke secret se verify, event ke `livemode` ke client se process. Connect account ka mode bhi match (`STRIPE_CONNECT_ACCOUNT_MODE_MISMATCH`).

## 3. Business flows (end to end)

### 3.1 Job post → apply → award

1. `serviceController` / `controllers/services/manageController.js`: Service banta hai (images Azure par; prepaid Hast publish par istemal).
2. Apply: `orderController.createJobRequest` — service open ho, active order na ho, block na ho, applicant ka Connect ready ho. Contact `v2Entitlements.consumeApplicationContact` se atomically (`job-request:<id>`); paid extra contact pehle. Message ho to Chat bana/reuse.
3. Owner accept/decline: `updateJobRequestStatus` + `applicantController`.
4. Award: `chatController.createContract` ya `safepayController.createContract` — dono `services/order/contractLock.js` se serialize. Price hamesha negotiated value se, request body se kabhi nahi.

### 3.2 SafePay escrow

1. `SafePayCheckoutController.createSafePaySession` — Stripe Checkout (min 3 NOK), `checkoutAmountMinor` snapshot, purani session reuse/expire.
2. `confirmPaidSession` (idempotent) — webhook (`checkout.session.completed` / `async_payment_succeeded`), status endpoint, ya `reconcilePayment` se. Payment + SafePayHistory + Order `paid`; provider-connect deadline shuru.
3. Provider: `startJob` (status `paid` zaroori) → evidence (before/after, max 10 har taraf, ≤10 MB, jpeg/png/webp/pdf) + checklist → `markReadyForReview`.
4. Customer: `approveAndPayout` (rating ≥1, review photos) → **`services/payout/releasePayoutToProvider.js` — wahid release ka raasta**: payout lock → `stripe.transfers.create` Connect account par (price − 3%) → idempotent.
5. Auto-release `SAFEPAY_AUTO_RELEASE_DAYS` (14), warning `SAFEPAY_AUTO_RELEASE_WARN_DAYS` (3). Provider start na kare → `providerConnectTimeout.js` refund + cancel. Active dispute sab actions rok deta hai.
6. Interrupted payment: `POST /api/safepay/orders/:id/reconcile-payment`. Transfers/bank payouts mirror: `services/stripe/financialHistory.js`.

### 3.3 Disputes aur incidents

- User: `disputeController.openDisputeByUser` (payout lock ho to inkaar). Allowed states: `services/admin/safePayStateService.js`. App: 12 categories, title ≤200, description ≤2000; list screen, attachments aur user-close abhi nahi.
- Admin: `disputesAdminController.resolveDispute` → release_to_provider, full_refund_to_customer, partial_refund, split_payment, cancel_without_payment, no_action.
- Chargebacks/refunds/duplicates: `services/stripe/paymentLifecycle.js` → `StripePaymentIncident`.

### 3.4 Chat

- `chatController` (5000 chars, send-rate limit, block check, notify) + `sockets/chat.socket.js` (authenticated handshake, session re-check; events `join-chat`, `leave-chat`, `send-message`→`receive-message`, `mark-as-read`, `messages-read`, `chat-error`). Rooms server-side (`sockets/rooms.js`).
- Doosre socket events (`new_notification`, `order_status_changed`, `order_ready_for_review`, `payment_confirmed`, `order_completed`) ko **cache invalidation** samjhein, data nahi.

### 3.5 Subscriptions (V2, flags `SUBSCRIPTION_V2_*_ENABLED`, sab default OFF)

- Checkout `POST /api/stripe/v2/create-checkout-session {planId}` → `{url}`; provisioning sirf webhook se.
- Management: GET/cancel (period end)/resume/change/preview, portal. Upgrade = foran proration; downgrade = schedule.
- Entitlements: `GET /api/stripe/v2/entitlements`; private free period = UTC calendar month; business baghair subscription = 0 contacts.
- Grace 7 din (`invoice.payment_failed`), recovery emails; extra contacts (`v2ExtraContacts.js`); Hast (`services/urgentPurchase.js`, `HAST_DURATION_MINUTES`).
- Webhook routing `metadata.type`: subscription / extra_contact / urgent, warna SafePay.
- Legacy V1 routes 503 `SUBSCRIPTION_REBUILD_IN_PROGRESS`. Migration: `node scripts/migrate-subscription-usage-period-index.js`. Stripe me Smart Retries 7 din ke andar.

### 3.6 Notifications

`services/notifications/index.js` `notify()` → Notification save + socket emit. Push queue → `services/pushNotifications.js` (Android FCM `firebaseAdmin.js`, iOS Expo). Email: `utils/emailService.js` (SMTP). Push taps app me: chat → chat, job_request → applicants, application_status → my-applications, support_ticket → support, system → alerts.

### 3.7 Reports

Job reports (`jobReportController` → admin `/job-reports`), chat reports (`chatReportController` + evidence, rate limit 5/ghanta → admin `/chat-reports`). Admin chat kholna access reason maangta hai aur `AdminActivity` me log hota hai.

### 3.8 Maintenance mode

`services/maintenance.js`: GlobalConfig `maintenance_mode` (10s cache; DB connected na ho to query nahi, pichli state ya "open"). Poori site ya area-wise (`AREAS`) → 503 `{code:'MAINTENANCE', area, message}`. Staff, sign-in, admin/developer APIs aur webhooks hamesha khule. Web/app `GET /api/maintenance` se screen dikhate hain. Admin: `/dashboard/maintenance`.

### 3.9 Security intelligence

- Install id: web `jb_did` signed httpOnly cookie (1 saal, sirf auth endpoints par set), app `X-Install-Id`. Sirf `HMAC(DEVICE_ID_SECRET, id)` save, `DEV-XXXX` dikhta hai.
- Observations 10s buffer → `deviceinstallations` (180d) / `deviceobservations` (90d). `security` queue: enrich (IP intel, `ipintel:v1:<ip>` 24h) + evaluate.
- Risk rules: A ≥4 networks/60 min · B residential→VPN · C ≥3 accounts/30 din · D ≥5 failed logins/10 min · E ≥20 rate-limited/15 min · F naye pair ya VPN se sensitive change. Score Σ weight×confidence (+10 do rules, +20 teen+), max 100, bands 25/50/75 → `securityalerts`. Sweep har 15 min. **Kuch bhi auto-block nahi.** Thresholds GlobalConfig `security.riskConfig`.
- `IPINTEL_IPAPI` production me off (free tier non-commercial). Band karna: `DEVICE_ID_SECRET` hatayein + restart. Poora rollback: 3 collections drop + `security.riskConfig` delete.

### 3.10 Admin aur developer

- Admin (`routes/admin/index.js` → `controllers/admin/*`): overview, users (role/status/verify/soft delete/MFA reset/sessions), orders, services (+ activity), reviews, categories, transactions, SafePay + finance, disputes, chats, reports, audit, health, config, content, maintenance, shop, campaigns, promo codes, billing, webhook readiness, payment incidents.
- Developer (`routes/developer.js` → `controllers/developer/*`, `services/monitoring/*`): monitoring, infra, Redis, payments, users/support, security intelligence, ops. Access `User.developerAccess` readonly/operations. Sensitive actions (`services/developer/sensitiveActions.js`): email step-up code → 10 min `X-Step-Up-Token` + `ChangeRequest` jo superAdmin approve kare (apni kabhi nahi). Critical change-risk → 409 `RISK_CONFIRM`. Console me koi exec, Mongo query, env value ya paisa operation nahi; `redact()` har jagah. Failure simulator production me kabhi nahi (`ENABLE_FAILURE_SIMULATOR`).

### 3.11 Background kaam

Scheduler (`services/scheduler/`, Redis ho to BullMQ, warna timers; runs `SchedulerRun` me):

| Job                                                                  | Har                                     |
| -------------------------------------------------------------------- | --------------------------------------- |
| autoReleaseStaleReviews                                              | 6h                                      |
| warnBeforeAutoRelease                                                | 12h                                     |
| retryFailedPayouts                                                   | 2h                                      |
| cleanupAbandonedOrders                                               | 6h (`SAFEPAY_ABANDONED_ORDER_HOURS` 72) |
| expireUrgentMarks, refundUnusedUrgent                                | 1h                                      |
| recordSafePayConnectReadiness, cancelExpiredUnconnectedSafePayOrders | 15 min                                  |
| reconcileMoneyState, reconcileStripeFinancialHistory                 | 24h                                     |
| cancelExpiredSubscriptionRecoveries                                  | 1 min                                   |
| dispatchSubscriptionRecoveryEmails                                   | 5 min                                   |
| securityRiskSweep                                                    | 15 min                                  |
| backupDatabase                                                       | sirf `BACKUP_SCHEDULE_HOURS` ho to      |

Queues (`services/queue/`): `email` (5 attempts, 30s exp), `push` (3, 10s), `security`, `scheduler`. Failed jobs 14 din. Redis na ho ya 3s se slow ho to in-process. `ENABLE_WORKERS=false` = sirf producer. Job data me secrets sealed (`utils/secretBox`, AES-256-GCM).

Redis optional: limiters, cache (`cacheJson`: categories 5 min, filter options 30s, location tree 1h), socket adapter, queues. Redis band = degrade, crash nahi.

## 4. Web frontend (`frontend/`)

- React 19.1, TS 5.8, Vite 7, react-router 7 (`createBrowserRouter`), TanStack Query 5 (`src/lib/queryClient.ts`: retry 1, no refetch on focus; logout par clear), zustand 5, Tailwind v4, shadcn/radix, lucide, react-hot-toast (public + admin), sonner (developer console). antd kuch purani screens par.
- `src/api/mainURLs.ts`: wahid axios (withCredentials, 30s, interceptors `lib/axios.ts`: Bearer, 401 par single-flight refresh, MFA redirect, maintenance toast). Domain API files: `api/*`, `api/admin/*`.
- `stores/userStore.ts`: sirf preferences persist (role/token kabhi localStorage se nahi). `bootstrap()` refresh cookie → access token → profile.
- `features/*` (api + query hooks), `hooks/*`, `socket/socket.ts`, `i18n/` (sirf admin), `theme/` + `styles/` (tokens).
- Routes (`src/routing/Routes.tsx`, sab lazy):
  - Public: `/`, `/home`, `/search`, `/jobs/:id`, `/job-listing/:id`, `/profile/:userId`, info/terms pages.
  - Auth: `/login`, `/register`, `/forgot-password`, `/mfa`, `/oauth-success`.
  - User: `/profile`, `/mine-annonser`, `/Publish-job/:id?`, `/messages`, `/job-applicants/:serviceId`, `/my-applicants`, `/my-applications`, `/favorites`, `/membership`, `/completed-job`, `/settings/*`.
  - Provider/SafePay: `/provider/orders/:orderId`, `/safepay/checkout|success|approval`.
  - `/dashboard/*` (sirf superAdmin + MFA), `/developer/*` (developer/superAdmin + MFA). Guards role sirf server se aaye user se padhte hain.
- Env: `VITE_MAIN_URL`, `VITE_GOOGLE_MAPS_API_KEY` (dono ke baghair build fail — `scripts/check-env.mjs`), `VITE_APPLE_SIGNIN_ENABLED`, `VITE_PUBLIC_SITE_URL`, `VITE_ADSENSE_CLIENT` (sirf cookie consent ke baad), `VITE_PROXY_TARGET` (dev).

## 5. Mobile app (`jobblo-app/`)

- Expo SDK 58, RN 0.88, expo-router (typed routes), TanStack Query 5, zustand, NativeWind 4, gesture-handler, reanimated, react-native-maps, expo-location/notifications/secure-store/apple-authentication, socket.io.
- `app.json`: bundle `com.jobblo.app`, scheme `jobblo`. `app.config.js`: production me `EXPO_PUBLIC_API_URL` = `https://jobblo.no(/api)` zaroori, Maps plugin sirf keys ke saath. `eas.json`: development (dev client), preview (APK), production (autoIncrement) → `eas build --profile production --platform ios --auto-submit` (TestFlight).
- Navigation: `app/_layout.tsx` (providers, error boundary, maintenance overlay, push tap routing) → `(auth)` stack (welcome, login, register, forgot-password, oauth-success, terms-acceptance) → `(app)` tabs (Hjem, Legg ut, Meldinger, Varsler, Profil) + hidden screens (explore, jobs/[id], my-jobs, my-applications, job-applicants, messages/[chatId], provider/orders, safepay/_, disputes/_, profile/_, settings/_). Order ke liye har jagah `src/utils/orderRoute.ts`; provider kabhi checkout/approval par nahi jata.
- `src/api/client.ts`: baseURL `/api` par khatam, `X-Install-Id` + `X-Device-Name`, token SecureStore me, refresh cookie native jar me, 401 par ek refresh (token ka `id` same user ka ho), maintenance Alert.
- Create job: ek sawal ek screen (photos → category → details → text → price → place → review), max 6 photos, Kartverket address search (`services/geonorge`), drafts web ke saath share, coordinates `[lng,lat]`.
- Feature flags (`src/config/features.ts`): `MEMBERSHIP_ENABLED` (iOS par kabhi nahi), `HAST_ENABLED`, `APPLE_SIGNIN_MODE`.
- Telemetry: `src/monitoring/reporter.ts` → `POST /api/mobile/telemetry` (koi body/token nahi).
- Checks: `node src/**/*.check.mjs` (15+ files, `node:assert`), `npx tsc --noEmit`, `npx expo export` (bundle check). Koi jest/e2e nahi.

## 6. Environments aur env vars

- Local: API :5001, web :5173, DB `mongodb://127.0.0.1:27017/jobblo-dev`, Redis optional. Isolated e2e: backend :5017 (`scripts/start-isolated-test.js`, `ENABLE_SCHEDULER=false`), Vite :5176/:5177.
- Production zaroori: `MONGO_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SESSION_SECRET`, `ALLOWED_ORIGINS`/`FRONTEND_URL`, `TRUST_PROXY`, `MFA_ENCRYPTION_KEY`, `DEVICE_ID_SECRET`, Stripe keys + webhook secrets, `SMTP_*`, Azure storage.
- Groups (naam sirf; values kabhi docs me nahi): Core, Stripe, SafePay/feature flags, Sign-in (Google/Vipps/Apple/Idura), Storage/mail/push/AI, Security/monitoring, Backups — poori list `backend/.env.example` me aur developer console → Tools → Readiness (`toolsController` `ENV_KEYS`).

## 7. Deploy aur infra

- **Production:** ek VPS, jobblo.no. nginx (`deploy/nginx`): upstream `jobblo_api` 127.0.0.1:5001, socket `ip_hash`, public GETs ka micro-cache, JSON access log, security headers, `index.html` no-cache, `/assets` cached, crawler share cards, Certbot TLS. Root `/var/www/jobblo/frontend/dist` → `.releases/frontend/<stamp>` symlink.
- PM2 `jobblo-api` (`backend/ecosystem.config.js`): production, `HOST=127.0.0.1`, `WEB_CONCURRENCY=auto`, fork mode, `kill_timeout` 16000.
- `deploy/setup-server.sh`: ek dafa, idempotent (env check, Redis, nginx backup+install, PM2, health check).
- **CI (`ci.yml`)** har push + PR to main, path-filtered: backend (Node 22, `npm audit --audit-level=high`, `npm run test:quality`), frontend (Node 20, audit, ESLint ratchet `MAX_ERRORS=56`, typecheck blocking, build), gitleaks, Prettier `--check` (badli files), mobile (audit critical, `expo config`).
- **Deploy (`deploy.yml`)** green CI ke baad `vars.DEPLOY_BRANCH` par: SSH forced command → `deploy.sh --skip-ci-check` → tested sha fast-forward, frontend nayi release dir, `npm ci --omit=dev`, PM2 reload, health `/api/filter/options`, symlink swap, `nginx -t` + reload, 5 builds rakhe, ghalti par auto rollback, GitHub release `v<YYYY.MM.DD-sha8>`.
- **Auto-merge (`auto-merge.yml`):** PR to main → `gh pr merge --auto --merge`.
- Legacy (production me nahi): `jobblo-argo-cd` (k8s kustomize), `infra/*.tf` (Azure: RG, ACR, storage, Cosmos), `docker-compose.yml` (sirf local), `traefik-proxy` (khaali Dockerfile).

## 8. Stripe webhook setup

1. Endpoint: `POST https://<api-host>/api/stripe/webhook` (raw body, signature verified).
2. Events: SafePay `checkout.session.completed` / `.async_payment_succeeded` / `.async_payment_failed` / `.expired`; Connect `transfer.created`, `transfer.reversed`, `payout.created|updated|paid|failed|canceled` (connected accounts); Subscription V2 se pehle `customer.subscription.created|updated|deleted`, `invoice.paid`, `invoice.payment_failed` (+ baad me `subscription_schedule.*`). Snapshot payload format.
3. Secrets: `STRIPE_TEST_WEBHOOK_SECRET` / `STRIPE_WEBHOOK_SECRET` → restart.
4. Ek non-financial event resend (`account.updated`) → `GET /api/admin/stripe/webhook-readiness` me `healthy` + recent `lastVerifiedAt`. Tab tak live checkout fail-closed; 30 din signed event na aaye to phir band. Key/secret/mode badlein to dobara.
5. Local: `stripe listen --forward-to localhost:5001/api/stripe/webhook`.

## 9. Runbooks

### 9.1 Backup aur disaster recovery

- Targets: RPO = `BACKUP_MAX_AGE_HOURS` (26h); retention `BACKUP_RETENTION_DAYS` (14, naye 3 hamesha); RTO har hafte ki drill se.
- Setup (VPS, ek dafa):
  1. MongoDB Database Tools (`MONGODUMP_BIN`/`MONGORESTORE_BIN`).
  2. `sudo mkdir -p /var/backups/jobblo && sudo chown jobblo: /var/backups/jobblo && sudo chmod 700 /var/backups/jobblo` → `BACKUP_DIR=/var/backups/jobblo`.
  3. Cron: `30 2 * * * cd /var/www/jobblo/backend && node scripts/backup.js backup >> /var/log/jobblo-backup.log 2>&1` aur `0 4 * * 0 cd /var/www/jobblo/backend && node scripts/backup.js drill >> /var/log/jobblo-backup.log 2>&1` (ya app ke andar `BACKUP_SCHEDULE_HOURS=24`).
  4. Offsite zaroori: `BACKUP_OFFSITE_CMD=rclone copyto {file} jobblo-offsite:jobblo-backups/{name}` (rclone crypt, 30d+).
  5. Ek dafa haath se backup + drill.
- Atlas par: Cloud Backup + PITR, read-only service account (`ATLAS_*`).
- Drill: SHA-256 → `<db>_restore_drill` me restore → counts compare (max(5, 0.1%)) → drop. Fail = `restore_drill_failed` alert.
- **Production restore** (haath se, do log):
  1. Incident declare + maintenance mode on.
  2. Sab se naya drilled archive, `sha256sum`.
  3. Pehle current DB dump.
  4. `mongorestore --config=<file> --archive=jobblo-<stamp>.archive.gz --gzip --nsInclude='jobblo.*' --nsFrom='jobblo.*' --nsTo='jobblo_restored.*' --stopOnError` → spot-check.
  5. `MONGO_URI` switch (ya `--drop` original naam me) + restart.
  6. Paisa reconcile: Stripe source of truth; gap ke Stripe events resend; Reconciliation + Data Integrity; saaf hone tak koi manual payout/refund nahi.
  7. Maintenance off, RTO note.

### 9.2 Duplicate payments archive (`scripts/archive-orphan-duplicate-payments.js`)

Wajah: commit `ff7eaab8` (2026-06-01) ne duplicate `Payment` rows banayi, jo unique `payments.orderId` index rok rahi thin.

1. Dry run: `MONGO_URI=<prod> node scripts/archive-orphan-duplicate-payments.js --export dup-review-prod.json --verify-stripe` (candidate sirf jab order gayab, Stripe ref nahi, koi related SafePayHistory/Payout/StripeFinancialOperation/StripePaymentIncident nahi).
2. Backup: `mongodump --uri=<prod> --collection=payments --out=backup-payments-<date>` → scratch DB me test restore → backup id note.
3. Har row manual review, do log sign-off.
4. Apply: `--apply --backup-ref=<id> --reviewed=<count>` → `payments_archive` me copy, delete, unique index → `getIndexes` me `orderId_1` unique.
5. Rollback: `--restore=<archiveBatch> --drop-unique-index` (idempotent).

### 9.3 Seeds aur scripts

- Seeds production me nahi chalte; `--yes-wipe=<dbname>` zaroori: `npm run db:wipe|db:seed|db:seed:categories|db:seed:plans -- --yes-wipe=jobblo-dev`. Plan seed sirf missing plans dalta hai. Seed logins: `customer1–8@`, `helper1–8@`, `painter@`, `cleaning@`, `moving@`, `carpenter@jobblo.no` (passwords Bitwarden me).
- `scripts/`: `check-payment-config.js` (read-only preflight), `e2e-job-flow.js`, `load-test.js`, `backup.js`, `quality-report.js`, migrations (`migrate-*`, `fix-phone-index`, `dedupe-payment-records`, `merge-duplicate-chats`, `configure-plan-prices`), `start-isolated-test.js`, `local-cluster.ps1`.
