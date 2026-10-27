import { expect as baseExpect, test } from '@playwright/test';

// The lazy developer-console chunk can take a minute to compile on a busy dev server.
const expect = baseExpect.configure({ timeout: 60_000 });
test.setTimeout(120_000);

/** M8 web bugs: logout clears the query cache, one profile fetch per load, linked form labels. */

const API = 'http://127.0.0.1:5017';
const DEV = { _id: 'dev-1', name: 'TEST Developer', email: 'dev@example.test', role: 'developer' };
const USER = { _id: 'user-1', name: 'TEST User', email: 'user@example.test', role: 'user' };

async function mockApi(page, me) {
  const calls = [];
  await page.route(`${API}/api/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    calls.push(pathname);
    const ok = (data) => route.fulfill({ json: { success: true, data } });
    if (pathname === '/api/auth/refresh-token')
      return route.fulfill({ json: { accessToken: 'at' } });
    if (pathname === '/api/auth/profile') return route.fulfill({ json: me });
    if (pathname === '/api/auth/mfa')
      return route.fulfill({ json: { required: true, enabled: true, verified: true } });
    if (pathname === '/api/auth/logout') return route.fulfill({ json: { ok: true } });
    if (pathname === '/api/developer/me') {
      return ok({
        ...me,
        environment: 'test',
        access: 'readonly',
        can: { triage: true, request: false, execute: false, approve: false },
      });
    }
    if (pathname.startsWith('/api/categories')) return route.fulfill({ json: [] });
    // Console pages render their error state rather than crash on an empty payload.
    if (pathname.startsWith('/api/developer/'))
      return route.fulfill({ status: 500, json: { message: 'mock' } });
    return ok({});
  });
  return calls;
}

const devQueries = (page) =>
  page.evaluate(
    () =>
      window.__jobbloQueryClient
        ?.getQueryCache()
        .getAll()
        .filter((q) => q.queryKey[0] === 'dev').length ?? 0
  );

test('signing out from the developer menu clears the previous user’s cached data', async ({
  page,
}) => {
  await mockApi(page, DEV);
  await page.goto('/developer');
  await expect.poll(() => devQueries(page)).toBeGreaterThan(0);

  await page.getByRole('button', { name: /TEST Developer/ }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(await devQueries(page)).toBe(0);
});

test('a forced logout (expired / revoked session) clears the query cache too', async ({ page }) => {
  await mockApi(page, DEV);
  await page.goto('/developer');
  await expect.poll(() => devQueries(page)).toBeGreaterThan(0);
  // What lib/axios.ts calls on SESSION_REVOKED or a failed refresh.
  await page.evaluate(() => window.__jobbloUserStore.getState().logout());
  expect(await devQueries(page)).toBe(0);
});

test('the profile is fetched once per signed-in page load', async ({ page }) => {
  const calls = await mockApi(page, USER);
  await page.goto('/Publish-job');
  await expect(page.getByLabel(/Tittel/)).toBeVisible();
  await page.waitForTimeout(1000);
  expect(calls.filter((p) => p === '/api/auth/profile')).toHaveLength(1);
});

test('create-job labels point at their inputs', async ({ page }) => {
  await mockApi(page, USER);
  await page.goto('/Publish-job');
  const title = page.getByLabel(/Tittel/);
  await expect(title).toHaveAttribute('id', 'job-title');
  await title.fill('Male en bod');
  await expect(page.getByLabel(/Beskrivelse/)).toHaveAttribute('id', 'job-description');
});

test('account deletion sends the current password and explains REAUTH_REQUIRED', async ({
  page,
}) => {
  await mockApi(page, USER);
  const bodies = [];
  await page.route(`${API}/api/users/user-1`, (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    bodies.push(route.request().postDataJSON());
    return route.fulfill({
      status: 403,
      json: { code: 'REAUTH_REQUIRED', error: 'Logg inn på nytt for å slette kontoen.' },
    });
  });
  await page.addInitScript(() => localStorage.setItem('cookie-consent', 'rejected')); // banner covers the button
  await page.goto('/settings/delete-account');
  await page.getByLabel('Nåværende passord').fill('hunter22');
  await page.getByLabel(/for å bekrefte/).fill('SLETT');
  await page.getByRole('button', { name: 'Slett profilen min' }).last().click(); // the first is the settings nav item
  await expect(page.getByText('Logg inn på nytt og prøv igjen.')).toBeVisible();
  expect(bodies).toEqual([{ currentPassword: 'hunter22' }]);
});

test('MFA: a failed status load offers "Try again" and a correct code then lets the developer in', async ({
  page,
}) => {
  await mockApi(page, DEV);
  let up = false; // the status endpoint fails until the test clicks "Try again"
  await page.route(`${API}/api/auth/mfa`, (route) => {
    if (!up) return route.fulfill({ status: 500, json: { message: 'Status unavailable' } });
    return route.fulfill({ json: { required: true, enabled: true, verified: false } });
  });
  await page.route(`${API}/api/auth/mfa/verify`, (route) => route.fulfill({ json: { ok: true } }));
  await page.goto('/mfa?next=/developer');
  await expect(page.getByRole('alert')).toHaveText('Status unavailable');
  up = true;
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByLabel('Authenticator code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/developer$/);
});

test('coins: redeeming is one request, disabled while pending, with a success toast', async ({
  page,
}) => {
  await mockApi(page, { ...USER, pointsBalance: 500 });
  let buys = 0;
  await page.route(`${API}/api/jobbloShop/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/all'))
      return route.fulfill({
        json: [{ _id: 1, title: 'Gavekort', description: 'x', coins: 100, category: 'Gave' }],
      });
    buys += 1;
    await new Promise((r) => setTimeout(r, 1000));
    return route.fulfill({ json: { ok: true } });
  });
  await page.addInitScript(() => localStorage.setItem('cookie-consent', 'rejected'));
  await page.goto('/coins');
  const redeem = page.getByRole('button', { name: 'Løs inn' });
  await redeem.click();
  await expect(redeem).toBeDisabled();
  await redeem.click({ force: true });
  await expect(page.getByText('Belønningen er løst inn!')).toBeVisible();
  expect(buys).toBe(1);
});

test('subscription success waits for the session: signed out goes to /login, no API call first', async ({
  page,
}) => {
  const calls = [];
  await page.route(`${API}/api/**`, (route) => {
    const { pathname } = new URL(route.request().url());
    calls.push(pathname);
    if (pathname === '/api/auth/refresh-token')
      return route.fulfill({ status: 401, json: { message: 'no session' } });
    return route.fulfill({ json: { success: true, data: {} } });
  });
  await page.goto('/subscription/success?session_id=cs_test_1');
  await expect(page).toHaveURL(/\/login/);
  expect(calls.filter((p) => p.includes('subscription') || p.includes('checkout'))).toEqual([]);
});

// The create-job draft (utils/indexedDB.ts): address, phone, email and photos of a half-written job.
const idb = (page, op, record) =>
  page.evaluate(
    ([op, record]) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('jobblo-form-db', 1);
        open.onupgradeneeded = () =>
          open.result.createObjectStore('job-form-data', { keyPath: 'id' });
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const store = open.result
            .transaction(['job-form-data'], 'readwrite')
            .objectStore('job-form-data');
          const req = op === 'put' ? store.put(record) : store.count();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        };
      }),
    [op, record]
  );
const draft = (ownerId) => ({
  id: 'current-form',
  ownerId,
  data: { title: 'Forrige brukers jobb' },
  images: [],
  createdAt: Date.now(),
});

test('another user’s create-job draft is not shown', async ({ page }) => {
  await mockApi(page, USER);
  await page.goto('/cookies');
  await idb(page, 'put', draft('someone-else'));
  await page.goto('/Publish-job');
  await expect(page.getByLabel(/Tittel/)).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByLabel(/Tittel/)).toHaveValue('');
});

test('logout deletes the create-job draft', async ({ page }) => {
  await mockApi(page, USER);
  await page.goto('/Publish-job');
  await expect(page.getByLabel(/Tittel/)).toBeVisible();
  await idb(page, 'put', draft(USER._id));
  expect(await idb(page, 'count')).toBe(1);
  await page.evaluate(() => window.__jobbloUserStore.getState().logout());
  await expect.poll(() => idb(page, 'count')).toBe(0);
});
