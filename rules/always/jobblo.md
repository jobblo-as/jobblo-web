---
description: Jobblo project rules. They extend the generic rules and win wherever the two disagree.
alwaysApply: true
trigger: always_on
---

# Jobblo

These rules are specific to this repository. Where a generic rule in `rules/` says something different, the rule here wins. The full project guide is in `docs/` (PRD, ARCHITECTURE, RULES, DESIGN, TASKS, MEMORY).

## Real stack and folders

- `backend/`: Node 22, Express, MongoDB with Mongoose, socket.io, Stripe and Stripe Connect, BullMQ and ioredis (Redis is optional), Jest tests in `backend/__tests__`.
- `frontend/`: React 19, Vite 7, TypeScript, React Router 7, TanStack Query 5, zustand, Tailwind v4, shadcn/radix, Playwright e2e in `frontend/e2e`.
- `jobblo-app/`: Expo SDK 58, expo-router, NativeWind, TanStack Query 5, zustand. Checks are `node <file>.check.mjs` plus `npx tsc --noEmit`. No Jest.
- There is no `server/` or `client/` folder. Read a scoped rule written for those paths as applying to `backend/` and `frontend/` (and `jobblo-app/` where it fits).
- TanStack Query and Axios are already installed in `frontend` and `jobblo-app`. Use them; never add a second client or data layer.

## Lazy senior dev (Ponytail)

Lazy means efficient, not careless. Before writing code, stop at the first rung that holds:

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse it.
3. Does the standard library do it?
4. Does a native platform feature cover it?
5. Does an installed dependency solve it?
6. Can it be one line?
7. Only then write the minimum code that works.

Climb the ladder only after reading the task and tracing the real flow end to end.

- A bug fix fixes the root cause: grep every caller of the function you touch and fix the shared function once.
- Deletion over addition. Boring over clever. Fewest files.
- Mark a deliberate shortcut (global lock, O(n²) scan, naive heuristic) with a `ponytail:` comment naming its ceiling and the upgrade path.
- Not lazy about: understanding the problem, validation at trust boundaries, error handling that prevents data loss, security, accessibility, anything explicitly requested.
- Every non-trivial change leaves ONE runnable check behind (an assert self-check or one small test file). Trivial one-liners need none.

## Git and safety

- Commit only when the owner asks. Never push. One commit per fix when commits are allowed.
- New branches use `git switch --no-track -c <name>`. Never `--no-verify`, never force-push, never `git stash pop` in background commands.
- Never use the production database or LIVE Stripe. Never run anything on the production server yourself. Seeds refuse production by design.
- Never open, edit or print `.env*`, private keys or `*firebase-adminsdk*.json`.
- Do not touch the owner's own processes or work in progress; kill only processes you started.

## Money and background work

- Money paths (webhooks, payouts, refunds, escrow) stay synchronous and idempotent. Only side effects (email, push, notifications) go to queues.
- The only payout path is `backend/services/payout/releasePayoutToProvider.js`. Order status transitions live only in `backend/services/order/orderState.js`.
- Money files (`SafePayCheckoutController`, `v2WebhookProcessor`, `v2Management`, `v2RecoveryPolicy`, `safepay*`, `releasePayoutToProvider`) are never bulk-split. Extract one pure helper at a time.
- Units: business fields are NOK kroner; every `*Minor` field is øre. Convert only at the Stripe boundary with `Math.round(kr * 100)`.
- Every job is idempotent, retried with backoff, and ends in a visible failed state.
- Redis is optional. A missing or slow Redis degrades, it never crashes. No Docker in production; everything runs with plain node.
- Never hard-delete a user with financial history. Anonymise instead.

## Conventions that differ from the generic rules

- Error shape: the code has `{ error }`, `{ message }` and admin `{ success: false, message }`. Follow the area you are in. Clients read `error || message`. Do not change old endpoints without checking web and app consumers.
- Validation: there is no Joi or Zod in the backend. Reuse the hand-written validators (`parseObjectId`, `utils/pagination`, `includes()` allowlists). Never pass a client object into a Mongo filter.
- Query keys: the app uses `jobblo-app/src/queryKeys.ts`; the web uses factories in a few places and inline arrays elsewhere. Follow the local feature; do not mass-migrate.
- Copy: customer-facing text is Norwegian (bokmål). The admin dashboard uses i18n (no/en). The developer console is English.
- Before changing any API field or route, check both `frontend/` and `jobblo-app/` consumers.

## Definition of done

1. Read the code end to end. Baseline green.
2. Tests: unit, integration (supertest), e2e (`npm run test:e2e`, screenshots via `E2E_SHOTS=<dir>`), plus the one runnable check.
3. Break it: invalid input, no auth, wrong role, huge payloads, Redis down, Mongo slow, duplicate or concurrent requests.
4. Green after: backend `npm test`; frontend `npm run typecheck`, `npm run lint`; app `npx tsc --noEmit` and the `*.check.mjs` files.
5. Prettier only on the files you touched (`prettier@3.9.4`). The ESLint error count may only go down.
6. Add a dated line to `docs/MEMORY.md`.

## Response style for this owner

- Chat replies and docs written for the owner: Roman Urdu, short, sized to the work. Code, identifiers, commits and comments stay in English.
- Never claim something is tested or working unless it was verified.
