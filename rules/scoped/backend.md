```md
---
description: Node.js and Express backend engineering rules.
alwaysApply: false
trigger: glob
globs:
  - "backend/**"
  - "server/**"
  - "src/routes/**"
  - "src/controllers/**"
  - "src/services/**"
  - "src/middleware/**"
paths:
  - "backend/**"
  - "server/**"
---

# Backend

Follow the project's existing Node.js and Express architecture.

The existing backend structure is the source of truth.

Before making changes:

- inspect relevant routes
- inspect middleware
- inspect controllers
- inspect services if they exist
- inspect models or repositories
- inspect validation
- inspect error handling
- inspect related tests
- check frontend consumers if API behavior may change

Do not introduce a new backend architecture for a small task.

# Request flow

Follow the existing project flow.

A common flow may look like:

Request

→ Middleware

→ Route

→ Controller

→ Service

→ Model / Database

→ Response

Do not create missing architectural layers automatically.

If the project currently uses:

Route

→ Controller

→ Model

continue following that pattern unless another layer is genuinely required.

If the project already uses:

Route

→ Controller

→ Service

→ Repository

→ Model

reuse those existing layers.

Do not add architectural layers only because they look cleaner in theory.

# Routes

Routes should primarily define:

- HTTP method
- path
- middleware
- validation
- controller

Avoid putting large business workflows directly in route files.

Reuse existing middleware instead of duplicating request checks.

# Controllers

Controllers should coordinate HTTP request and response behavior.

Typical responsibilities include:

- reading validated request data
- reading authenticated user context
- calling services or models
- selecting appropriate HTTP status codes
- returning API responses

Keep controllers thin when the project has a service layer.

Do not make controllers unnecessarily large.

Avoid placing reusable business logic directly inside controllers when an existing service layer can handle it.

# Services

When the project has services, use them for reusable business logic.

Services may coordinate:

- business rules
- database operations
- external APIs
- transactions
- reusable workflows

Avoid coupling services directly to Express:

- `req`
- `res`
- `next`

unless this is already an established project convention.

Prefer explicit service inputs.

Example:

```js
createOrder({
  userId,
  items,
  shippingAddress,
});
```

instead of passing the entire request object.

# Models and repositories

Follow the project's existing database architecture.

If the project uses Mongoose models directly, continue using them.

If the project already uses repositories, reuse them.

Do not introduce a repository layer automatically.

Do not expose raw database internals in API responses.

# Middleware

Middleware should have one clear responsibility.

Examples:

- authentication
- authorization
- validation
- logging
- rate limiting
- request context
- file upload handling
- error handling

Do not put large business workflows into middleware.

Reuse existing middleware where appropriate.

# Authentication

Use the project's existing authentication middleware.

Do not manually verify tokens again inside every controller if authentication middleware already handles it.

Prefer a flow such as:

Authentication token

→ Authentication middleware

→ Trusted user context

→ Controller

Do not trust a client-provided user ID when authenticated user context already provides the authoritative identity.

# Authorization

Authentication and authorization are different.

Authentication determines:

Who is the user?

Authorization determines:

Is this user allowed to perform this action?

Check relevant:

- roles
- permissions
- ownership
- organization boundaries
- tenant boundaries

Do not rely on frontend authorization checks.

Backend authorization is authoritative.

# Validation

Validate external input before business logic or database operations.

Validate where relevant:

- request body
- route params
- query params
- headers
- uploaded files

Reuse the project's existing validation library and conventions.

Do not introduce another validation library if one already exists.

Frontend validation is not sufficient.

Backend validation remains authoritative.

# Request body safety

Do not blindly pass user-controlled request bodies into database updates.

Avoid:

```js
await User.findByIdAndUpdate(userId, req.body);
```

when protected fields exist.

Prefer validated or explicitly allowed fields.

Protect fields such as:

- role
- permissions
- ownership
- internal status
- password hash
- security settings
- billing state

# Errors

Use the existing centralized error-handling approach.

Do not repeat identical `try/catch` blocks in every controller when the project already uses an async wrapper.

Map expected errors to meaningful application or HTTP errors.

Examples:

- validation error
- not found
- conflict
- unauthenticated
- forbidden

Unexpected errors should be handled centrally.

Do not expose:

- stack traces
- raw database errors
- credentials
- secrets
- provider internals
- filesystem paths

in production responses.

# Error handling

Do not silently swallow errors.

Avoid:

```js
try {
  await operation();
} catch {}
```

Prefer:

- propagate the error
- transform it using the existing error system
- log it at the appropriate boundary
- return a safe client response

# Logging

Use the project's existing logger when available.

Avoid random production:

```js
console.log(...)
```

Log useful context such as:

- operation
- request ID
- safe resource identifier
- error category

Never log:

- passwords
- access tokens
- refresh tokens
- authorization headers
- API keys
- secrets
- private keys

# Database operations

Avoid:

- unnecessary repeated database queries
- N+1 queries
- unbounded collection reads
- unnecessary population
- loading huge datasets into memory
- duplicate database lookups

Use projections or selected fields where appropriate.

Follow the detailed rules in `rules/scoped/database.md`.

# Transactions

Use transactions when multiple dependent writes must succeed or fail together.

Do not use transactions for simple independent operations without a reason.

Consider transaction behavior for workflows such as:

- order creation
- inventory updates
- financial operations
- multiple dependent writes

# Concurrency

Be careful with concurrent operations involving:

- inventory
- counters
- quotas
- duplicate resource creation
- bookings
- payments

Avoid unsafe read-then-write flows when concurrent requests can modify the same resource.

Prefer atomic database operations when appropriate.

# External APIs

Keep third-party API logic organized according to the existing architecture.

Examples:

- payment providers
- email providers
- SMS providers
- storage providers
- external APIs

Do not scatter provider SDK calls throughout controllers.

Prefer an existing service or integration layer.

# External failures

Handle external API failures intentionally.

Consider:

- timeout
- network failure
- provider unavailable
- rate limits
- invalid responses
- authentication failures

Do not expose raw third-party errors to clients if they reveal sensitive or implementation-specific information.

# Retries

Retry only operations that are safe to retry.

Do not blindly retry non-idempotent operations such as:

- payments
- order creation
- email sending
- external mutation requests

unless proper idempotency protection exists.

# Duplicate submissions

Consider duplicate-request protection for operations where repetition can cause harmful side effects.

Examples:

- orders
- payments
- email sending
- account actions
- webhook processing

Frontend button disabling improves UX but is not complete backend protection.

# Request lifecycle

Be careful with:

- request cancellation
- timeouts
- long-running operations
- external APIs
- duplicate submissions
- retry behavior

Do not leave requests hanging indefinitely.

Every request path should intentionally:

- return a response
- pass control to middleware
- or propagate an error

# Response handling

Avoid sending multiple responses for the same request.

When execution should stop after responding, prefer:

```js
return res.status(400).json({
  message: "Invalid request",
});
```

instead of continuing execution after sending the response.

# Performance

Avoid:

- unnecessary repeated database queries
- N+1 queries
- loading huge datasets into memory
- CPU-heavy synchronous work on request paths
- blocking filesystem operations
- sequential independent network/database operations

Use parallel operations only when they are truly independent.

Example:

```js
const [user, settings] = await Promise.all([
  getUser(userId),
  getSettings(userId),
]);
```

Do not parallelize operations when order or transaction behavior matters.

Do not optimize without evidence or requirement.

# Memory

Do not load arbitrarily large files or datasets into memory.

Prefer when appropriate:

- pagination
- batching
- streaming

Do not introduce unnecessary complexity for small datasets.

# Security middleware

Preserve existing security middleware.

Examples:

- Helmet
- CORS
- rate limiting
- CSRF protection
- secure cookies

Do not disable security middleware only to make a feature work.

Fix the underlying configuration problem.

# CORS

Follow the existing CORS configuration.

Do not allow unrestricted production origins without an explicit requirement.

Be careful when using credentials with CORS.

# Environment variables

Use the project's existing configuration system.

Do not hardcode:

- secrets
- database credentials
- API keys
- tokens
- production URLs

Do not edit `.env` files unless explicitly requested.

# Frontend boundary

The backend API should not depend on which frontend request library is used.

The same backend API should work with:

- TanStack Query
- Axios
- native fetch
- mobile clients
- external clients

TanStack Query is a frontend server-state concern.

Backend code should not know about:

- `useQuery`
- `useMutation`
- query keys
- `invalidateQueries`
- `staleTime`
- `gcTime`

Keep frontend cache behavior out of backend controllers and services.

Follow `rules/scoped/api.md` for API contract rules.

# API compatibility

Before changing:

- routes
- HTTP methods
- status codes
- response fields
- pagination behavior
- error response shapes

check existing consumers.

Preserve existing API behavior unless the requirement explicitly changes it.

# Testing

When changing backend behavior, inspect existing tests.

Relevant changes may require coverage for:

- success
- invalid input
- missing resource
- unauthenticated request
- unauthorized request
- conflict or duplicate behavior
- database failure
- external service failure

Do not weaken tests only to make implementation pass.

# Existing code first

Before creating a new:

- route
- controller
- service
- repository
- middleware
- validator
- error class
- logger
- integration client
- helper

search the existing backend first.

Prefer:

existing implementation

→ extend existing implementation

→ small refactor

→ create new implementation

Do not create duplicate backend infrastructure.

# Final backend rule

Prefer the existing architecture.

A typical layered flow may be:

Request

→ Security / Request Middleware

→ Validation

→ Route

→ Controller

→ Service

→ Model / Repository

→ MongoDB

→ Service

→ Controller

→ Response

Keep each layer focused on its responsibility.

Do not add layers only because they look architecturally cleaner.

Consistency with the existing project is more important than forcing a theoretical architecture.
```