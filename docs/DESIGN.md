# DESIGN — visual system

> Do visual languages hain: **A** public site + app (Jobblo brand), **B** admin + developer console (shadcn). Tokens ka source `design-tokens/tokens.json` hai → `node design-tokens/build.mjs` se web (`frontend/src/styles/tokens.css`, `src/theme/tokens.ts`) aur app (`jobblo-app/app/global.css`, `src/theme/tailwindColors.js`, `src/theme/tokens.ts`) generate. Generated files haath se edit nahi.

## 1. Hard rules (sab jagah)

1. **Nakli trust signal kabhi nahi** — ratings, counts, logos, testimonials, response times sirf asli data se.
2. **Koi control jo kuch na kare, nahi.**
3. **Sirf Norwegian** (bokmål) customer ke liye — errors aur empty states bhi.
4. **Vipps pehle**, apne orange `#FF5B24` me (sirf Vipps button par); phir Google, phir email. iOS par Apple bhi.
5. Mobile 360px tak; web par `dvh`, `vh` nahi.
6. Nayi dependency nahi: icons sirf **lucide**; illustration CSS/inline SVG; bade PNG nahi.
7. Accessibility: label `id`, `aria-describedby`, `autoComplete`, asli `button`/`form`, focus hamesha dikhe.
8. Data display design karne se pehle poochhein ke asli data kya hai; assumptions flag karein.

## 2. Language A — brand (public web + app)

### Colours (light)

| Role                                     | Value                                        |
| ---------------------------------------- | -------------------------------------------- |
| ink                                      | `#0B0B0B` (ink-2 `#3C3F38`)                  |
| ink-muted (body text)                    | `#63665F`                                    |
| ink-faint (sirf bada/ghair-zaroori text) | `#9B9E96`                                    |
| **brand green** (actions, links, focus)  | `#2E6641` · hover `#255335`                  |
| brand-deep (dark sections, toasts)       | `#122A1C` · on-deep `#8FBF9A`                |
| leaf (sirf link hover)                   | `#347028`                                    |
| tint                                     | `#EAF1E9`                                    |
| line (wahid border)                      | `#E6E7E1` (soft `#EFF0EA`, strong `#CFD2C8`) |
| field                                    | `#F5F6F1` · panel `#F4F6F0` · page `#EFF0EA` |
| danger                                   | `#B4453A`, tint `#FBF4F2`                    |
| warn                                     | `#614109`, tint `#FBF5E9`                    |
| Vipps (sirf us button par)               | `#FF5B24`                                    |
| legacy orange `#E08835` / antd `#ea7e15` | **naye kaam me nahi**                        |

Dark (app me chalu, web me tokens hain par toggle nahi): page `#121411`, surface `#1C1F1B`, brand-text `#7DBE92`.

Rang ka discipline: green sirf actions + har section me zyada se zyada ek highlight. Decorative gradients nahi (bade surface par ek halka radial tint chalega). Alpha borders nahi.

Tailwind (web): `bg-jb-brand`, `text-jb-ink-muted` waghera. App: semantic classes (`bg-page`, `text-ink-muted`, `bg-brand`) + inline ke liye `TC`/`tc()` (`src/theme/colors.ts`).

### Typography

- Web: **Inter Display** hi (index.css me forced). App: system font, min 13pt.

| Cheez           | Size           | Weight / extra                             |
| --------------- | -------------- | ------------------------------------------ |
| Hero            | clamp 2–3.5rem | 700, tracking -0.035em, leading 1.15       |
| Section heading | 1.875–2.375rem | 700                                        |
| Card title      | 15–17px        | 600                                        |
| Body            | 14–15px        | relaxed, `#63665F`                         |
| Micro-label     | 11px           | 600, UPPERCASE, tracking 0.16em, `#9B9E96` |

### Shape, size, spacing (`frontend/src/theme/brand.ts`)

- Radius: `rounded-xl` cards/inputs/buttons; `rounded-2xl` feature panels; `rounded-[24px]` bade containers + CTA band; pills sirf chips/status (landing ke pill buttons exception).
- Controls 46px (`h-11.5`); hero search 52px (`h-13`); app tap target ≥44×44.
- Container `mx-auto w-full max-w-300 px-5 sm:px-8 lg:px-12`; sections `py-16 sm:py-20` (brand.ts me `SECTION` thoda bada hai — naye kaam me brief follow karein).
- Cards: white, 1px `#E6E7E1`, hover border `#2E6641/45`; shadow sirf screen ke ek elevated element par.
- Focus: `focus-visible:ring-4 ring-[#2E6641]/20` — kabhi remove nahi.
- brand.ts tokens: `CONTAINER`, `SECTION`, `DISPLAY`, `HEADING`, `SUBHEADING`, `MICRO_LABEL`, `CARD`, `CARD_INTERACTIVE`, `PRIMARY_BUTTON`, `SECONDARY_BUTTON`, `PILL_*`, `CHIP`, `TEXT_LINK`, `FIELD_ICON_BUTTON`, `ICON_PLATE`.

### Screens jinse match karna hai

- Auth: asymmetric split, `dvh`, scroll nahi; register 2 steps.
- Landing (sawal se shuru sections, isi order me): hero ("Jeg trenger hjelp til [kategori]" = search) → Hva trenger du hjelp til? → Er pengene mine trygge? → Hvordan fungerer det? → Hva koster det? → Hvem trenger hjelp nå? → CTA.
- Header: sticky, translucent, hairline border; "Logg inn" + green "Legg ut oppdrag".
- App: GlassTabBar (iOS 26+ Liquid Glass, purane iOS blur, Android opaque); har tappable cheez par pressed feedback.
- Tone: Scandinavian, khamosh.

### Motion, toasts, formatting

- Keyframes `jb-marquee`, `jb-progress`, `jb-shimmer` (`.jb-skeleton`), `jb-draw`, `jb-word-in`; `prefers-reduced-motion` ka khayal.
- Toast (web public): react-hot-toast, bottom-center, pill, `#122A1C` + white, 4s (error 5s). App: react-native-toast-message / Alert.
- Dates `utils/dateFormatter.ts` (`dd.MM.yyyy`, "I dag", "I går", locale `nb`). Paisa `nb-NO` NOK ("2 400 kr").

## 3. Language B — admin `/dashboard` + developer `/developer`

- shadcn (`components.json`, style radix-nova) → `components/developer/ui/*` (button, badge, card, table, select, dialog, sheet, tabs, input, textarea, popover, calendar, avatar, skeleton …).
- `.dev-theme` body par (popovers bhi): thanda blue-grey; primary `oklch(0.55 0.17 262)` (blue); radius `0.375rem`; charts blue/teal/purple/amber/red; font Geist Variable. Dark tokens maujood.
- Building blocks `components/developer/kit.tsx`: `PageHeader`, `RangeSelect`, `RefreshButton`, `StatCard` (tones neutral/success/warning/danger/info), `Section`, `StatusBadge` (status→tone, ya `label` + `tone`), `MethodBadge`, `Meter`, `KeyValue`, `Mono`, `JsonView`, `EmptyState`, `NotConfigured`, `ErrorState`, `LiveDot`, `IssueList`, `Timeline`, `CountBars`.
- Admin pages ka pattern (Jobbrapporter / Chatrapporter / Tjenester detail / Ordre detail): upar actions row → hero card (icon, badges, title, meta) → progress stepper (har step ki date) → 2/3 + 1/3 grid (content left, log/sidebar right) → Norwegian labels (raw snake_case nahi). Shared badges: `pages/SuperAdminDashboard/reportBadges.tsx`.
- Formatting `lib/devFormat.ts`: `money` (nb-NO, `minor` flag), `dateTime`, `ago`, `num`, `pct`, `ms`, `bytes`, `duration`, `downloadCsv`.
- Toasts: admin react-hot-toast, developer sonner (bottom-right).
- Copy: admin Norwegian (i18n no/en), developer console English.
- Charts: recharts (`TimeSeriesChart`).

## 4. Pata hai, theek karna baqi

- `components/Ui/button` vs `Ui/Button` filename casing clash.
- `index.css` me unlayered `body{background:#f6f1e8}` jo `bg-background` se takrata hai.
- antd theme ka orange `#ea7e15` palette me nahi.
- brand.ts `CARD` `rounded-3xl` aur `SECTION` spacing brief se alag.
- Web par dark mode tokens hain lekin toggle nahi.
- Teen toast libraries installed (react-hot-toast, sonner, react-toastify).
