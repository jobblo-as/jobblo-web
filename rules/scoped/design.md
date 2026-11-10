---
description: Jobblo visual system for the public web, the app, and the admin and developer dashboards.
alwaysApply: false
trigger: glob
globs:
  - 'frontend/src/**/*.tsx'
  - 'frontend/src/**/*.css'
  - 'jobblo-app/app/**'
  - 'jobblo-app/src/**/*.tsx'
---

# Design

Full system: `docs/DESIGN.md`.

## Hard rules

1. Never invent trust signals (ratings, counts, logos, testimonials, response times).
2. No control that does nothing.
3. Customer-facing copy is Norwegian only, including errors and empty states.
4. Vipps comes first, in its own orange `#FF5B24` (only on the Vipps button), then Google, then email.
5. Mobile down to 360px. Use `dvh`, never `vh`.
6. No new dependency: lucide icons, CSS or inline SVG illustrations, no large PNGs.
7. Accessibility: label `id`s, `aria-describedby`, `autoComplete`, real `button` and `form` elements, visible focus rings.

## Public site and app

- Colours come only from the logo palette: ink `#0B0B0B`, muted text `#63665F`, brand green `#2E6641` (hover `#255335`), line `#E6E7E1`, page `#EFF0EA`. Green is for actions plus at most one highlight per section. The legacy orange `#E08835` is never used.
- Use the tokens in `frontend/src/theme/brand.ts` (web) and the semantic NativeWind classes or `TC` helpers (app). No raw hex when a token exists.
- Inter Display on the web. Controls are 46px (`h-11.5`). Cards are white with a `#E6E7E1` border. Focus is `focus-visible:ring-4 ring-[#2E6641]/20`.

## Admin and developer dashboards

- Use the shadcn kit in `frontend/src/components/developer/ui/*` and the blocks in `components/developer/kit.tsx` (`StatCard`, `Section`, `StatusBadge`, `KeyValue`, `Timeline`, `EmptyState`, `ErrorState`). Do not use the public `components/Ui` kit there.
- Detail pages follow one pattern: actions row, hero card, progress stepper with dates, then a 2/3 + 1/3 grid. Statuses show Norwegian labels, never raw enum values.
- Format with `lib/devFormat.ts` (`money`, `dateTime`, `ago`).
