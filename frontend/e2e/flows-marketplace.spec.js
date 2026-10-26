import { test } from '@playwright/test';
import { expect, mockApi, watchErrors, SERVICE } from './helpers/app.js';

/** Search/filter, view a listing, save it, apply to it, and edit/publish a job, on a mocked API. */

test.describe.configure({ timeout: 120_000 });

const OTHER = { ...SERVICE, _id: '64b000000000000000000002', title: 'TEST Flytte sofa', categories: ['Flytting'], urgent: true };
const page1 = (data) => ({ data, pagination: { total: data.length, totalPages: 1, page: 1, limit: 16 } });

test('search and the urgent filter go to the API and narrow the list', async ({ page }) => {
  const errors = watchErrors(page);
  const { calls } = await mockApi(page, {
    routes: {
      'GET /api/services': ({ url }) => {
        const q = url.searchParams;
        let list = [SERVICE, OTHER];
        if (q.get('search')) list = list.filter((s) => s.title.toLowerCase().includes(q.get('search').toLowerCase()));
        if (q.get('urgent') === 'true') list = list.filter((s) => s.urgent);
        return page1(list);
      },
    },
  });
  await page.setViewportSize({ width: 1400, height: 900 }); // filter sidebar is visible on desktop
  await page.goto('/search');
  await expect(page.getByText(SERVICE.title).first()).toBeVisible();
  await expect(page.getByText(OTHER.title).first()).toBeVisible();

  await page.getByLabel('Søk etter oppdrag').fill('male');
  await page.getByRole('button', { name: 'Søk', exact: true }).click();
  await expect(page).toHaveURL(/search=male/);
  await expect(page.getByText(OTHER.title)).toHaveCount(0);
  await expect(page.getByText(SERVICE.title).first()).toBeVisible();
  expect(calls.some((c) => c.pathname === '/api/services' && /search=male/.test(c.search))).toBe(true);

  await page.getByLabel('Tøm søket').click();
  await page.getByRole('switch', { name: /Haster/ }).first().click();
  await expect.poll(() => calls.some((c) => c.pathname === '/api/services' && /urgent=true/.test(c.search))).toBe(true);
  await expect(page.getByText(SERVICE.title)).toHaveCount(0);
  await expect(page.getByText(OTHER.title).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('a listing opens from the search results', async ({ page }) => {
  const errors = watchErrors(page);
  await mockApi(page, {
    routes: {
      'GET /api/services': () => page1([SERVICE]),
      [`GET /api/services/${SERVICE._id}`]: () => SERVICE,
    },
  });
  await page.goto('/search');
  await page.getByText(SERVICE.title).first().click();
  await expect(page).toHaveURL(new RegExp(`/job-listing/${SERVICE._id}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(SERVICE.title);
  await expect(page.getByText(SERVICE.description).first()).toBeVisible();
  expect(errors).toEqual([]);
});

function jobRoutes(extra = {}) {
  return {
    [`GET /api/services/${SERVICE._id}`]: () => SERVICE,
    'GET /api/connect/status': () => ({ payoutReady: true }),
    'GET /api/stripe/v2/entitlements': () => ({ includedContacts: 5, consumedIncludedContacts: 0, remainingIncludedContacts: 5 }),
    'GET /api/config/FREE_PRIVATE_JOBS_UNDER_10000': () => ({ value: false }),
    ...extra,
  };
}

test('a provider applies to a job with a message', async ({ page }) => {
  const errors = watchErrors(page);
  const { calls } = await mockApi(page, {
    as: 'provider',
    routes: jobRoutes({ 'POST /api/orders/request': ({ body }) => ({ _id: 'req-1', serviceId: body.serviceId, status: 'pending' }) }),
  });
  await page.goto(`/job-listing/${SERVICE._id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(SERVICE.title);
  await page.getByRole('button', { name: 'Send forespørsel', exact: true }).first().click();
  await page.getByPlaceholder('Skriv en melding til leverandøren...').fill('Hei, jeg kan gjøre dette på lørdag.');
  await page.getByRole('button', { name: 'Send forespørsel', exact: true }).last().click();
  await expect(page.getByText('Forespørsel sendt! Venter på godkjenning.')).toBeVisible();
  expect(calls.find((c) => c.pathname === '/api/orders/request').body).toMatchObject({ serviceId: SERVICE._id, message: 'Hei, jeg kan gjøre dette på lørdag.' });
  expect(errors).toEqual([]);
});

test('the owner of a job cannot apply to it', async ({ page }) => {
  await mockApi(page, { as: 'user', routes: jobRoutes() });
  await page.goto(`/job-listing/${SERVICE._id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(SERVICE.title);
  await expect(page.getByRole('button', { name: 'Send forespørsel', exact: true })).toHaveCount(0);
});

test('a visitor who applies is sent to log in', async ({ page }) => {
  await mockApi(page, { routes: jobRoutes() });
  await page.goto(`/job-listing/${SERVICE._id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(SERVICE.title);
  await page.getByRole('button', { name: 'Send forespørsel', exact: true }).first().click();
  await expect(page).toHaveURL(/\/login$/);
});

test('saving a listing, then browsing favourite lists', async ({ page }) => {
  const errors = watchErrors(page);
  const saved = new Set();
  const list = { _id: 'list-1', name: 'Oppussing', services: [SERVICE], userId: '64a000000000000000000002', createdAt: '2026-10-20T10:00:00.000Z' };
  const { calls } = await mockApi(page, {
    as: 'provider',
    routes: jobRoutes({
      '~POST ^/api/favorites/': ({ url }) => { saved.add(url.pathname.split('/').pop()); return { success: true }; },
      '~DELETE ^/api/favorites/': ({ url }) => { saved.delete(url.pathname.split('/').pop()); return { success: true }; },
      'GET /api/lists': () => [list],
      'GET /api/lists/list-1': () => list,
      'GET /api/favorites': () => ({ favorites: [...saved].map((id) => ({ _id: `fav-${id}`, service: { ...SERVICE, _id: id } })) }),
    }),
  });
  await page.goto(`/job-listing/${SERVICE._id}`);
  await page.getByRole('button', { name: 'Lagre oppdraget' }).click();
  await expect(page.getByRole('button', { name: 'Fjern fra lagrede' })).toBeVisible();
  expect(calls.some((c) => c.method === 'POST' && c.pathname === `/api/favorites/${SERVICE._id}`)).toBe(true);
  await page.goto('/favorites');
  await page.getByText('Oppussing').first().click();
  await expect(page).toHaveURL(/\/favorites\/list\/list-1$/);
  await expect(page.getByText(SERVICE.title).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('publish a job: step 1 validates, a complete draft (edit mode) is saved', async ({ page }) => {
  const errors = watchErrors(page);
  const full = {
    ...SERVICE, countyCode: '03', municipalityCode: '0301', images: ['https://example.test/a.jpg'],
    fromDate: '2026-11-01', toDate: '2026-11-02', duration: { value: 2, unit: 'hours' },
  };
  const { calls } = await mockApi(page, {
    as: 'user',
    routes: {
      [`GET /api/services/${SERVICE._id}`]: () => full,
      [`PUT /api/services/${SERVICE._id}`]: () => full,
    },
  });
  // New job: nothing filled in, "next" names what is missing and does not advance.
  await page.goto('/Publish-job');
  await expect(page.getByRole('heading', { name: 'Legg ut et oppdrag' })).toBeVisible();
  await page.getByRole('button', { name: /Neste/ }).first().click();
  await expect(page.getByText('Vennligst last opp minst ett bilde.')).toBeVisible();

  // Edit: the stored job is loaded and saved back.
  await page.goto(`/Publish-job/${SERVICE._id}`);
  await expect(page.getByRole('heading', { name: 'Rediger oppdraget' })).toBeVisible();
  await expect(page.locator(`input[value="${SERVICE.title}"]`)).toHaveCount(1);
  expect(calls.some((c) => c.pathname === `/api/services/${SERVICE._id}` && c.method === 'GET')).toBe(true);
  expect(errors).toEqual([]);
});

// BUG (a11y): OrderRequestModal (components/job/OrderRequestModal.tsx) has no role="dialog" /
// aria-modal / accessible name, and its close "X" button (line ~49) has no label.
test('the apply modal is an accessible dialog with a labelled close button', async ({ page }) => {
  await mockApi(page, { as: 'provider', routes: jobRoutes() });
  await page.goto(`/job-listing/${SERVICE._id}`);
  await page.getByRole('button', { name: 'Send forespørsel', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Send forespørsel' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Lukk/ })).toBeVisible();
});
