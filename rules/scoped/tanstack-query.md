```md
---
description: TanStack Query and frontend API data-fetching rules.
alwaysApply: false
trigger: glob
globs:
  - "frontend/src/**"
  - "client/src/**"
paths:
  - "frontend/**"
  - "client/**"
---

# TanStack Query and API data fetching

Use the existing frontend data-fetching architecture first.

Do not introduce a new data-fetching library without checking the existing project and dependencies.

# Dependency detection

Before implementing API fetching, inspect the relevant frontend `package.json`.

Check whether these dependencies already exist:

- `@tanstack/react-query`
- `axios`

Do not assume that TanStack Query or Axios is installed.

# Data-fetching decision flow

Use this decision order.

## If TanStack Query is installed

If `@tanstack/react-query` already exists in the project:

- Use TanStack Query for server state.
- Follow the project's existing TanStack Query patterns.
- Use `useQuery` for reads.
- Use `useMutation` for server mutations.
- Use the existing API service layer.
- Use the existing Axios or fetch client underneath TanStack Query.
- Do not bypass TanStack Query with manual fetching for normal server-state operations unless there is a clear reason.

Preferred flow:

Component

→ Query or Mutation Hook

→ API Service

→ API Client

→ Backend API

Example:

ProductsPage

→ useProducts()

→ getProducts()

→ apiClient.get("/products")

→ Backend API

# If TanStack Query is not installed

If `@tanstack/react-query` is not installed:

- Do not install it automatically.
- Follow the project's existing API-fetching pattern.
- If Axios is already installed, use the existing shared Axios client.
- Keep HTTP logic inside API service files.
- Use custom hooks when useful for reusable request behavior.
- Do not introduce TanStack Query only for a small feature.

Preferred fallback flow:

Component

→ Custom Hook when needed

→ API Service

→ Axios Client

→ Backend API

Example:

ProductsPage

→ useProducts()

→ getProducts()

→ apiClient.get("/products")

→ Backend API

The custom hook in this fallback flow is a normal React hook, not a TanStack Query hook.

# If Axios is not installed

If TanStack Query is not installed and Axios is also not installed:

- Check whether the project already uses the native `fetch` API.
- Follow the existing fetch pattern.
- Do not install Axios automatically unless the user explicitly requests it or the existing architecture requires it.

Fallback flow:

Component

→ Custom Hook when needed

→ API Service

→ fetch

→ Backend API

# Explicit user request

If the user explicitly requests TanStack Query and `@tanstack/react-query` is not installed:

- Install it using npm.
- Use the current project's npm setup.
- Do not use pnpm or yarn.

Install with:

```bash
npm install @tanstack/react-query
```

After installation:

- configure the QueryClient using the project's existing provider architecture
- add `QueryClientProvider` at the appropriate application level
- use TanStack Query for the requested server-state functionality
- keep actual HTTP requests in API service functions

If the user explicitly requests Axios and Axios is not installed:

```bash
npm install axios
```

Do not install Axios if the project already has a suitable shared HTTP client unless the user explicitly requires Axios.

# Important distinction

TanStack Query and Axios solve different problems.

TanStack Query manages:

- server state
- caching
- loading state
- error state
- retries
- invalidation
- refetching
- synchronization

Axios handles:

- HTTP requests
- request configuration
- response configuration
- headers
- interceptors

Therefore, when both are installed, this is valid and preferred:

Component

→ TanStack Query Hook

→ API Service

→ Axios Client

→ Backend API

Do not treat TanStack Query and Axios as direct replacements for each other.

# Server state

When TanStack Query is available, use it for server state.

Server state includes data that comes from or is synchronized with the backend API.

Examples:

- users
- products
- orders
- profile data
- notifications
- paginated API data
- search results
- dashboard data

Do not use TanStack Query for simple local UI state.

Examples of local UI state:

- modal open or closed
- dropdown state
- active tab
- form input while editing
- sidebar state

Use normal React state for local UI concerns unless the existing project uses another local-state solution.

# Existing code first

Before creating:

- API client
- API service
- query hook
- mutation hook
- query key factory
- custom fetching hook
- error handler
- provider

search the existing project first.

Prefer:

existing implementation

→ extend existing implementation

→ small refactor

→ new implementation

Do not create duplicate API architectures.

# Standard TanStack Query request flow

When TanStack Query is installed, follow:

Component

→ Query or Mutation Hook

→ API Service

→ API Client

→ Backend API

Example:

ProductsPage

→ useProducts()

→ getProducts()

→ apiClient.get("/products")

→ Backend API

Do not call `axios` or `fetch` directly inside React components when the project uses an API service layer.

# Recommended structure

Follow the existing project structure first.

When no established structure exists and TanStack Query is used, prefer:

```text
frontend/src/
├── api/
│   ├── apiClient.js
│   ├── auth.api.js
│   ├── user.api.js
│   └── product.api.js
│
├── queries/
│   ├── auth/
│   ├── users/
│   └── products/
│
└── providers/
    └── QueryProvider.jsx
```

A feature query folder may contain:

```text
products/
├── product.keys.js
├── useProducts.js
├── useProduct.js
├── useCreateProduct.js
├── useUpdateProduct.js
└── useDeleteProduct.js
```

Do not create this exact structure if the project already follows another consistent structure.

# API client

Use one shared API client when the project already uses Axios or another shared HTTP client.

Common API client responsibilities:

- base URL
- credentials
- common headers
- interceptors
- request configuration
- response configuration

Do not create a new Axios instance for every feature.

Prefer:

API Client

→ Feature API Service

→ Query or Custom Hook

→ Component

# API services

HTTP communication should live in API service functions.

Example:

```js
export async function getProducts(params) {
  const response = await apiClient.get("/products", {
    params,
  });

  return response.data;
}
```

Keep React-specific behavior out of API service files.

API service files should not call:

- `useQuery`
- `useMutation`
- `useState`
- `useEffect`
- other React hooks

# Query hooks

When TanStack Query is installed, use `useQuery` for read operations.

Examples:

- get user
- get products
- get order
- get dashboard data
- search
- pagination

Example:

```js
export function useProducts(params) {
  return useQuery({
    queryKey: productKeys.list(params),
    queryFn: () => getProducts(params),
  });
}
```

Do not perform POST, PATCH, PUT, or DELETE operations using `useQuery`.

# Mutation hooks

Use `useMutation` for operations that change server state.

Examples:

- create
- update
- delete
- login
- logout
- submit action
- upload

Example:

```js
export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createProduct,

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productKeys.lists(),
      });
    },
  });
}
```

# Query keys

Centralize query keys when practical.

Do not scatter inconsistent hardcoded query keys throughout the application.

Prefer:

```js
export const productKeys = {
  all: ["products"],

  lists: () => [...productKeys.all, "list"],

  list: (params) => [
    ...productKeys.lists(),
    params,
  ],

  details: () => [...productKeys.all, "detail"],

  detail: (id) => [
    ...productKeys.details(),
    id,
  ],
};
```

Avoid inconsistent keys such as:

```js
["products"]
["all-products"]
["getProducts"]
["product-list"]
```

for the same resource.

# Query key dependencies

Every value used by `queryFn` that changes the returned data should normally be represented in the query key.

Example:

```js
useQuery({
  queryKey: ["products", page, category],
  queryFn: () => getProducts({ page, category }),
});
```

Do not reuse the same query key for requests that produce different data.

# Invalidation

After a successful mutation, invalidate only queries affected by the mutation.

Creating a product may invalidate:

```js
productKeys.lists()
```

Updating a product may update or invalidate:

```js
productKeys.detail(productId)
```

and relevant product lists.

Avoid invalidating the entire query cache without a clear reason.

# Cache updates

When a mutation response already contains the authoritative updated resource, consider updating the cache directly.

Example:

```js
queryClient.setQueryData(
  productKeys.detail(product.id),
  product
);
```

Use direct cache updates only when the returned data safely represents the latest server state.

Otherwise invalidate and refetch.

# Optimistic updates

Use optimistic updates only when they materially improve UX.

Do not use them automatically.

When using optimistic updates:

1. cancel relevant queries
2. snapshot previous cache data
3. update the cache optimistically
4. rollback on error
5. invalidate or refetch after settlement when appropriate

Always provide a rollback strategy.

# Loading state

When TanStack Query manages a request, use its request state.

Prefer:

```js
const {
  data,
  isLoading,
  isError,
} = useProducts();
```

Avoid creating duplicate state such as:

```js
const [loading, setLoading] = useState(false);
```

when TanStack Query already manages the request lifecycle.

# Error state

Use query and mutation error states.

Do not silently ignore errors.

Follow the project's existing error-display approach.

Examples:

- inline error
- toast
- error boundary
- shared API error handler

Do not expose sensitive backend error details directly to users.

# Duplicate state

Do not copy query data into local React state unless there is a real reason, such as editing a temporary local copy.

Avoid:

```js
const { data } = useProducts();
const [products, setProducts] = useState([]);

useEffect(() => {
  setProducts(data);
}, [data]);
```

when the UI can consume `data` directly.

# Derived data

Prefer deriving values from query data.

Example:

```js
const activeProducts =
  products?.filter((product) => product.isActive) ?? [];
```

Do not create unnecessary effects to synchronize derived state.

# Enabled queries

Use `enabled` when a query depends on required data.

Example:

```js
useQuery({
  queryKey: productKeys.detail(productId),
  queryFn: () => getProduct(productId),
  enabled: Boolean(productId),
});
```

Do not send requests with missing required IDs only to handle the resulting backend error.

# Pagination

Include pagination parameters in the query key.

Example:

```js
queryKey: productKeys.list({
  page,
  limit,
  search,
})
```

Keep pagination behavior consistent with the backend API.

Do not mix cursor-based and page-based pagination in the same feature without a clear reason.

# Infinite queries

Use infinite queries only when the interface genuinely needs incremental loading.

Examples:

- infinite feed
- load more
- endless scrolling

Do not use infinite queries for normal paginated tables unless the UX requires them.

# Search

For search APIs:

- include the search value in the query key
- avoid requests for invalid input
- debounce when appropriate
- follow backend minimum search-length requirements if they exist

Do not implement duplicate manual caching around TanStack Query.

# staleTime

Do not set one global `staleTime` blindly for every query.

Choose stale time based on how frequently data changes.

Highly dynamic data may use shorter stale times.

Mostly static data may use longer stale times.

Follow existing project conventions when available.

# gcTime

Do not change `gcTime` without a reason.

Understand memory usage and refetch behavior before changing cache lifetime.

# Refetching

Do not globally disable refetch behavior only to reduce API calls.

Configure behavior such as:

- refetch on mount
- refetch on window focus
- refetch on reconnect

according to product requirements.

# Retries

Do not retry every failed request blindly.

Avoid unnecessary retries for predictable client errors such as:

- 400
- 401
- 403
- 404

when retrying cannot solve the problem.

Retry transient failures only when appropriate.

Follow the project's existing API error strategy.

# Authentication

Do not store passwords in TanStack Query cache.

Do not place sensitive values inside query keys.

Never use query keys containing:

- passwords
- access tokens
- refresh tokens
- API keys
- secrets

Authentication tokens should follow the project's existing secure storage or cookie strategy.

For current-user data, use a stable query key such as:

```js
["auth", "me"]
```

or follow the project's existing convention.

# Login

Login is normally a mutation when TanStack Query is used.

Example flow:

LoginForm

→ useLogin()

→ login()

→ POST /auth/login

→ update relevant authentication state or cache

Do not model login as a normal read query.

# Logout

Logout should clear or invalidate authenticated private data when required.

Do not leave cached private data belonging to the previous authenticated user.

Follow the project's existing authentication architecture.

# Dependent queries

When one query depends on another, represent that dependency explicitly.

Example:

```js
const userQuery = useUser();

const ordersQuery = useQuery({
  queryKey: ["orders", userQuery.data?.id],
  queryFn: () => getOrders(userQuery.data.id),
  enabled: Boolean(userQuery.data?.id),
});
```

Do not trigger dependent API requests before required data exists.

# Query cancellation

Respect request cancellation where supported by the project's HTTP client.

Cancellation is especially useful for:

- search
- rapidly changing filters
- navigation
- long-running requests

Do not introduce complicated cancellation logic without practical benefit.

# Prefetching

Use prefetching when the user's next action is predictable and prefetching meaningfully improves UX.

Do not prefetch large amounts of unnecessary data.

# QueryClient

Create the QueryClient at the appropriate application or provider level.

Do not create a new `QueryClient` inside normal components.

Example:

```js
const queryClient = new QueryClient();
```

should normally live near application bootstrap or provider setup.

# Global defaults

Keep global query defaults conservative.

Do not configure aggressive global behavior for a requirement that only belongs to one feature.

Feature-specific behavior should usually remain feature-specific.

# Side effects

Avoid unrelated side effects inside `queryFn`.

A query function should primarily fetch and return data.

Do not normally use query functions to:

- navigate
- display UI
- mutate unrelated state
- trigger unrelated actions

# Query function output

Return useful application data from API functions.

Prefer:

```js
return response.data;
```

over forcing every component to understand raw Axios response objects, unless the existing project intentionally uses raw responses.

# Component responsibilities

Components should primarily:

- render data
- handle user interaction
- call hooks
- display loading states
- display error states

Components should not normally contain:

- raw API URLs
- Axios configuration
- authentication-header logic
- cache invalidation logic
- repeated request logic

# Final decision rule

Before implementing frontend API communication:

1. Inspect the frontend `package.json`.
2. Inspect existing API clients and services.
3. Inspect existing query or custom-hook patterns.
4. If TanStack Query is installed, use it for server state.
5. Use the existing Axios or fetch client underneath it.
6. If TanStack Query is not installed, do not install it automatically.
7. If Axios already exists, use the existing Axios architecture.
8. If neither exists, follow the project's existing fetch approach.
9. If the user explicitly requests TanStack Query, install it with npm if required.
10. Never create a second competing API architecture without a clear reason.

Preferred TanStack flow:

Component
→ TanStack Query Hook
→ API Service
→ Axios or Fetch Client
→ Backend API

Fallback flow without TanStack Query:

Component
→ Custom Hook when needed
→ API Service
→ Axios or Fetch
→ Backend API
```

Isko existing:

```text
rules/scoped/tanstack-query.md
```

se replace kar do.

Is version mein agent khud pehle `package.json` check karega, aur bina wajah TanStack install nahi karega.