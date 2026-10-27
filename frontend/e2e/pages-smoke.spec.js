import { test } from '@playwright/test';
import { expect, mockApi, watchErrors, SERVICE } from './helpers/app.js';

/**
 * Every route in src/routing/Routes.tsx, opened as the role that may see it, against a
 * mocked API that answers anything unexpected with an empty list. A page passes when it
 * stays on its URL (or the expected redirect), is not the error boundary or the 404 page,
 * shows content, and throws nothing (pageerror / console.error).
 */

const ID = '64c000000000000000000001';
const JOB = SERVICE._id;

const anon = [
  '/', '/home', '/oppdragstakere', '/search', '/search/job', '/search/job/Maling',
  `/jobs/${JOB}`, `/job-listing/${JOB}`, `/profile/${ID}`, '/team',
  '/support', '/delete-account', '/sale-subscription-terms', '/cookies',
  '/about', '/user-term', '/kampanjevilkar', '/upcoming', '/login', '/register', '/forgot-password',
];

const settings = ['', 'name', 'bio', 'picture', 'banner', 'email', 'phone', 'addresses', 'safepay', 'payout',
  'password', 'delete-account', 'location', 'upcoming', 'visibility', 'blocked', 'cookies', 'sessions', 'about',
  'notifications', 'subscriptions', 'seeker'].map((s) => `/settings${s ? `/${s}` : ''}`);

const user = [
  `/completed-job/${ID}`, `/job-applicants/${JOB}`, '/my-applicants',
  `/provider/orders/${ID}`, `/safepay/checkout/${ID}`, '/safepay/success', `/safepay/approval/${ID}`,
  '/profile', '/mine-annonser', '/Publish-job', `/Publish-job/${JOB}`, '/alerts', ...settings,
  '/favorites', `/favorites/list/${ID}`, '/coins', '/messages', `/messages/${ID}`, '/membership', '/subscription/success',
];

const dashboard = ['', 'users', `users/${ID}`, 'services', `services/${JOB}/edit`, 'orders', `orders/${ID}`, 'reviews',
  'categories', 'voucher', 'transactions', 'notifications', 'roadmap', 'plans', 'safepay', 'finance-history',
  'subscription-billing', `safepay/${ID}`, 'disputes', `disputes/${ID}`, 'chat-review', 'chats', `chats/${ID}`,
  'chat-reports', `chat-reports/${ID}`, 'job-reports', `job-reports/${ID}`, 'system-health', 'homepage-cms',
  'campaigns', 'settings', 'navigation-footer', 'announcements', 'maintenance', 'shop',
].map((s) => `/dashboard${s ? `/${s}` : ''}`);

const developer = ['', 'api', 'errors', 'server', 'mongo', 'scheduler', 'webhooks', 'audit', 'tools', 'payments',
  'safepay', 'subscriptions', 'reconciliation', 'users', 'jobs', 'logs', 'live', 'security', 'flags', 'performance',
  'notifications', 'queues', 'redis', 'redis/keys', 'tickets', 'deployments', 'incidents', 'reports', 'settings', 'ips',
  'approvals', 'investigate', 'integrity', 'backups', 'safepay-machine', 'synthetic', 'mobile', 'dependencies', 'slo',
  'deployment-impact', 'costs', 'capacity', 'config-drift', 'failure-simulator', 'fraud', 'contracts', 'connect',
  'ledger', 'transactions', 'rum', 'risk', 'quality', 'sessions', 'search', 'privacy', 'runbooks', 'migrations',
  'event-consistency', 'marketplace', 'impact', 'not-built-yet',
].map((s) => `/developer${s ? `/${s}` : ''}`);

// Redirect routes: [path, role, where it must land].
const redirects = [
  ['/pricing', 'user', /\/membership$/],
  ['/dashboard/activity', 'superAdmin', /\/developer\/audit$/],
  ['/dashboard/feature-flags', 'superAdmin', /\/developer\/flags$/],
  ['/dashboard/error-logs', 'superAdmin', /\/developer\/errors$/],
  ['/oauth-success', 'user', /\/home$/],
  ['/my-applications', 'user', /\/my-applicants$/],
  // Without the router state a paid contact sets, there is nothing to confirm.
  // Guards
  ['/profile', null, /\/login$/],
  ['/dashboard', 'user', /\/profile$/],
  ['/developer', 'user', /\/profile$/],
  ['/login', 'user', /\/home$/],
];

// A cold Vite dev server compiles each lazy route on first visit.
test.describe.configure({ timeout: 300_000 });

async function goto(page, path) {
  // The dev server restarts when another process touches its config; retry a refused connection.
  for (let i = 0; ; i++) {
    try { await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 }); break; } catch (e) {
      if (i >= 4 || !/ERR_CONNECTION_(REFUSED|RESET)/.test(e.message)) throw e;
      await page.waitForTimeout(3000);
    }
  }
  // Session bootstrap and the lazy chunk both show role=status "Laster …". Under parallel
  // load the dev server occasionally drops a lazy-chunk request; one reload recovers it.
  const loader = page.getByRole('status').filter({ hasText: /^Laster/ });
  try {
    await expect(loader).toHaveCount(0, { timeout: 40_000 });
  } catch {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(loader).toHaveCount(0, { timeout: 60_000 });
  }
}

async function visit(page, path, as, fallback) {
  const errors = watchErrors(page);
  await mockApi(page, { as, fallback });
  await goto(page, path);
  return errors;
}

/**
 * Opens each path in one tab (the module cache stays warm, which keeps a ~170-route sweep
 * affordable on the dev server) and records every failure with expect.soft, so one report
 * lists all broken routes. `fallback: 'down'` answers unknown API calls with 503.
 */
async function sweep(page, paths, as, fallback = 'empty') {
  const errors = watchErrors(page);
  await mockApi(page, { as, fallback });
  for (const path of paths) {
    errors.length = 0;
    await goto(page, path);
    await expect.soft(page, `${path}: stays on its URL`).toHaveURL((u) => decodeURI(u.pathname) === path);
    await expect.soft(page.getByRole('heading', { name: 'Noe gikk galt' }), `${path}: error boundary`).toHaveCount(0);
    if (!path.endsWith('not-built-yet')) await expect.soft(page.getByRole('heading', { name: 'Siden finnes ikke' }), `${path}: 404`).toHaveCount(0);
    await expect.soft(page.locator('body'), `${path}: blank page`).not.toHaveText(/^s*$/);
    await page.waitForTimeout(300); // let late effects (second fetch, socket) settle
    const relevant = fallback === 'down' ? errors.filter((e) => e.startsWith('pageerror')) : errors;
    expect.soft(relevant, `errors on ${path}`).toEqual([]);
  }
}

const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

// Public and signed-in user pages: unknown API calls answer with an empty success.
for (const [group, as, paths] of [['anonymous', null, anon], ['user', 'user', user]]) {
  chunks(paths, 12).forEach((part, i) => {
    test(`${group} pages render (${i + 1}): ${part[0]} …`, ({ page }) => sweep(page, part, as));
  });
}

// Admin and developer screens read rich, page-specific objects; an empty answer is not a
// shape the backend sends, so they are swept with the API down instead: every page must
// show its own error state, never crash. (Happy paths: flows-*.spec.js, developer-console,
// redis-console.)
for (const [group, as, paths] of [['superAdmin', 'superAdmin', dashboard], ['developer', 'developer', developer]]) {
  chunks(paths, 12).forEach((part, i) => {
    test(`${group} pages survive the API being down (${i + 1}): ${part[0]} …`, ({ page }) => sweep(page, part, as, 'down'));
  });
}

test.describe('redirects and guards', () => {
  for (const [path, as, target] of redirects) {
    test(`${path} as ${as || 'anonymous'}`, async ({ page }) => {
      // Developer screens are checked with the API down (see above), so these are too.
      const down = /developer/.test(String(target));
      const errors = await visit(page, path, as, down ? 'down' : 'empty');
      await expect(page).toHaveURL(target);
      await expect(page.getByRole('heading', { name: 'Noe gikk galt' })).toHaveCount(0);
      expect(down ? errors.filter((e) => e.startsWith('pageerror')) : errors).toEqual([]);
    });
  }
});

test('an unknown URL shows the 404 page', async ({ page }) => {
  const errors = await visit(page, '/this-page-does-not-exist', null);
  await expect(page.getByRole('heading', { name: 'Siden finnes ikke' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('an unknown dashboard URL shows the 404 page inside the dashboard', async ({ page }) => {
  const errors = await visit(page, '/dashboard/nope', 'superAdmin');
  await expect(page.getByRole('heading', { name: 'Siden finnes ikke' })).toBeVisible();
  expect(errors).toEqual([]);
});

// BUG: CompletedJobPage runs navigate(-1) when the URL has no order id. On a cold deep link
// (new tab, pasted URL) that leaves the site entirely (about:blank / the previous site)
// instead of showing "Fant ikke oppdraget" with a way forward.
test('/completed-job without an id stays in the app', async ({ page }) => {
  const errors = await visit(page, '/completed-job', 'user');
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\//);
  await expect(page.getByText('Fant ikke oppdraget')).toBeVisible();
  expect(errors).toEqual([]);
});
