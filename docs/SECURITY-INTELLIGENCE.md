# Security Intelligence — device intelligence, IP intelligence and risk findings

Developer dashboard → **Security Intelligence**. It answers "which installation did this, from
which networks, with which accounts, and is it worth a look" — with evidence and a confidence
level, never a verdict. **A VPN alone is not fraud. Nothing here blocks, bans or rate-limits an
account by itself**; developers decide, through the existing audited actions.

## What it is made of

```
request ─► requestMetrics 'finish'
             ├─ securityEvents.record      (401/403/429, failed sign-in …  → SecurityEvent, +deviceKey)
             └─ observations.record        (installation × IP × account   → buffer, flushed every 10 s)
                                                 │
                         DeviceInstallation / DeviceObservation (upserts) + device_new_ip / device_new_account
                                                 │
                     queue 'security' ─ enrich(ip)      → ipIntel.classify → observation.network → evaluate
                                     └─ evaluate(device) → risk rules A–F → SecurityAlert (deduped) → riskScore
scheduler 'securityRiskSweep' (15 min) ─► evaluate every installation active in the last 20 min
```

| Piece                                                     | File                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Installation id (web cookie `jb_did`, app `X-Install-Id`) | `backend/services/security/deviceId.js`, `jobblo-app/src/utils/installId.ts`                  |
| Observations (buffer, dedupe, derived events)             | `backend/services/security/observations.js`                                                   |
| IP intelligence (provider-agnostic)                       | `backend/services/security/ipIntel/`                                                          |
| Risk rules A–F, score, engine                             | `backend/services/security/risk/`                                                             |
| Dashboard read models                                     | `backend/services/security/intel.js`                                                          |
| API                                                       | `backend/controllers/developer/securityIntelController.js`, `/api/developer/security-intel/*` |
| Pages                                                     | `frontend/src/pages/DeveloperDashboard/Security*.tsx`                                         |

### Identification — what it can and cannot say

- **Web**: a random UUID in a first-party, `httpOnly`, `SameSite=Lax`, signed cookie (1 year),
  issued only on sign-in related endpoints (login, register, profile, refresh, OTP, MFA, OAuth
  callbacks). A visitor who never signs in gets none; public responses carry no `Set-Cookie`.
- **App**: a random UUID made at install, sent as `X-Install-Id`. Client-made → confidence
  "claimed"; a reinstall is a new installation.
- Stored: only `deviceKey = HMAC(DEVICE_ID_SECRET, id)`; shown as `DEV-XXXX`.
- **Not** a physical device. Another browser, a private window or cleared cookies is another
  installation; a copied cookie looks like the same one. No fingerprinting, no hardware ids.

### Rules (thresholds editable in Security Analytics → Rule thresholds)

| Rule                | Fires                                          | Severity                          | Guarded against                                    |
| ------------------- | ---------------------------------------------- | --------------------------------- | -------------------------------------------------- |
| A Many networks     | ≥ 4 networks / 60 min                          | medium, high ≥ 8                  | a phone inside one mobile AS, one /24, private IPs |
| B VPN transition    | residential/mobile, later VPN/proxy            | low (Tor: medium)                 | VPN-only users, VPN-first, unknown class           |
| C Several accounts  | ≥ 3 accounts / 30 days                         | medium, high ≥ 6                  | flagged "could be a shared computer"               |
| D Failed sign-ins   | ≥ 5 / 10 min with changing networks            | high; ≥ 10 from one place: medium | one person forgetting a password                   |
| E Request bursts    | ≥ 20 rate-limited / 15 min                     | medium, high ≥ 60                 | — (rate limiter already protects)                  |
| F Sensitive changes | account/payout change from a fresh pair or VPN | medium, high if both              | an old, ordinary pair                              |

Score = per rule `weight × confidence` (confirmed 1, likely 0.8, possible 0.6), +10 for 2 rules,
+20 for 3+, capped at 100. Bands: low < 25 ≤ medium < 50 ≤ high < 75 ≤ critical.

## Environment

| Variable             | Default                            | Production                                                                                                                                              |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEVICE_ID_SECRET`   | dev placeholder outside production | **Required** (32+ random chars, its own value). Empty = identification **off** (no cookie, no observations). Rotating it forgets every installation.    |
| `IPINTEL_IPAPI`      | on outside production              | **off** unless set to `on`. ip-api's free tier is non-commercial and plain HTTP (IPs leave the EEA unencrypted). Needs a paid plan or another provider. |
| `IPINTEL_TIMEOUT_MS` | 3000                               | per provider                                                                                                                                            |

Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

## Database

New collections (indexes are created by Mongoose on boot; on a large database create them first,
in the background, before deploying):

| Collection            | Indexes                                                                                                                                   | TTL                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `deviceinstallations` | `deviceKey` unique · `userIds` · `lastSeen -1`                                                                                            | 180 d after `lastSeen`                            |
| `deviceobservations`  | `{deviceKey, ip}` unique · `{deviceKey, lastSeen}` · `{ip, lastSeen}` · `{userId, lastSeen}`                                              | 90 d after `lastSeen`                             |
| `securityalerts`      | `dedupeKey` unique · `{status, lastSeen}` · `{deviceKey, status}` · `{userIds, lastSeen}` · `{ruleId, lastSeen}` · `{severity, lastSeen}` | 365 d after `closedAt` (open alerts never expire) |

Changed: `securityevents` + `deviceKey` field and a partial index `{deviceKey, at}`; two event
types `device_new_ip`, `device_new_account` (TTL unchanged, 30 d). `sessions` + `deviceKey`.
Thresholds: `globalconfigs` key `security.riskConfig`.

## Redis and workers

- Queue **`security`** (BullMQ): jobs `enrich` (concurrency 5, 2 attempts) and `evaluate`
  (one per installation per minute, `jobId` dedupe). Redis off → jobs run in-process (inline).
- Cache keys `ipintel:v1:<ip>` (24 h; 1 h when unknown).
- Per API worker: an observation buffer (cap 5000 / 10 s) and a 10-minute sighting dedupe (cap
  50 000) — listed in `cluster.js` PER_WORKER_STARTERS.
- Scheduler: `securityRiskSweep` every 15 min (one instance, like the other scheduled jobs).

Measured request-path cost (this machine): repeat request of a known browser **~3 µs**, a new
installation-IP pair ~50 µs, anonymous request ~7 µs. No query and no external call on the
request path.

## Privacy (GDPR / Norway)

- Purpose: security and fraud prevention. Proposed lawful basis: legitimate interest (Art.
  6(1)(f)) — **document an LIA**.
- The `jb_did` cookie is set as strictly necessary for security. **Legal review needed** before
  production (Norwegian cookie rules in ekomloven); if consent is required, gate `deviceCookie`.
- **A DPIA is likely required** (systematic monitoring, profiling for fraud). Do it before rollout.
- Minimisation: no raw ids, browser/OS family instead of the user agent, emails masked in every
  response, no IP in logs, retention as above (also listed on Privacy & Data).
- Data subject rights: the privacy export includes the account's installations and IP sightings;
  account deletion removes its sightings and takes the account off installations and alerts.
- Access: every developer reads; status changes, escalations and threshold changes need
  `operations` access and are written to the audit log.

## Rollout checklist

1. Legal: LIA, DPIA, cookie decision. Update the privacy policy (security cookie, IP history).
2. Set `DEVICE_ID_SECRET` in production. Leave `IPINTEL_IPAPI` empty (off) unless a paid plan.
3. Create the indexes above (background) on the production database.
4. Deploy backend, then frontend, then the app (the app header is optional; old builds just
   send none).
5. Watch for a day: Queues → `security` (failures), Security Overview (volume), Privacy & Data
   (retention passes).
6. Tune thresholds from Security Analytics after a week of real data (high false-positive share
   per rule = threshold too tight).

## Rollback

- **Off switch, no deploy**: unset `DEVICE_ID_SECRET` and restart → no cookie, no observations,
  no new alerts. Existing data stays and expires by TTL.
- **Full rollback**: deploy the previous build. The new collections are unused and expire by TTL;
  drop them early with `db.deviceinstallations.drop()`, `db.deviceobservations.drop()`,
  `db.securityalerts.drop()` if wanted. The extra `deviceKey` fields on sessions/security events
  are ignored by the old code.
- Thresholds: delete `globalconfigs` `{ key: 'security.riskConfig' }` to return to defaults.

## Known limitations

- The IP page's own network card (`ipGeo.networkFor`) still calls ip-api directly, also in
  production. Moving it to `ipIntel` needs a provider (MaxMind GeoIP2 Anonymous IP is the
  recommendation: a local database, nothing leaves the server).
- Without a paid provider, production classification is Tor only; VPN/proxy/hosting/mobile show
  "unknown", so rule B rarely fires there.
- An installation id can be deleted, copied or (app) forged; confidence says so. Rules weigh
  context; none is proof.
- The 10-minute dedupe and the alert sweep are per process / bounded (2000 installations per
  sweep) — see the `ponytail:` notes in the code for the upgrade paths.

## Tests

- `backend/__tests__/deviceIntelligence.test.js` — ids, cookie scope, memoisation, observation
  selection, dedupe, spoofed `X-Forwarded-For`, the example scenario, IP classification, provider
  failure / timeout, Redis down.
- `backend/__tests__/securityRisk.test.js` — rules A–F with their false positives, score, config,
  dedupe / reopen / false positive, concurrent inserts.
- `backend/__tests__/securityIntel.test.js` — write routes need operations, read-only gets 403,
  input refused before any query.
- `backend/__tests__/securityIntel.realmongo.test.js` — end to end on MongoDB (opt-in:
  `SECURITY_REAL_MONGO_URI=mongodb://127.0.0.1:27017 npx jest securityIntel.realmongo`).
- `frontend/e2e/security-intel.spec.js` — the pages, a false-positive decision, a threshold change.
- `frontend/e2e/developer-pages-render.spec.js` — every developer page, including these, with an
  empty and a down API.

## Changelog (files)

Backend — new: `models/DeviceInstallation.js`, `models/DeviceObservation.js`,
`models/SecurityAlert.js`, `services/security/{deviceId,observations,intel}.js`,
`services/security/ipIntel/{index,providers/torExitList,providers/ipApi}.js`,
`services/security/risk/{config,score,engine}.js`, `services/security/risk/rules/*.js`,
`controllers/developer/securityIntelController.js`, the four test files above.
Backend — changed: `app.js`, `cluster.js`, `bootstrap/background.js`,
`middleware/requestMetrics.js`, `models/{SecurityEvent,Session}.js`, `utils/tokenUtils.js`,
`services/monitoring/{securityEvents,privacy}.js`, `services/queue/{index,handlers}.js`,
`services/scheduler/index.js`, `routes/developer.js`, `controllers/users/profileController.js`,
`.env.example`, `.env.production.example`.

Frontend — new: `pages/DeveloperDashboard/{SecurityIntelOverview,SecurityDevices,SecurityDevice,SecurityAlerts,SecurityEventsIntel,SecurityAnalytics}Page.tsx`,
`components/developer/security/{SecurityUi.tsx,labels.ts}`, `components/developer/useLocalPaging.ts`,
`e2e/security-intel.spec.js`. Changed: `api/developer.ts`, `features/developer/hooks.ts`,
`pages/DeveloperDashboard/{nav.ts,IpDetailPage.tsx}`, `routing/Routes.tsx`,
`e2e/developer-pages-render.spec.js`.

App — new: `src/utils/installId.ts`. Changed: `src/api/client.ts`.
