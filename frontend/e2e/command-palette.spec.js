import { test } from '@playwright/test';
import { expect, mockApi, watchErrors } from './helpers/app.js';

/**
 * The ⌘K palette on both dashboards. CommandDialog rendered cmdk's Input/List without the
 * <Command> root that holds their store, so opening it crashed the page ("reading 'subscribe'").
 */
test('developer dashboard: the search palette opens, filters and navigates', async ({ page }) => {
  const errors = watchErrors(page);
  await mockApi(page, { as: 'developer' });
  await page.goto('/developer/queues');
  await page.getByText('Search or investigate…').click();
  const input = page.getByPlaceholder(/Search pages, or paste any ID/);
  await expect(input).toBeVisible();
  await input.fill('Tickets');
  await page
    .getByRole('option', { name: /Tickets/ })
    .filter({ hasNotText: /investigate/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/developer\/tickets/);
  await expect(page.getByRole('heading', { name: 'Noe gikk galt' })).toHaveCount(0);
  expect(errors.filter((e) => /subscribe/.test(e))).toEqual([]);
});

test('admin dashboard: the search palette opens without crashing', async ({ page }) => {
  await mockApi(page, { as: 'superAdmin' });
  await page.goto('/dashboard');
  await page.getByText('Søk etter sider…').first().click();
  await expect(page.getByPlaceholder('Søk etter sider…').last()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Noe gikk galt' })).toHaveCount(0);
});
