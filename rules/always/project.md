```md
---
description: Core project context, boundaries, dependency decisions, and package management rules.
alwaysApply: true
trigger: always_on
---

# Project

This is a production-grade MERN application.

Primary stack:

- Frontend: React
- Backend: Node.js + Express
- Database: MongoDB
- Package manager: npm
- Source control: Git

The existing repository structure is the source of truth.

Do not invent folders, layers, conventions, libraries, or architecture patterns before inspecting the existing project.

# Core principle

Prefer consistency over personal preference.

When multiple valid solutions exist, prefer the solution that:

1. Matches the existing codebase.
2. Introduces the least complexity.
3. Has the smallest blast radius.
4. Is easiest to maintain.
5. Is easy to test.
6. Avoids unnecessary dependencies.
7. Preserves existing behavior and architecture.

# Package manager

Use npm only.

Allowed commands include:

`npm install`

`npm install <package>`

`npm uninstall <package>`

`npm run <script>`

`npm test`

`npm audit`

`npm list`

Do not use:

`pnpm`

`yarn`

`bun`

Keep `package-lock.json` synchronized with `package.json`.

Never manually edit `package-lock.json`.

Run npm commands from the correct package directory.

If the repository has separate frontend and backend `package.json` files, install dependencies in the package that actually uses them.

Example:

```text
frontend/package.json
→ frontend dependency

backend/package.json
→ backend dependency
```

Do not install a frontend-only dependency in the backend package or repository root unless the project architecture explicitly requires it.

# Dependency rules

Before installing any dependency:

1. Inspect the relevant `package.json`.
2. Check whether the dependency already exists.
3. Search the project for an existing solution providing the same functionality.
4. Prefer existing project dependencies and patterns.
5. Prefer built-in Node.js or browser functionality where reasonable.
6. Avoid adding dependencies for trivial functionality.
7. Consider maintenance and security impact.
8. Consider frontend bundle-size impact when relevant.
9. Consider runtime and build impact.
10. Install only in the package where the dependency is required.

Do not install a package only because it is personally preferred.

Do not replace an existing working library with another library unless explicitly requested or technically necessary.

# Optional dependencies

Optional architecture libraries must not be installed automatically.

Examples include:

- TanStack Query
- Axios
- Redux
- Zustand
- React Hook Form
- Zod
- UI component libraries
- date libraries
- caching libraries

Before using an optional library:

1. Inspect the relevant `package.json`.
2. Check whether it is already installed.
3. Check whether the project already uses an alternative.
4. Follow the existing project architecture first.
5. Install the library only when the user explicitly requests it or the task clearly requires it.

# Frontend data-fetching dependency decision

Before implementing frontend API communication, inspect the frontend `package.json` and existing source code.

Check for:

- `@tanstack/react-query`
- `axios`
- an existing shared API client
- existing API service files
- existing custom data-fetching hooks
- existing fetch usage

Use the following decision order.

## TanStack Query already installed

If `@tanstack/react-query` is already installed and used by the project:

- Use TanStack Query for server state.
- Follow the existing TanStack Query architecture.
- Use `useQuery` for read operations.
- Use `useMutation` for server-state mutations.
- Keep HTTP communication inside API service functions.
- Reuse the existing Axios or fetch client.

Preferred flow:

Component

→ TanStack Query Hook

→ API Service

→ Shared API Client

→ Backend API

TanStack Query does not replace Axios or fetch.

TanStack Query manages server state, caching, invalidation, retries, and request lifecycle.

Axios or fetch performs the actual HTTP request.

# TanStack Query explicitly requested

If the user explicitly requests TanStack Query and `@tanstack/react-query` is not installed:

Install it using npm in the frontend package.

Example:

```bash
npm install @tanstack/react-query
```

After installation:

- use the existing frontend architecture
- configure `QueryClient` at the appropriate application level
- configure `QueryClientProvider`
- keep HTTP logic inside API services
- do not place raw HTTP request logic throughout React components

Do not install TanStack Query merely because it could be useful.

The user request or existing architecture should justify it.

# TanStack Query not installed

If `@tanstack/react-query` is not installed and the user did not request it:

Do not install it automatically.

Inspect the existing HTTP architecture instead.

If Axios is already installed:

- reuse the existing Axios instance
- reuse existing API service functions
- use custom hooks when useful
- follow the project's existing request-state pattern

Preferred flow:

Component

→ Custom Hook when needed

→ API Service

→ Axios Client

→ Backend API

# Axios dependency decision

If Axios is already installed:

- reuse the existing shared Axios client
- do not create another Axios instance without a clear reason
- do not install another HTTP library for the same purpose

If Axios is not installed:

- inspect whether the project already uses native `fetch`
- follow the existing fetch architecture
- do not install Axios automatically unless the user explicitly requests it or the architecture clearly requires it

If the user explicitly requests Axios and it is not installed:

```bash
npm install axios
```

Install it in the frontend or backend package that actually requires it.

# Data-fetching decision flow

Use this order:

```text
Inspect frontend package.json
        ↓
Inspect existing API architecture
        ↓
Is @tanstack/react-query installed?
        │
        ├── Yes
        │    ↓
        │  Use TanStack Query for server state
        │    ↓
        │  Reuse Axios/fetch underneath
        │
        └── No
             ↓
     Did user explicitly request TanStack Query?
             │
             ├── Yes
             │    ↓
             │  npm install @tanstack/react-query
             │    ↓
             │  Configure and use it
             │
             └── No
                  ↓
             Is Axios installed?
                  │
                  ├── Yes
                  │    ↓
                  │  Reuse Axios architecture
                  │
                  └── No
                       ↓
                  Follow existing fetch pattern
```

Do not create multiple competing API-fetching architectures inside the same frontend without a clear reason.

# Repository boundaries

Before making changes:

- Identify the correct application or package.
- Inspect nearby files.
- Inspect the relevant `package.json`.
- Check existing naming conventions.
- Check existing architecture.
- Check related tests.
- Check existing dependencies.
- Check consumers of the code being changed.
- Check whether a similar implementation already exists.

Do not modify unrelated files.

Do not perform opportunistic refactoring unless required by the task.

Do not move or rename public files, exports, routes, modules, API fields, or shared utilities without checking consumers first.

# Existing code first

Before creating a new:

- component
- hook
- query hook
- mutation hook
- query key factory
- service
- API service
- controller
- repository
- model
- middleware
- utility
- helper
- constant
- type
- validation schema
- API client
- Axios instance
- QueryClient
- provider
- configuration module
- abstraction

search the existing project first.

Prefer this order:

existing implementation

→ extend existing implementation

→ small refactor

→ new implementation

→ new abstraction

Do not create duplicate infrastructure.

Examples of duplicate infrastructure to avoid:

- multiple Axios instances for the same backend
- multiple API service patterns
- duplicate authentication clients
- duplicate query key systems
- multiple state-management solutions for the same responsibility
- duplicate error handlers

# Architecture decisions

Do not introduce a new architectural pattern for a small task when the existing pattern can solve it.

Examples:

Do not introduce TanStack Query for one API request if the project already has a consistent Axios/custom-hook architecture and the user did not request TanStack Query.

Do not introduce Redux for simple component state.

Do not create a repository layer if the backend architecture does not use one and the task does not require it.

Do not introduce a new validation library when an existing validation solution already exists.

# Change strategy

Use the smallest safe change.

Avoid:

- unnecessary rewrites
- unrelated cleanup
- speculative abstractions
- architecture changes without need
- premature optimization
- duplicate implementations
- unnecessary dependencies
- replacing existing tools without reason

When fixing a bug, identify the root cause instead of only hiding the symptom.

When adding a feature, preserve existing behavior unless requirements explicitly change it.

# Before implementation

Before writing code:

1. Understand the requested behavior.
2. Identify the affected package.
3. Inspect relevant files.
4. Inspect relevant `package.json`.
5. Check existing dependencies.
6. Search for similar code.
7. Understand existing architecture.
8. Check API consumers when relevant.
9. Choose the smallest safe implementation.
10. Avoid introducing unnecessary dependencies or patterns.

# Final principle

The repository decides the architecture.

The agent should adapt to the project rather than forcing the project to adapt to the agent.

Prefer:

existing project pattern

→ reuse

→ extend

→ minimal new code

over introducing a new library or architecture without a clear requirement.
```