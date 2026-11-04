import { test } from '@playwright/test';
import { expect, mockApi, shot } from './helpers/app.js';

/** Empty pages (/home feed, /search, /my-applicants, /alerts, /messages), and a failed jobs request. */

test('no jobs: a clear empty state that leads to posting one', async ({ page }) => {
  await mockApi(page, {
    as: 'user',
    routes: { 'GET /api/services': () => ({ data: [], pagination: { total: 0 } }) },
  });
  await page.goto('/home');
  await expect(
    page.getByRole('heading', { name: 'Ingen oppdrag å vise akkurat nå' })
  ).toBeVisible();
  await shot(page, 'home-feed-empty');
  await page.getByRole('button', { name: 'Legg ut oppdrag' }).last().click();
  await expect(page).toHaveURL(/\/Publish-job$/);
});

test('jobs request fails: an error, with a retry that loads again', async ({ page }) => {
  let fail = true;
  await mockApi(page, {
    as: 'user',
    routes: {
      'GET /api/services': () =>
        fail ? { status: 500, json: { error: 'down' } } : { data: [], pagination: { total: 0 } },
    },
  });
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Kunne ikke laste oppdrag' })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Prøv igjen' }).click();
  await expect(
    page.getByRole('heading', { name: 'Ingen oppdrag å vise akkurat nå' })
  ).toBeVisible();
});

test('search page with no jobs: the same empty state, and posting from it', async ({ page }) => {
  await mockApi(page, {
    as: 'user',
    routes: { 'GET /api/services': () => ({ data: [], pagination: { total: 0 } }) },
  });
  await page.goto('/search/job/all');
  await expect(page.getByRole('heading', { name: 'Ingen oppdrag ute akkurat nå' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nullstill filtre' })).toHaveCount(0);
  await shot(page, 'search-empty');

  // With a search word it says "nothing found" instead.
  await page.goto('/search/job/all?search=piano');
  await expect(page.getByRole('heading', { name: 'Ingen oppdrag funnet' })).toBeVisible();
  await page.getByRole('button', { name: 'Legg ut oppdrag' }).last().click();
  await expect(page).toHaveURL(/\/Publish-job$/);
});

test('my applicants, both tabs empty: the same empty state with the next step', async ({
  page,
}) => {
  await mockApi(page, { as: 'user' });
  await page.goto('/my-applicants');
  await expect(page.getByRole('heading', { name: 'Ingen søkere ennå' })).toBeVisible();
  await shot(page, 'my-applicants-empty');

  await page.getByRole('tab', { name: /Mine søknader/ }).click();
  await expect(page.getByRole('heading', { name: 'Du har ikke søkt på noe ennå' })).toBeVisible();
  await shot(page, 'my-applications-empty');
  await page.getByRole('button', { name: 'Utforsk oppdrag' }).click();
  await expect(page).toHaveURL(/\/home$/);
});

test('notifications, none yet: a clear empty page, and the filter one resets', async ({ page }) => {
  await mockApi(page, {
    as: 'user',
    routes: { 'GET /api/notifications/unread-count': () => ({ count: 0 }) },
  });
  await page.goto('/alerts');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ingen varsler ennå');
  await expect(page.getByRole('heading', { name: 'Her dukker varslene dine opp' })).toBeVisible();
  await shot(page, 'alerts-empty');

  await page.getByRole('button', { name: 'Kun uleste' }).click();
  await expect(page.getByText('Ingen treff')).toBeVisible();
  await page.getByRole('button', { name: 'Nullstill filtre' }).click();
  await expect(page.getByRole('heading', { name: 'Her dukker varslene dine opp' })).toBeVisible();

  await page.getByRole('button', { name: 'Finn oppdrag' }).click();
  await expect(page).toHaveURL(/\/search\/job\/all$/);
});

test('messages, no chats yet: both panes explain themselves', async ({ page }) => {
  await mockApi(page, { as: 'user' });
  await page.goto('/messages');
  await expect(page.getByText('Ingen samtaler ennå')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Velg en samtale' })).toBeVisible();
  await shot(page, 'messages-empty');
  await page.getByRole('button', { name: 'Finn oppdrag' }).click();
  await expect(page).toHaveURL(/\/search\/job\/all$/);
});
