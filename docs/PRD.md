# PRD — Jobblo kya hai aur kyun

> Product ka "kya aur kyun". Kaise bana hai → [ARCHITECTURE.md](ARCHITECTURE.md). Rules → [RULES.md](RULES.md). Design → [DESIGN.md](DESIGN.md). Kaam → [TASKS.md](TASKS.md). Abhi ki halat → [MEMORY.md](MEMORY.md).

## 1. Ek line me

Jobblo Norway ka do-tarfa marketplace hai chhote kaamon ("oppdrag") ke liye — flytting, maling, hagearbeid, montering, rengjøring, håndverker. Customer kaam post karta hai, local log apply karte hain, customer ek ko chunta hai aur paisa **SafePay** (escrow) me jama hota hai. Paisa provider ko tab milta hai jab customer kaam approve kare.

Platforms: web (`frontend/`, jobblo.no), mobile app (`jobblo-app/`, iOS + Android), API (`backend/`).

## 2. Masla jo hal ho raha hai

- Chhote kaam ke liye bharosemand banda dhoondhna mushkil hai, aur paisa pehle dena risky hai.
- Provider ko yaqeen nahi hota ke kaam ke baad paisa milega.
- **Hal:** escrow (SafePay) — customer pehle pay karta hai, paisa Jobblo ke paas rukta hai, kaam approve hone par provider ke Stripe Connect account me jata hai. Jhagra ho to dispute.

## 3. Users aur roles

| Role             | Kaun                            | Kya karta hai                                                             |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------- |
| `user` (private) | Aam log                         | Kaam post karna, kaam par apply karna — ek hi account dono kaam karta hai |
| `company`        | Business (companyName ke saath) | Wahi, business plans ke saath                                             |
| `provider`       | Purana role                     | Abhi bhi assign ho sakta hai (legacy)                                     |
| `superAdmin`     | Jobblo team                     | Poora admin dashboard `/dashboard`, developer console bhi; MFA zaroori    |
| `developer`      | Tech team                       | Sirf developer console `/developer` (readonly / operations); MFA zaroori  |

Ahem: role **har order par** tay hota hai (kaun customer, kaun provider) — user ka global role nahi.

## 4. Core flow (happy path)

1. **Post:** customer oppdrag banata hai (title, description, category, photos, price type, jagah). AI title/text suggest kar sakta hai.
2. **Apply:** provider apply karta hai (`JobRequest`). Is ke liye provider ka **Stripe Connect** tayyar hona zaroori hai, aur ek **contact** kharch hota hai.
3. **Chat:** dono chat karte hain, price par baat.
4. **Award:** customer ek provider chunta hai → `Order` banta hai (`awaiting_payment`).
5. **Pay:** customer Stripe Checkout se pay karta hai (card) → order `paid`, paisa escrow me.
6. **Kaam:** provider "start" karta hai → before/after photos, checklist → "Meld jobb som ferdig" → `ready_for_review`.
7. **Approve:** customer approve + rating → payout provider ke Connect account me (`completed`).
8. Approve na kare to **14 din** baad auto-release (3 din pehle warning). Provider deadline tak start na kare to refund + cancel.
9. Kisi bhi paid state me **dispute** khul sakta hai; admin faisla karta hai (release, full/partial refund, split, cancel).

## 5. Business model

- Kaam post karna aur offers lena **free**.
- **SafePay fee 3%** agreed price par, sirf kaam complete hone par (`SAFEPAY_FEE_RATE`, provider ko `price − 3%`). Purane orders me `checkoutAmountMinor` snapshot me purani fee ho sakti hai.
- **Contact quota** (subscription plans, NOK/mahina, `seeds/plan.seed.js`):

| Plan             | Price | Contacts | Extra contact | Unlock delay | Extra                                             |
| ---------------- | ----- | -------- | ------------- | ------------ | ------------------------------------------------- |
| Private Standard | 0     | 5        | 49            | 2t           | 10 000 kr se kam ke private kaam par contact free |
| Private Plus     | 99    | 15       | 29            | 1t           |                                                   |
| Private Pro      | 149   | 35       | 19            | real-time    |                                                   |
| Business Start   | 199   | 8        | 49            | 2t           |                                                   |
| Business Pro     | 399   | 20       | 29            | 30 min       | badge                                             |
| Business Premium | 599   | 40       | 19            | real-time    | badge + analytics                                 |

- Har nayi application (`JobRequest`) par 1 contact. Chat par contact kharch nahi hota. Contacts agle mahine nahi jaate (no rollover).
- **Hast (urgent):** 39 kr, 3 din tak kaam upar dikhta hai; istemal na ho to refund.
- Subscription V2 abhi flags ke peeche hai (default OFF) — dekhein [TASKS.md](TASKS.md).

## 6. Sign-in

Order hamesha: **Vipps** (orange `#FF5B24`) → **Google** → email/password. iOS par Apple bhi (Google ke saath). BankID (Idura) identity verify karne ke liye ("Bekreftet med BankID").

## 7. Goals

- Bharosa: paisa safe (escrow), honest UI, koi nakli trust signal nahi.
- Paise ka har raasta sahi, idempotent aur reconcile ho sakne wala.
- Norwegian (bokmål) me saaf, simple product — web aur app dono.
- Admin aur developer ke paas poori visibility (dashboards, audit, monitoring).

## 8. Non-goals (abhi nahi)

- Customer app ka i18n (sirf Norwegian; admin dashboard me no/en hai).
- SafePay ke bahar hire karna ("Velg uten SafePay" hata diya gaya).
- Checkout par Vipps/Apple Pay — jab tak backend payment method Stripe ko forward na kare.
- Nakli ratings, counts, testimonials.
- App ka force-update endpoint, production me Docker, migration framework, dashboard se rollback.
- iOS par membership kharidna (App Store 3.1.1) — app me membership sirf flag ke saath, iOS par kabhi nahi.

## 9. AI

- Endpoints: `/api/ai/generate-title`, `/generate-job-info`, `/generate-full-listing`, smart-fill, category suggestions (20/ghanta/user). Model `gpt-4o-mini`, prompt v2 (`services/ai/jobListingPrompt.js`).
- `backend/evals/`: 28 synthetic cases + LLM judge. Score 3.514 → 4.232 (+20%), hard checks 21 → 27/28. CI me nahi chalta (paise lagte hain, ~$0.10 per run).
- App me pehli photo se pehle AI consent (App Store 5.1.2).

## 10. Kamyabi kaise naapein

- Kaam post → award → paid → completed ka conversion.
- Dispute rate, refund rate, auto-release rate.
- Payout failures 0, reconciliation clean.
- SLOs (developer console): API availability 99.5%, latency 99%, webhooks 99.9%, email 99%, push 98%, jobs 99%, mobile crash-free 99.5%.
