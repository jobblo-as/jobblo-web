import { test } from '@playwright/test';
import { SERVICE, expect, mockApi, shot, watchErrors } from './helpers/app.js';

/**
 * A job without its own photo gets a text card (category colour, icon, title, description)
 * instead of a stock photo, and the hero hides small job/user counts behind the SafePay line.
 */

const NO_PHOTO = {
  ...SERVICE,
  _id: '64b0000000000000000000a1',
  title: 'TEST Klippe plenen',
  categories: ['Hagearbeid'],
};
const WITH_PHOTO = {
  ...SERVICE,
  _id: '64b0000000000000000000a2',
  title: 'TEST Bære sofa',
  categories: ['Flytting'],
  images: ['https://images.example.test/sofa.jpg'],
};

const listing = (data) => ({
  data,
  pagination: { total: data.length, totalPages: 1, page: 1, limit: 16 },
});

const routes = (jobs) => ({
  'GET /api/services': () => listing([NO_PHOTO, WITH_PHOTO]),
  'GET /api/public/stats': () => ({ jobs, users: 40 }),
  'GET /api/categories': () => [
    { _id: '64c000000000000000000001', name: 'Hagearbeid', icon: 'Flower2', sortOrder: 0 },
    { _id: '64c000000000000000000002', name: 'Flytting', icon: 'Truck', sortOrder: 1 },
  ],
});

test('a job without a photo is a text card, never a stock photo', async ({ page }) => {
  const errors = watchErrors(page);
  await mockApi(page, { routes: routes(12) });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/search');

  const textCard = page.getByRole('link', { name: NO_PHOTO.title });
  await expect(textCard).toBeVisible();
  await expect(textCard.locator('img')).toHaveCount(0);
  await expect(textCard.getByText(NO_PHOTO.description)).toBeVisible();

  const photoCard = page.getByRole('link', { name: WITH_PHOTO.title });
  await expect(photoCard.locator('img')).toHaveAttribute('src', WITH_PHOTO.images[0]);

  // Same frame size, so the grid stays aligned.
  const frame = (card) => card.locator('div.aspect-4\\/5').boundingBox();
  const [a, b] = await Promise.all([frame(textCard), frame(photoCard)]);
  expect(Math.round(a.height)).toBe(Math.round(b.height));
  expect(Math.round(a.width)).toBe(Math.round(b.width));

  await shot(page, 'jobs-without-photos-search');
  expect(errors.filter((e) => !e.includes('images.example.test'))).toEqual([]);
});

test('landing: no stock photo, and small counts are replaced by SafePay', async ({ page }) => {
  await mockApi(page, { routes: routes(12) });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');

  await expect(page.getByText('Trygg betaling med SafePay').first()).toBeVisible();
  await expect(page.getByText(/aktive oppdrag ·/)).toHaveCount(0);

  const landingCard = page.getByRole('button', { name: new RegExp(NO_PHOTO.title) });
  await expect(landingCard).toBeVisible();
  await expect(landingCard.locator('img')).toHaveCount(0);
  await shot(page, 'jobs-without-photos-landing');
});

test('landing: the counts come back from 100 active jobs', async ({ page }) => {
  await mockApi(page, { routes: routes(150) });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');

  await expect(page.getByText('150 aktive oppdrag · 40 brukere')).toBeVisible();
});

test('job page: a job without a photo shows its category, not a stock photo', async ({ page }) => {
  await mockApi(page, {
    routes: {
      ...routes(12),
      [`GET /api/services/${NO_PHOTO._id}`]: () => NO_PHOTO,
    },
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`/job-listing/${NO_PHOTO._id}`);

  await expect(page.getByRole('heading', { name: NO_PHOTO.title }).first()).toBeVisible();
  await expect(page.getByText('Hagearbeid', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Illustrasjonsbilde')).toHaveCount(0);
  // No bundled category photo anywhere on the page.
  await expect(page.locator('img[src*="hagearbeid"]')).toHaveCount(0);
  await shot(page, 'jobs-without-photos-detail');
});

test('grid/list toggle beside "Nyeste først": text first, remembered', async ({ page }) => {
  const errors = watchErrors(page);
  await mockApi(page, { routes: routes(12) });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/search');

  const grid = page.getByRole('button', { name: 'Vis som rutenett' });
  const list = page.getByRole('button', { name: 'Vis som liste' });
  await expect(grid).toHaveAttribute('aria-pressed', 'true');
  await list.click();
  await expect(list).toHaveAttribute('aria-pressed', 'true');

  // A row per job: a link with title, description and price; photo only as a thumbnail.
  const row = page.getByRole('link', { name: new RegExp(NO_PHOTO.title) });
  await expect(row).toBeVisible();
  await expect(row.getByText(NO_PHOTO.description)).toBeVisible();
  await expect(row.getByText('3 000 kr')).toBeVisible();
  await expect(row.locator('img')).toHaveCount(0);
  const photoRow = page.getByRole('link', { name: new RegExp(WITH_PHOTO.title) });
  await expect(photoRow.locator('img')).toHaveAttribute('src', WITH_PHOTO.images[0]);
  await shot(page, 'jobs-list-view');

  // Remembered in this browser.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Vis som liste' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/job-listing/${NO_PHOTO._id}$`));
  expect(errors.filter((e) => !e.includes('images.example.test'))).toEqual([]);
});

test('list view on a phone: no sideways scroll', async ({ page }) => {
  await mockApi(page, { routes: routes(12) });
  await page.addInitScript(() => localStorage.setItem('jobblo-listing-view', 'list'));
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/search');
  await expect(page.getByRole('link', { name: new RegExp(NO_PHOTO.title) })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, 'jobs-list-view-phone');
});
