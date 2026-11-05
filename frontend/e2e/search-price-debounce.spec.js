import { test } from '@playwright/test';
import { expect, mockApi } from './helpers/app.js';

/** Typing a price, or dragging the slider, asks the API once when it stops — not per key. */
test('price filter waits until typing stops, then sends one request', async ({ page }) => {
  const { calls } = await mockApi(page, {
    as: 'user',
    routes: { 'GET /api/services': () => ({ data: [], pagination: { total: 0 } }) },
  });
  const priced = () =>
    calls.filter((c) => c.pathname === '/api/services' && c.search.includes('minPrice=4'));

  await page.goto('/search/job/all');
  await expect(page.getByRole('heading', { name: 'Ingen oppdrag ute akkurat nå' })).toBeVisible();

  const from = page.getByLabel('Fra');
  await from.fill('');
  await from.pressSequentially('4343', { delay: 150 });
  await page.waitForTimeout(1200); // still inside the 2.5 s window
  expect(priced()).toEqual([]);
  // The wait is visible: the results show the loading state, not the old list.
  await expect(page.getByText('Henter oppdrag…')).toBeVisible();

  await expect.poll(() => priced().length, { timeout: 6000 }).toBe(1);
  expect(priced()[0].search).toContain('minPrice=4343&');

  // A slip of the keyboard is capped, not sent as 434343434343434350000.
  await from.fill('434343434343434');
  await expect(from).toHaveValue('10000000');
});

test('a filter tap waits too, shows loading, then sends one request', async ({ page }) => {
  const { calls } = await mockApi(page, {
    as: 'user',
    routes: { 'GET /api/services': () => ({ data: [], pagination: { total: 0 } }) },
  });
  const urgent = () =>
    calls.filter((c) => c.pathname === '/api/services' && c.search.includes('urgent=true'));

  await page.goto('/search/job/all');
  await expect(page.getByRole('heading', { name: 'Ingen oppdrag ute akkurat nå' })).toBeVisible();

  await page
    .locator('aside')
    .getByRole('switch', { name: /Vis kun hasteoppdrag/ })
    .click();
  await expect(page.getByText('Henter oppdrag…')).toBeVisible();
  await page.waitForTimeout(1200);
  expect(urgent()).toEqual([]);

  await expect.poll(() => urgent().length, { timeout: 6000 }).toBe(1);
  await expect(page.getByRole('heading', { name: 'Ingen oppdrag funnet' })).toBeVisible();
});
