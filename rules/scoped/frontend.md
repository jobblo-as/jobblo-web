---
description: React frontend engineering, state management, data fetching, UI, accessibility, and performance rules.
alwaysApply: false
trigger: glob
globs:
  - "frontend/**"
  - "client/**"
  - "src/components/**"
  - "src/pages/**"
  - "src/hooks/**"
paths:
  - "frontend/**"
  - "client/**"
---

# Frontend

Follow the project's existing React architecture and conventions.

The existing frontend structure is the source of truth.

Before creating or changing frontend code:

1. Inspect nearby files.
2. Inspect the frontend `package.json`.
3. Check existing components.
4. Check existing hooks.
5. Check existing API services.
6. Check existing state-management patterns.
7. Check existing styling conventions.
8. Reuse existing infrastructure whenever practical.

Do not introduce a new frontend architecture for a small task.

# Components

Prefer functional components when consistent with the project.

Keep components focused on one primary responsibility.

Separate a component when:

- it has a distinct responsibility
- it is reused
- separation improves readability
- separation improves testing
- separation reduces meaningful complexity

Do not split components only to reduce line count.

Do not create unnecessary wrapper components.

# Existing components first

Before creating a new component, search for existing:

- buttons
- inputs
- modals
- dialogs
- cards
- layouts
- tables
- loaders
- skeletons
- error states
- empty states
- form controls
- navigation components
- design-system components

Reuse or extend existing components when appropriate.

Avoid creating slightly different versions of existing UI components without a real requirement.

# Props

Keep component props clear and intentional.

Avoid passing large objects when a component only requires a few values.

Do not introduce unnecessary prop drilling if the project already has an appropriate state or context solution.

Do not move state globally only to avoid passing one or two props.

# State

Use the project's existing state-management approach.

Prefer local React state for local UI concerns.

Examples:

- modal open or closed
- active tab
- dropdown state
- temporary form state
- selected row
- sidebar state

Do not move state into global storage without a real cross-feature or application-level requirement.

Avoid storing values that can be derived from existing state or props.

Prefer:

```js
const fullName = `${firstName} ${lastName}`;

instead of creating another state value for fullName.

Server state vs local state

Keep server state and local UI state separate.

Server state includes data coming from or synchronized with an API.

Examples:

products

users

orders

profile

notifications

dashboard data

search results

paginated data

When TanStack Query is available and used by the project, server state should normally be managed by TanStack Query.

Local UI state should normally remain in React state or the project's existing local/global state solution.

Do not copy server state into local state without a real requirement.

Effects

Use effects primarily for synchronization with external systems.

Examples:

event listeners

timers

subscriptions

browser APIs

external libraries

Avoid using effects for values that can be calculated during render.

Avoid using effects only to copy one state value into another.

Clean up when relevant:

timers

event listeners

subscriptions

observers

abortable requests

Do not create effect loops through unstable dependencies.

Follow existing hook conventions.

Data fetching

Before implementing frontend API fetching:

Inspect the frontend package.json.

Check whether @tanstack/react-query is installed.

Check whether axios is installed.

Search for an existing API client.

Search for API service files.

Search for query hooks or custom request hooks.

Follow the existing architecture first.

Do not introduce another HTTP client if one already exists.

Do not create a second competing API-fetching pattern without a clear reason.

TanStack Query available

If @tanstack/react-query is installed and already used by the project:

Prefer TanStack Query for server state.

Use useQuery for read operations.

Use useMutation for operations that change server state.

Keep HTTP communication inside API service functions.

Reuse the existing Axios or fetch client underneath TanStack Query.

Follow the detailed rules in rules/scoped/tanstack-query.md.

Preferred flow:

Component
→ TanStack Query Hook
→ API Service
→ Shared Axios/fetch Client
→ Backend API

Example:

ProductsPage
→ useProducts()
→ getProducts()
→ apiClient.get("/products")
→ Backend API

Do not call raw Axios or fetch directly inside components when the project already uses TanStack Query and an API service layer.

TanStack Query not available

If @tanstack/react-query is not installed:

Do not install it automatically.

Follow the project's existing request architecture.

Prefer the existing Axios client if Axios is already installed.

Otherwise use the project's existing fetch-based approach.

Use custom hooks when they improve reuse or request lifecycle management.

Preferred fallback flow:

Component
→ Custom Hook when needed
→ API Service
→ Axios/fetch
→ Backend API

If the user explicitly requests TanStack Query, follow the dependency rules in rules/always/project.md.

Axios

If Axios is already installed:

reuse the existing Axios instance

reuse existing interceptors

reuse existing headers and credential configuration

reuse existing error normalization

do not create a new Axios instance for each feature

Do not place repeated Axios configuration inside React components.

Prefer:

Component
→ Hook
→ API Service
→ Shared Axios Client

Native fetch

If the project already uses native fetch:

follow the existing fetch wrapper or API service pattern

avoid duplicating base URLs and headers

handle non-2xx responses correctly

keep request logic outside presentation components where practical

Do not install Axios only because it is familiar.

API services

Keep HTTP communication inside API service modules when the project uses a service layer.

Example:

export async function getProducts(params) {
  const response = await apiClient.get("/products", {
    params,
  });

  return response.data;
}

API service files should not contain React-specific hooks such as:

useState

useEffect

useQuery

useMutation

Keep transport logic and React rendering concerns separate.

Loading states

Handle meaningful loading states.

Prefer existing project components such as:

spinner

skeleton

loading screen

button loading state

When TanStack Query manages a request, use its loading states instead of creating duplicate manual loading state.

Error states

Do not silently ignore API errors.

Follow the existing frontend error strategy.

Examples:

inline validation error

toast

error page

error boundary

shared API error handler

Do not expose sensitive backend details or stack traces to users.

Empty states

Distinguish between:

loading

error

successful empty result

Do not show an error when the request succeeded but returned no data.

Use the project's existing empty-state components where available.

Request duplication

Do not call the same endpoint independently from multiple components if the project already provides a shared query, hook, context, or service solution.

Avoid unnecessary duplicate network requests.

Do not manually create caching logic when TanStack Query already manages that responsibility.

Forms

Use the project's existing form-handling and validation approach.

Before introducing a form library, inspect the existing project.

Do not introduce:

React Hook Form

Formik

another validation library

unless already used, explicitly requested, or clearly required.

Prevent duplicate submissions when relevant.

Display meaningful validation errors.

Frontend validation improves UX but is not a security boundary.

Backend validation is still required.

Form submission

For server submissions:

use the existing mutation/request pattern

prevent accidental duplicate submissions when necessary

show appropriate pending state

surface meaningful failures

preserve form data when a recoverable error occurs

Do not clear form state before confirming successful submission unless the UX explicitly requires it.

Performance

Do not add:

useMemo

useCallback

React.memo

automatically.

Use memoization only when:

expensive work is repeated

stable identity is required

profiling indicates a performance issue

library behavior requires stable references

existing architecture expects it

Avoid premature optimization.

Prefer fixing unnecessary renders at their actual cause before adding memoization everywhere.

Lists

Use stable keys when rendering lists.

Prefer unique persistent identifiers.

Avoid array indexes as keys when:

items can reorder

items can be inserted

items can be removed

component state depends on item identity

Accessibility

Prefer semantic HTML.

Buttons should use:

<button>

Links should use:

<a>

or the project's routing link component.

Inputs should have accessible labels where appropriate.

Interactive controls should support keyboard interaction.

Images should have meaningful alt text when appropriate.

Decorative images should follow the project's accessibility convention.

Do not use clickable div or span elements when semantic controls are suitable.

Styling

Follow the existing styling system.

Examples may include:

CSS

CSS Modules

Tailwind CSS

styled-components

component-library styling

design tokens

Do not introduce a new:

CSS framework

UI framework

component library

styling methodology

without explicit need.

Reuse existing:

spacing

typography

colors

breakpoints

design tokens

component variants

when available.

Responsive behavior

Preserve existing responsive conventions.

When building new UI:

consider mobile layouts

avoid unnecessary fixed widths

avoid horizontal overflow

follow existing breakpoints

preserve usable touch targets

Do not redesign unrelated responsive behavior.

Routing

Follow the existing routing library and route structure.

Do not introduce another routing solution.

Before renaming or moving routes, check:

navigation links

redirects

route guards

deep links

frontend consumers

tests

Preserve existing route behavior unless requirements explicitly change it.

Authentication UI

Follow the project's existing authentication architecture.

Do not implement security only in frontend route guards.

Frontend guards improve UX but backend authorization remains authoritative.

Do not expose:

access tokens

refresh tokens

passwords

sensitive authentication data

in logs, URLs, or rendered UI.

Custom hooks

Use custom hooks for reusable React behavior.

Good candidates include:

reusable UI behavior

reusable browser integrations

shared API behavior when TanStack Query is not used

feature-specific stateful logic

Do not create custom hooks only to move arbitrary code out of a component.

Hooks should follow React's Rules of Hooks.

Context

Use React Context for appropriately scoped shared state.

Do not put all application state into Context automatically.

Avoid large contexts that cause unrelated components to rerender when smaller scoped contexts would fit the existing architecture better.

Do not introduce Context when simple props or local state are sufficient.

Type safety

If the frontend uses TypeScript:

type component props

type API responses

type request payloads

type reusable hooks

avoid unnecessary any

reuse existing domain types where practical

Do not duplicate types when a shared type already exists.

File creation

Before creating a new frontend file, search for the appropriate existing location and naming pattern.

Do not invent folders such as:

services

queries

hooks

utils

lib

providers

if the project already organizes those responsibilities differently.

The existing project structure takes priority over generic recommendations.

Final frontend decision flow

For frontend work, prefer:

Inspect existing code
        ↓
Inspect frontend package.json
        ↓
Reuse existing components and hooks
        ↓
Need server data?
        ↓
Is TanStack Query already installed?
        │
        ├── Yes
        │    ↓
        │  TanStack Query Hook
        │    ↓
        │  API Service
        │    ↓
        │  Existing Axios/fetch Client
        │
        └── No
             ↓
        Follow existing Axios/fetch pattern
             ↓
        Custom hook when useful
             ↓
        API Service

Always prefer the existing frontend architecture over introducing a new one without a clear requirement.