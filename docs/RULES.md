# RULES — coding standards

> Har insaan aur har AI agent ke liye jo is repo me kaam kare. Repo ka structure source of truth hai; jo yahan likha hai wo default behaviour se upar hai.
> Sources: purana `AGENTS.md` (Ponytail ladder), `docs/ENGINEERING-RULES.md`, aur [Agent.md rule set](https://github.com/ahmadghouri/Agent.md) — sab mila kar, Jobblo ke stack ke mutabiq.

## 0. Sab se pehle: Ponytail — lazy senior dev

Lazy ka matlab efficient, laparwah nahi. Sab se acha code wo hai jo likhna hi na pade.

Code likhne se pehle pehli seedhi par ruk jayein jo kaam kare:

1. Kya yeh banana zaroori hai? (YAGNI)
2. Kya codebase me pehle se hai? Wahi helper/pattern reuse karein.
3. Kya standard library karti hai?
4. Kya platform (browser/Node/Expo) ka feature karta hai?
5. Kya pehle se install dependency karti hai?
6. Kya ek line me ho sakta hai?
7. Tab jaa kar: minimum code jo kaam kare.

Seedhi tab chadhein jab masla samajh aa jaye: task padhein, jo code chhuta hai padhein, asal flow shuru se aakhir tak trace karein.

- **Bug fix = root cause.** Report symptom batati hai. Jis function ko chhu rahe hain uske saare callers grep karein aur shared function ek dafa theek karein.
- Bina maange abstraction nahi. Bachne wali dependency nahi. Boilerplate nahi.
- Deletion > addition. Boring > clever. Kam se kam files.
- Sab se chhota chalta hua diff jeetta hai — magar masla samajhne ke baad. Ghalat jagah chhota diff doosra bug hai.
- Complex request par sawal: "X sach me chahiye, ya Y kaafi hai?"
- Do stdlib tareeqe barabar size ke hon to edge-case-sahi wala.
- Jaan boojh kar shortcut (global lock, O(n²), naive heuristic) par `ponytail:` comment: had kya hai aur upgrade path.

**In me lazy NAHI:** masla samajhna, trust boundary par input validation, data loss rokne wali error handling, security, accessibility, real hardware calibration, jo bhi saaf maanga gaya ho.

**Har non-trivial logic ek runnable check chhode:** sab se chhoti cheez jo logic tootne par fail ho (assert self-check ya ek chhoti test file; koi framework/fixture nahi). Trivial one-liner ko test nahi chahiye.

## 1. Kaam ka tareeqa (har task)

1. Code end to end padhein. Baseline green: backend `npm test`; frontend `npm run typecheck`, `npm run lint`, `npx vite build`; app `npx tsc --noEmit` + `node src/**/*.check.mjs`.
2. Chhota diff likhein, reuse pehle.
3. Tests: unit, integration (supertest), e2e (Playwright `frontend/e2e`, `npm run test:e2e`; screenshots `E2E_SHOTS=<dir>`).
4. Todne ki koshish: ghalat input, auth nahi, ghalat role, bade payloads, Redis band, Mongo slow, duplicate/concurrent requests, beech me restart.
5. Load: `backend/scripts/load-test.js`. Budget (50 users, p95): public reads <300ms, auth reads <400ms, writes <800ms, 0% errors (429 theek).
6. Green after; test data saaf; [MEMORY.md](MEMORY.md) me tareekh ke saath entry.

## 2. Git, safety, secrets

- **Commit ya push sirf jab owner kahe.** Owner ka apna work-in-progress mat chhuein.
- Branch banayein to `--no-track`. `--no-verify` kabhi nahi. Force push / history rewrite / `git stash pop` jaise kaam bina poochhe nahi.
- Pooch kar karein: DB data delete, collection drop/reset, files delete, processes kill, important services restart, deploy.
- **Production DB aur LIVE Stripe kabhi nahi** jab tak saaf ijazat na ho. Seeds production me chalte hi nahi.
- `.env*`, `.git/`, private keys, deploy credentials, `*firebase-adminsdk*.json` — bina kahe na kholein, na edit karein, na print karein.
- Secrets kabhi code, logs, job payloads, fixtures, query keys, URLs ya docs me nahi. Env vars `.env.example` me bina value ke.
- `npm audit fix --force` nahi.

## 3. Project aur dependencies

- Stack: backend Express + Mongoose + socket.io + BullMQ/ioredis (Redis optional) + Stripe; web React + Vite + TS + TanStack Query + Tailwind v4 + shadcn; app Expo + expo-router + NativeWind + TanStack Query.
- **Sirf npm** (pnpm/yarn/bun nahi). `package-lock.json` haath se nahi. npm us package ke folder me chalayein jo dependency use karta hai (`backend/`, `frontend/`, `jobblo-app/`), root me nahi.
- Nayi dependency se pehle: kya installed hai? kya codebase/stdlib me hal hai? security, maintenance, bundle size? Likha hua reason. Pasand ki wajah se library nahi; chalti library badalni nahi.
- Duplicate infrastructure nahi: doosra axios instance, doosra API pattern, doosra query-key system, doosra error handler — kuch nahi.
- Docker production me nahi; sab plain node par Windows aur VPS par chalna chahiye. `docker-compose.yml` sirf local suvidha.
- Bina wajah unrelated files nahi chhuni, opportunistic refactor nahi. Public file/export/route/API field rename ya move se pehle consumers grep.

## 4. Engineering

- Simple control flow, saaf naam, chhote ek-kaam wale functions, early returns. Chhupe side effects, magic values, duplicate business logic, gehri nesting nahi.
- Service/repository layer, event bus, DI, cache, queue ya microservice tab tak nahi jab tak requirement na maange. Chhote task me redesign nahi.
- UI me business logic nahi; routes me bade workflows nahi; DB details layers me leak nahi.
- **Paise ke raaste** (webhooks, payouts, refunds, escrow) synchronous aur idempotent. Sirf side effects (email, push, notification) queue me.
- Har job idempotent, backoff ke saath retry, aur dikhne wali failed state me khatam.
- Redis optional: band ho to degrade, crash nahi. `REDIS_URL` na hona valid hai.
- Refactor behaviour nahi badalta: pehle aur baad tests green; pehle code jaise ka taisa move, phir behtar. Money files (`SafePayCheckoutController`, `v2WebhookProcessor`, `v2Management`, `v2RecoveryPolicy`, `safepay*`, `releasePayoutToProvider`) bulk split nahi — ek pure helper ek dafa.
- Financial history wale users hard-delete nahi (anonymise; bokføringsloven 5 saal).
- `revieweeRole` jaan boojh kar ulta hai — aadha fix na karein.

## 5. Quality (compile ho jana "done" nahi)

Khatam karne se pehle: sahi behaviour aur error paths, edge cases, imports/exports aur callers, tests, config asar, API compatibility, security asar.

- Har bahar ka input validate: body, query, params, headers, env, uploads, third-party responses — maujooda validators ke saath (backend me koi Joi/Zod nahi; bina reason add nahi).
- Sirf task se mutalliq edge cases: empty/null, ghalat id, missing/duplicate record, unauth/forbidden, concurrency, network/DB/external failure.
- Response field, route, signature, export, DB field, prop, shared type badalne se pehle consumers grep (web **aur** app dono). Breaking change sirf zaroorat par.
- Prettier sirf chhui files par (frontend `prettier@3.9.4`). ESLint ratchet sirf neeche jaye. Typecheck baseline se bura nahi.

## 6. Security

- Passwords, tokens, API keys, DB credentials, session secrets, auth headers, sensitive cookies kabhi log/expose nahi.
- Hashing, token verification, auth middleware, authorization, cookie flags, rate limiting, CSRF ko "chalane ke liye" kamzor nahi.
- Authenticated ≠ authorized: ownership, role, permission backend par check. Frontend guard security nahi.
- Sensitive DB fields response me nahi (`select: false` contact fields, password hashes).
- Production me CORS sab origins ke liye kabhi nahi.

## 7. API (`backend/routes`, `backend/controllers`)

- Contract stable: badalne se pehle route, controller, service, validation, web + app consumers, tests, `backend/swagger.js` padhein. Additive change (naya optional field) rename/remove se behtar.
- Verbs: GET read, POST create/action, PATCH partial, PUT full replace, DELETE delete. Duplicate routes nahi.
- Status codes ka matlab ho: 200, 201, 204, 400, 401, 403, 404, 409, 429, 500, 503 — sab ke liye 200 nahi.
- **Error shape:** abhi `{ error }` aur `{ message }` dono milte hain (admin `sendError` → `{ success:false, message }`). Naye code me us area ka rivaj; purane endpoints bina web+app check kiye "fix" nahi. Stack trace, raw DB/provider error, internal paths production me kabhi nahi. Clients `error || message` dono padhein.
- **Mass assignment:** `req.body` seedha `findByIdAndUpdate` me nahi; fields allowlist. role, permissions, ownership, status, billing protected.
- ObjectId pehle validate (`parseObjectId`). Query strings jaan boojh kar coerce. Filter/sort allowlist. Client ka object kabhi Mongo filter me nahi (`includes(value)` se check). Search: trim, min length, limit, regex escape.
- Pagination: maujooda style (`page/limit` + total) — ek feature me do style nahi; hamesha max limit; unbounded collection kabhi nahi.
- Auth maujooda middleware se; controller me token dobara verify nahi; client ka userId/role kabhi trust nahi.
- Orders, payments, emails, notifications, webhooks me idempotency + duplicate protection (button disable kaafi nahi). Rate limit maujooda `makeLimiter` se.
- Mutation authoritative updated resource lautaye. Private responses public cache nahi. External calls me timeout, normalized error, retry sirf safe ho to.

## 8. Backend

- Flow: middleware → route → controller (patla) → service (explicit inputs, `req/res` nahi) → Mongoose model. Repository layer nahi. Stripe/email/push/storage calls services me.
- Errors: central handler / `asyncHandler`; khaali `catch {}` nahi; `return res.status(..).json(..)`; har raasta respond kare, `next()` kare ya throw kare.
- Logging: project logger/`console.error` ka maujooda pattern; operation + request id + safe ids; secrets kabhi nahi.
- Counters, quotas, bookings par atomic ops (`$inc` conditional filter) — read-modify-save nahi. Transactions sirf dependent multi-writes ke liye. `Promise.all` sirf independent kaam ke liye.
- Request path par CPU-heavy/sync fs nahi; bada data paginate/batch/stream.
- Helmet/CORS/rate-limit/cookie settings rakhein.

## 9. Database

- Maujooda naming, timestamps, indexes, refs, validators, `toJSON` rakhein. Read-only queries par `.lean()` aur projection; N+1, faltu `populate`, poori collection load nahi.
- Index tab jab filter/sort shape, cardinality, traffic aur write cost soch liya ho.
- Migrations = `backend/scripts/` me one-off scripts (`migrate-*.js`): idempotent, pehle dry-run, production par sirf ijazat se. `deleteMany({})`, drop, reset — saaf ijazat.

## 10. Frontend (web)

- Pehle maujooda components dhoondein (`components/Ui` public, `components/developer/ui` + `kit.tsx` admin/developer, `components/admin`). Near-duplicate nahi.
- State: local UI `useState`; server state TanStack Query; values derive karein, store nahi; effect sirf external sync ke liye (timers/listeners clean). Memo sirf saboot par. Re-orderable lists me stable keys.
- Accessibility: asli `<button>`, `<a>`/`Link` (clickable div nahi), label + `id`, keyboard, alt text, focus ring kabhi remove nahi.
- Styling: Tailwind + maujooda tokens/variants ([DESIGN.md](DESIGN.md)); naya CSS/UI framework nahi; overflow aur fixed widths se bachein; 360px tak.
- Router `routing/Routes.tsx`; route move se pehle links, guards, deep links check.
- Forms: maujooda tareeqa; double submit rokein, pending state, error par input na khoye. Frontend validation sirf UX.
- TypeScript: props, payloads, responses typed; naya `any` nahi; `types/` reuse.
- Copy Norwegian (bokmål); developer console English; admin i18n.

## 11. TanStack Query (web + app)

- Flow: component → query/mutation hook → API service (`api/*`, `services/*`) → shared axios client. Components me axios/fetch, URLs, headers ya invalidation nahi. API files me hooks nahi; `response.data` lautayein.
- Read `useQuery`, write `useMutation` (login/logout bhi). `useQuery` se kabhi write nahi.
- Query keys: hierarchical; `queryFn` ka har input key me (page, limit, search, filters); ek cheez ke do naam nahi; secrets kabhi key me nahi. App me `src/queryKeys.ts`; web me area ka rivaj (`hooks/admin`, `features/*/hooks.ts`) — mass migration nahi.
- Mutation ke baad sirf mutalliq keys invalidate (poora cache nahi). `setQueryData` sirf authoritative response par. Optimistic update sirf asal faide par, cancel/snapshot/rollback ke saath.
- `enabled: Boolean(id)`, search debounce, infinite query sirf feed ke liye. `data` ko effect se `useState` me copy nahi.
- Ek `QueryClient` (providers me). 400/401/403/404 retry nahi. `queryFn` me navigation/toast nahi. Logout private cache saaf kare.

## 12. Mobile app

- Har nayi interaction me pressed feedback; tap target ≥44×44; text ≥13pt (`src/theme/textSize.check.mjs`); SafeArea; 360px.
- Hrefs object form me (template string / `as Href` nahi). Order ke liye sirf `src/utils/orderRoute.ts`.
- Raw snake_case status kabhi screen par nahi — labels se.
- iOS par membership kabhi nahi; Apple sign-in wahan jahan Google ho (4.8); AI se pehle consent (5.1.2).
- Design tokens generate hote hain (`design-tokens/build.mjs`) — generated files haath se edit nahi.

## 13. Testing

- Observable behaviour test karein, implementation nahi. Unit-under-test mock nahi; sirf bahar ki hadein (Stripe, email, push, fs).
- Bug fix ke saath regression test jo fix se pehle fail ho.
- Pure logic = unit; route/middleware/DB flow = integration (supertest). Deterministic, order-independent.
- Arbitrary sleep nahi — Playwright auto-wait / `expect.poll`, Jest fake timers.
- Success, ghalat input, 401, 403, 404, conflict, dependency failure cover.
- Code pass karane ke liye test kamzor kabhi nahi. Isolated e2e: alag backend (`ENABLE_SCHEDULER=false`), PID/DB/Stripe mode/flags pehle verify.

## 14. Infrastructure (`deploy/`, `.github/workflows`, nginx)

- High impact: hardcoded URLs/secrets nahi; image layers/build args me secrets nahi.
- CI gates (lint, typecheck, test, build, audit, gitleaks) green karne ke liye band nahi — pehle failure samjhein.
- Health checks rakhein; rolling deploy ke saath API/DB/env compatible.
- Proxy: forwarded headers, timeouts, body size, websocket upgrade, TLS, private responses cache nahi.
- Production values aur destructive deploy kaam bina ijazat nahi.

## 15. Jawab ka andaaz

- Simple alfaaz, chhote paragraph, theek risks bata dein.
- Jo verify nahi kiya uske baare me "test ho gaya / chalta hai" kabhi nahi.
- Bug: wajah → asar → fix. Change: kya → kyun → kaise verify.
- Code, comments, commits, identifiers English me. Owner ke saath chat aur docs: Roman Urdu, chhota.
