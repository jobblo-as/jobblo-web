/**
 * Shared mock API + page-health helpers for the page smoke and flow specs.
 * Same style as developer-console.spec.js: one page.route on the API origin, a few
 * fixtures, and an empty-but-successful answer for anything a page asks that a test
 * does not care about.
 */
import { expect as baseExpect } from '@playwright/test';

// Lazy routes compile on first request on the Vite dev server; give them time.
export const expect = baseExpect.configure({ timeout: 25_000 });
export const API = 'http://127.0.0.1:5017';

export const USERS = {
  user: {
    _id: '64a000000000000000000001',
    name: 'TEST Customer',
    email: 'customer@example.test',
    role: 'user',
    subscription: 'Standard',
    accountType: 'private',
  },
  provider: {
    _id: '64a000000000000000000002',
    name: 'TEST Provider',
    email: 'provider@example.test',
    role: 'user',
    subscription: 'Standard',
    accountType: 'business',
  },
  superAdmin: {
    _id: '64a000000000000000000003',
    name: 'TEST Admin',
    email: 'admin@example.test',
    role: 'superAdmin',
  },
  developer: {
    _id: '64a000000000000000000004',
    name: 'TEST Developer',
    email: 'dev@example.test',
    role: 'developer',
  },
};

export const SERVICE = {
  _id: '64b000000000000000000001',
  title: 'TEST Male stue',
  description: 'E2E testoppdrag: male en stue på 20 kvm.',
  status: 'open',
  price: 3000,
  paymentType: 'Fastpris',
  categories: ['Maling'],
  images: [],
  location: { city: 'Oslo', address: 'Testveien 1', coordinates: [10.75, 59.91] },
  userId: { _id: USERS.user._id, name: USERS.user.name, role: 'user' },
  createdAt: '2026-10-20T10:00:00.000Z',
};

/**
 * Mock every /api call. `as` = who the refresh cookie belongs to (null = anonymous).
 * `routes` = extra handlers `{ 'GET /api/x': (ctx) => body | {status, json} }` (exact path,
 * or `'~METHOD regex'`). `fallback: 'down'` answers everything else with 503. Returns { calls, state } so tests can assert and switch user.
 */
export async function mockApi(
  page,
  { as = null, routes = {}, mfaVerified = true, fallback = 'empty' } = {}
) {
  const calls = [];
  const state = {
    session: as ? USERS[as] || as : null,
    mfa: { required: true, enabled: true, verified: mfaVerified },
  };
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const method = request.method();
    let body = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = request.postData();
    }
    calls.push({ method, pathname, search: url.search, body });
    const reply = (res) => {
      if (res && typeof res === 'object' && 'status' in res && 'json' in res)
        return route.fulfill(res);
      return route.fulfill({ json: res });
    };

    const custom = routes[`${method} ${pathname}`] || routes[pathname];
    if (custom) return reply(await custom({ request, body, url, state, calls }));
    for (const [key, fn] of Object.entries(routes)) {
      if (key.startsWith('~')) {
        const [m, re] = key.slice(1).split(' ');
        if ((m === '*' || m === method) && new RegExp(re).test(pathname))
          return reply(await fn({ request, body, url, state, calls }));
      }
    }

    if (pathname === '/api/auth/refresh-token') {
      if (!state.session)
        return route.fulfill({ status: 401, json: { error: 'Refresh token missing' } });
      return route.fulfill({ json: { accessToken: `at-${state.session._id}` } });
    }
    if (pathname === '/api/auth/profile') {
      if (!state.session) return route.fulfill({ status: 401, json: { error: 'Invalid token' } });
      return route.fulfill({ json: state.session });
    }
    if (pathname === '/api/auth/logout') {
      state.session = null;
      return route.fulfill({ json: { message: 'ok' } });
    }
    if (pathname === '/api/auth/mfa' && method === 'GET') return route.fulfill({ json: state.mfa });
    if (pathname === '/api/developer/me' && state.session) {
      return route.fulfill({
        json: {
          success: true,
          data: {
            ...state.session,
            environment: 'test',
            access: 'operations',
            can: { triage: true, request: true, execute: true, approve: true },
          },
        },
      });
    }
    if (pathname.startsWith('/socket.io')) return route.abort();
    // Public profile of a known fixture user.
    const known =
      method === 'GET' && Object.values(USERS).find((u) => pathname === `/api/users/${u._id}`);
    if (known)
      return route.fulfill({ json: state.session?._id === known._id ? state.session : known });
    if (fallback === 'down')
      return route.fulfill({
        status: 503,
        json: { success: false, message: 'Service unavailable (e2e)' },
      });
    // Anything else: an empty, successful answer in the envelope that area uses
    // (admin/developer controllers wrap in { success, data }; the rest mostly return bare lists).
    if (pathname.startsWith('/api/developer/'))
      return route.fulfill({ json: { success: true, data: {} } });
    if (pathname.startsWith('/api/admin/'))
      return route.fulfill({ json: { success: true, data: [] } });
    return route.fulfill({ json: [] });
  });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('cookie-consent', 'rejected');
    } catch {
      /* storage blocked */
    }
  });
  return { calls, state };
}

/** A full-page screenshot into $E2E_SHOTS (to show a reviewer the flow); a no-op without it. */
export async function shot(page, name) {
  if (process.env.E2E_SHOTS)
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png`, fullPage: true });
}

/** Collect uncaught exceptions and console errors for a page. */
export function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Network noise from the mocked/aborted origin, not app bugs.
    if (
      /Failed to load resource|net::ERR_|WebSocket|[Ss]ocket connection error|socket\.io|status of 4\d\d/.test(
        text
      )
    )
      return;
    // React Query's dev warning when the generic empty mock lacks the field a query unwraps.
    if (/^Query data cannot be undefined/.test(text)) return;
    // Known, reported: Header logs React Query's CancelledError as a failure when a page refetches chats.
    if (/^Error initializing chat state in Header: CancelledError/.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}
