import { test } from '@playwright/test';
import { API, expect, mockApi, shot } from './helpers/app.js';

/**
 * The home hero's category chips are the backend's categories, in the admin's sortOrder,
 * and an admin edit shows on the home page in the same session (no 5-hour stale cache).
 */

test('home chips are every category from the real API, by sortOrder', async ({ page, request }) => {
  const res = await request.get(`${API}/api/categories`);
  expect(res.ok()).toBe(true);
  const categories = await res.json();
  test.skip(!categories.length, 'The local TEST database has no categories.');

  const orders = categories.map((c) => c.sortOrder ?? 0);
  expect(orders).toEqual([...orders].sort((a, b) => a - b));

  await page.goto('/');
  await page.getByRole('button', { name: 'Bare nødvendige' }).click(); // cookie banner
  const expected = categories.map((c) => c.name);
  for (const name of expected) {
    await expect(page.getByRole('button', { name, exact: true }).first()).toBeVisible();
    // The photo carousel comes round to every category too (one dot each).
    await expect(page.getByRole('button', { name: `Vis ${name}`, exact: true })).toBeVisible();
  }
  // "Neste" walks the arch through them in the same order.
  await page.getByRole('button', { name: 'Neste tjeneste' }).click();
  await expect(
    page.getByRole('button', { name: `Vis ${expected[1 % expected.length]}` })
  ).toHaveAttribute('aria-current', 'true');
  await shot(page, 'home-categories-real');
});

test('an admin reorder shows on the home page without a reload', async ({ page }) => {
  const names = [
    'Rengjøring',
    'Rørlegger',
    'Maling',
    'Flytting',
    'Hagearbeid',
    'Oppussing',
    'Transport',
  ];
  const cats = names.map((name, i) => ({
    _id: `64c00000000000000000000${i}`,
    name,
    icon: 'Tag',
    sortOrder: i,
    isActive: true,
  }));
  const sorted = () => [...cats].sort((a, b) => a.sortOrder - b.sortOrder);

  await mockApi(page, {
    as: 'superAdmin',
    routes: {
      'GET /api/categories': () => sorted(),
      'GET /api/admin/categories': () => ({
        success: true,
        data: { categories: sorted() },
        pagination: {
          page: 1,
          limit: 20,
          total: cats.length,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      }),
      '~PUT ^/api/admin/categories/[^/]+$': ({ url, body }) => {
        const cat = cats.find((c) => url.pathname.endsWith(c._id));
        Object.assign(cat, body);
        return { success: true, data: { category: cat } };
      },
    },
  });

  const spaGo = (path) =>
    page.evaluate((p) => {
      history.pushState({}, '', p);
      dispatchEvent(new PopStateEvent('popstate'));
    }, path);
  const firstChip = () => page.getByRole('button', { name: /^(Rengjøring|Transport)$/ }).first();

  await page.goto('/');
  await expect(firstChip()).toHaveText('Rengjøring');

  // Admin moves Transport to the top.
  await spaGo('/dashboard/categories');
  await page.getByRole('button', { name: 'Rediger Transport' }).click();
  await page.getByLabel('Sorteringsrekkefølge').fill('0');
  await page.getByLabel('Sorteringsrekkefølge').press('Tab');
  cats[0].sortOrder = 1; // Rengjøring after it (as the admin would set next)
  await page.getByRole('button', { name: 'Lagre' }).click();
  await expect(page.getByText('Kategori oppdatert.')).toBeVisible();

  await spaGo('/');
  await expect(firstChip()).toHaveText('Transport');
  await shot(page, 'home-categories-after-admin-edit');
});
