import { test } from '@playwright/test';
import { expect, mockApi, shot, watchErrors } from './helpers/app.js';

/** Stripe-økonomihistorikk header controls (shadcn Select/Button); the user view keeps working. */
test.describe.configure({ timeout: 120_000 });

const empty = () => ({
  success: true,
  data: [],
  items: [],
  pagination: { page: 1, pages: 1, total: 0 },
});

test('admin: mode select, Oppdater and Synkroniser use the shadcn kit', async ({ page }) => {
  const errors = watchErrors(page);
  let reconcileBody = null;
  const { calls } = await mockApi(page, {
    as: 'superAdmin',
    routes: {
      '~GET ^/api/admin/safepay/finance/': empty,
      'POST /api/admin/safepay/finance/reconcile': ({ body }) => {
        reconcileBody = body;
        return { success: true, synchronizedAccounts: 0 };
      },
    },
  });
  await page.goto('/dashboard/finance-history');
  const mode = page.getByRole('combobox', { name: 'Stripe-modus' });
  await expect(mode).toHaveText(/Test \+ live/);
  await shot(page, 'finance-history-controls');

  await mode.click();
  await page.getByRole('option', { name: 'Live', exact: true }).click();
  await expect(mode).toHaveText('Live');
  await expect
    .poll(() =>
      calls.some(
        (c) =>
          c.pathname.startsWith('/api/admin/safepay/finance/') && c.search.includes('mode=live')
      )
    )
    .toBe(true);

  await page.getByRole('combobox', { name: 'Modus for avstemming' }).click();
  await page.getByRole('option', { name: 'Test', exact: true }).click();
  await page.getByRole('button', { name: 'Synkroniser' }).click();
  await expect.poll(() => reconcileBody?.mode).toBe('test');
  await page.getByRole('button', { name: 'Oppdater' }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'finance-history-controls-mobile');
  expect(errors).toEqual([]);
});

test('user settings: only Oppdater, no admin selects', async ({ page }) => {
  await mockApi(page, { as: 'user', routes: { '~GET ^/api/safepay/finance/': empty } });
  await page.goto('/settings/safepay');
  await expect(page.getByRole('button', { name: 'Oppdater' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Stripe-modus' })).toHaveCount(0);
  await shot(page, 'finance-history-user');
});

test('admin: the four controls stay on one line at laptop width', async ({ page }) => {
  await mockApi(page, {
    as: 'superAdmin',
    routes: {
      '~GET ^/api/admin/safepay/finance/': () => ({ success: true, data: [], items: [] }),
    },
  });
  for (const width of [1100, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/dashboard/finance-history');
    const top = async (el) => Math.round((await el.boundingBox()).y);
    const mode = page.getByRole('combobox', { name: 'Stripe-modus' });
    const sync = page.getByRole('button', { name: 'Synkroniser' });
    await expect(sync).toBeVisible();
    expect(await top(sync)).toBe(await top(mode));
    await shot(page, `finance-history-controls-${width}`);
  }
});

test('admin: filters, sync message and the table in the shadcn kit', async ({ page }) => {
  const errors = watchErrors(page);
  const row = {
    id: 'tr1',
    type: 'transfer',
    stripeTransferId: 'tr_3UYAaBCDEFGHIJKMRl4NO',
    orderId: '64a09f2f8e000000a09f2f8e',
    orderTitle: 'Rengjøring — omfang 3 rom',
    provider: { id: 'p1', name: 'Adr' },
    customer: { id: 'c1', name: 'Admin' },
    stripeAccountId: 'acct_1',
    amount: 145500,
    currency: 'nok',
    status: 'transferred',
    mode: 'test',
    stripeCreatedAt: '2026-11-05T00:28:18.000Z',
    jobbloFee: 4500,
  };
  const { calls } = await mockApi(page, {
    as: 'superAdmin',
    routes: {
      '~GET ^/api/admin/safepay/finance/transfers': () => ({
        items: [row],
        pagination: { page: 1, pages: 1, total: 1 },
      }),
      '~GET ^/api/admin/safepay/finance/': () => ({ success: true, data: [], items: [] }),
      'POST /api/admin/safepay/finance/reconcile': () => ({
        success: true,
        synchronizedAccounts: 2,
      }),
    },
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/dashboard/finance-history');
  const table = page.getByRole('table');
  await expect(table.getByText('Rengjøring — omfang 3 rom')).toBeVisible();
  await expect(table.getByText('1 455,00 kr')).toBeVisible();
  await expect(table.getByText('Kunde: Admin')).toBeVisible();

  await page.getByRole('button', { name: 'Synkroniser' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Avstemming fullført for 2' })
  ).toBeVisible();

  await page.getByPlaceholder('Søk etter ordre eller Stripe-ID').fill('a09f2f8e');
  await expect(page.getByText('Søk: a09f2f8e')).toBeVisible();
  await expect.poll(() => calls.some((c) => c.search.includes('a09f2f8e'))).toBe(true);
  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option').nth(1).click();
  await expect(page.getByText(/^Status: /)).toBeVisible();
  await shot(page, 'finance-history-table');

  await page.getByRole('button', { name: 'Nullstill filtre' }).first().click();
  await expect(page.getByText('Søk: a09f2f8e')).toHaveCount(0);
  expect(errors).toEqual([]);
});
