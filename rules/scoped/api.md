```md
---
description: HTTP API compatibility, validation, response contracts, frontend consumption, and integration rules.
alwaysApply: false
trigger: glob
globs:
  - "backend/**/routes/**"
  - "backend/**/controllers/**"
  - "server/**/routes/**"
  - "server/**/controllers/**"
paths:
  - "backend/**"
  - "server/**"
---

# API

Existing API contracts should remain stable unless explicitly changed.

Before changing an API:

1. Inspect the existing route.
2. Inspect the controller and related service.
3. Inspect request validation.
4. Inspect frontend consumers.
5. Inspect tests.
6. Inspect API documentation when available.
7. Preserve backward compatibility where practical.

Do not redesign an existing API contract for a small implementation change.

# API boundary

The backend API contract should not depend on which frontend data-fetching library is used.

The same backend API should work with:

- TanStack Query
- Axios
- native fetch
- mobile clients
- external clients

TanStack Query is a frontend server-state layer.

Axios and fetch are HTTP clients.

Backend controllers should not contain TanStack Query-specific behavior.

# Frontend API consumption

When frontend code consumes the API:

- keep response shapes predictable
- keep error formats consistent
- preserve field names unless intentionally changing the contract
- keep pagination behavior stable
- keep filter and sorting semantics stable
- document important contract changes when needed

Do not rename API fields without checking frontend consumers.

Example:

If the frontend expects:

```json
{
  "data": [],
  "page": 1,
  "total": 100
}
```

do not casually change it to:

```json
{
  "items": [],
  "currentPage": 1,
  "count": 100
}
```

without checking and updating consumers.

# HTTP methods

Follow conventional HTTP semantics where consistent with the existing project.

- GET: read data
- POST: create a resource or perform an action
- PUT: full replacement when applicable
- PATCH: partial update
- DELETE: delete a resource

Do not change an existing HTTP method only for stylistic preference.

# Route design

Follow the project's existing route conventions.

Prefer predictable resource-oriented routes where appropriate.

Examples:

```text
GET    /products
GET    /products/:id
POST   /products
PATCH  /products/:id
DELETE /products/:id
```

Do not create multiple routes that perform the same operation without a clear reason.

Before renaming a route, check all consumers.

# Status codes

Use meaningful HTTP status codes.

Common examples:

- `200` successful request
- `201` resource created
- `204` successful request with no response body
- `400` invalid request
- `401` unauthenticated
- `403` authenticated but forbidden
- `404` resource not found
- `409` conflict
- `422` validation failure when project convention uses it
- `429` rate limited
- `500` unexpected server error
- `503` temporarily unavailable

Follow existing project conventions when they differ.

Do not return `200` for every response when a more appropriate status code already exists in the project.

# Response consistency

Keep API response shapes consistent.

Do not rename response fields casually.

Before changing a response field, search for:

- frontend consumers
- mobile consumers
- tests
- documentation
- external integrations

Do not expose:

- stack traces
- password hashes
- private fields
- database internals
- access tokens unless intentionally required
- refresh tokens unless intentionally required
- secrets
- internal infrastructure details

# Success responses

Follow the project's existing success-response convention.

If the project uses a wrapper such as:

```json
{
  "success": true,
  "data": {}
}
```

continue using that pattern.

If the project returns resources directly, do not introduce a wrapper for one endpoint without a clear reason.

Consistency is more important than personal preference.

# Error responses

Follow the project's existing error-response format.

A useful error response may contain:

- stable error code
- safe user-facing message
- validation details when appropriate

Example:

```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Invalid request data"
}
```

Do not expose internal exception messages when they may reveal sensitive implementation details.

Do not expose stack traces in production responses.

# Validation

Validate relevant external input before using it.

This may include:

- request body
- route params
- query params
- headers
- uploaded files

Frontend validation is not sufficient.

The backend remains authoritative.

Reuse the project's existing validation library and conventions.

Do not introduce another validation library if a suitable one already exists.

# Request body

Accept only fields that the endpoint actually supports.

Do not blindly pass user-controlled request bodies into database updates.

Avoid patterns that unintentionally allow users to update protected fields.

Examples of protected fields may include:

- role
- permissions
- ownership
- password hash
- internal status
- billing fields
- system metadata

Use explicit allowed fields or existing validation schemas.

# Route parameters

Validate route parameters before database operations.

For MongoDB IDs, follow the project's existing ObjectId validation strategy.

Do not rely only on database errors to identify malformed IDs.

# Query parameters

Validate and normalize query parameters.

Examples:

- page
- limit
- search
- sort
- filters

Remember that URL query parameters normally arrive as strings.

Convert values intentionally before using them.

# Pagination

Follow the project's existing pagination strategy.

Do not mix cursor and offset/page pagination without a clear reason.

Collection endpoints should have reasonable limits.

Avoid endpoints that unintentionally return extremely large datasets.

For page-based pagination, keep parameter names consistent.

Example:

```text
?page=1&limit=20
```

For cursor pagination, keep cursor semantics stable and documented.

# Pagination response

Preserve the project's existing pagination response shape.

Typical metadata may include:

- items/data
- page
- limit
- total
- totalPages

or:

- items/data
- nextCursor
- hasNextPage

Do not mix both styles arbitrarily.

# Filtering

Validate supported filters.

Do not pass arbitrary client-provided filter objects directly into MongoDB.

Prefer an allowlist of supported filter fields.

Example concept:

```text
Allowed:
category
status
brand

Not automatically allowed:
any arbitrary database field
```

# Sorting

Validate allowed sorting fields and directions.

Do not pass arbitrary user-controlled field names directly into sensitive database operations.

Restrict sorting to fields the API intentionally supports.

# Searching

Follow the existing search behavior.

When relevant:

- trim input
- validate minimum length
- limit result size
- avoid unsafe regular expressions
- avoid full collection scans when a suitable indexed strategy exists

Do not redesign search behavior without understanding existing database indexes and requirements.

# Authentication

Protected endpoints should use the project's existing authentication middleware.

Do not duplicate token verification inside individual controllers when middleware already handles it.

Authentication answers:

"Who is the user?"

Authorization answers:

"Is the user allowed to perform this action?"

Both may be required.

# Authorization

Perform authorization on the backend.

Frontend route guards are not a security boundary.

Check relevant:

- role
- permission
- resource ownership
- tenant/account boundary

Do not trust client-provided ownership or role fields.

# Idempotency

Consider repeated requests for operations involving:

- orders
- payments
- emails
- notifications
- external APIs
- retries
- job creation

Use the project's existing idempotency strategy where applicable.

Do not add complex idempotency infrastructure to ordinary CRUD operations without a real requirement.

# Duplicate submissions

For operations where duplicate requests can cause harmful side effects, consider protection at the backend.

Frontend button disabling alone is not a complete guarantee.

Examples:

- payment creation
- order submission
- sending emails
- external service actions

# Rate limiting

Use existing rate-limiting infrastructure where appropriate.

Typical sensitive endpoints may include:

- login
- password reset
- OTP
- verification
- public search
- expensive endpoints

Do not introduce a second competing rate-limit system if one already exists.

# Caching

Backend HTTP caching and frontend TanStack Query caching are separate concerns.

TanStack Query cache should not determine backend response correctness.

Before adding HTTP or proxy caching, consider:

- authenticated responses
- private user data
- stale data tolerance
- invalidation requirements
- cache headers

Never cache private authenticated responses publicly unless explicitly designed to be safe.

# TanStack Query compatibility

When the frontend uses TanStack Query:

- keep API responses predictable
- keep query parameters deterministic
- preserve resource identifiers
- preserve pagination semantics
- return useful mutation results when appropriate

TanStack Query-specific caching logic belongs in frontend query hooks.

Backend code should not know about:

- query keys
- `useQuery`
- `useMutation`
- `invalidateQueries`
- `staleTime`
- `gcTime`

# Mutation responses

For create or update operations, return useful authoritative data when consistent with the project.

Example:

```json
{
  "data": {
    "id": "123",
    "name": "Updated product"
  }
}
```

This may allow frontend clients to update cache safely.

Do not return partial or misleading resource data unless the contract intentionally defines it.

# API performance

Avoid unnecessary work inside request handlers.

Be careful with:

- repeated database queries
- N+1 queries
- unbounded collection reads
- large response payloads
- synchronous CPU-heavy work
- unnecessary population
- unnecessary external API calls

Optimize based on actual requirements and evidence.

# Timeouts and external APIs

When an endpoint depends on an external service:

- follow existing timeout strategy
- handle network failures
- avoid hanging requests
- normalize external errors
- do not expose external credentials or raw provider errors

Retries should only be used when safe.

# Backward compatibility

Avoid breaking existing consumers unless explicitly requested.

If an API contract must change, check:

- frontend consumers
- mobile consumers if present
- tests
- documentation
- external integrations

When practical, introduce additive changes instead of destructive changes.

Prefer adding a new optional field over renaming or removing an existing field.

# API versioning

Do not introduce API versioning automatically.

If the project already uses versioning, follow the existing convention.

Examples:

```text
/api/v1/products
/api/v2/products
```

Introduce a new API version only when compatibility requirements justify it.

# Documentation

When the project has API documentation, keep it synchronized with meaningful API changes.

Examples:

- OpenAPI
- Swagger
- README examples
- Postman collections

Do not update unrelated documentation.

# Testing

When changing API behavior, inspect existing API tests.

Relevant changes may require tests for:

- successful request
- invalid input
- unauthenticated request
- unauthorized request
- resource not found
- pagination
- filtering
- duplicate/conflict behavior

Do not weaken existing API tests just to make a change pass.

# Final API rule

Prefer this boundary:

```text
Frontend
    ↓
TanStack Query / Custom Hook
    ↓
Axios / Fetch
    ↓
HTTP API
    ↓
Route
    ↓
Middleware
    ↓
Controller
    ↓
Service
    ↓
Database
```

Each layer should keep its own responsibility.

Frontend data-fetching libraries should not leak into backend architecture.

Backend implementation details should not leak into public API responses.

Preserve existing contracts unless there is a clear requirement to change them.
