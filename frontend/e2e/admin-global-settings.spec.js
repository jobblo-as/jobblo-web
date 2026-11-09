import { test } from '@playwright/test';
import { expect, mockApi, shot, watchErrors } from './helpers/app.js';

/** Super Admin → Globale innstillinger: create a feature flag, edit, delete (mocked API). */
test('create a feature flag, then delete a setting', async ({ page }) => {
  const errors = watchErrors(page);
  const entries = [
    {
      key: 'SAFEPAY_CONNECT_ONBOARDING_DEADLINE_DAYS',
      value: 3,
      description: null,
      updatedAt: null,
    },
    {
      key: 'homepage_banner',
      value: 'Velkommen',
      description: 'Tekst øverst',
      updatedAt: '2026-11-05T10:00:00.000Z',
    },
  ];
  const writes = [];
  await mockApi(page, {
    as: 'superAdmin',
    routes: {
      'GET /api/admin/config': () => ({
        success: true,
        data: { configs: Object.fromEntries(entries.map((e) => [e.key, e.value])), entries },
      }),
      'PUT /api/admin/config': ({ body }) => {
        writes.push(['PUT', body]);
        if (!entries.some((e) => e.key === body.key))
          entries.push({
            key: body.key,
            value: body.value,
            description: body.description ?? null,
            updatedAt: new Date().toISOString(),
          });
        return { success: true, data: { key: body.key, value: body.value } };
      },
      '~DELETE ^/api/admin/config/[^/]+$': ({ url }) => {
        const key = decodeURIComponent(url.pathname.split('/').pop());
        writes.push(['DELETE', key]);
        entries.splice(
          entries.findIndex((e) => e.key === key),
          1
        );
        return { success: true, data: { key } };
      },
    },
  });

  await page.goto('/dashboard/settings');
  await expect(page.getByRole('heading', { name: 'Globale innstillinger' })).toBeVisible();
  await expect(page.getByText('Tekst øverst')).toBeVisible(); // descriptions are shown now

  await page.getByRole('button', { name: 'Nytt flagg' }).click();
  const key = page.getByLabel('Nøkkel');
  await expect(key).toHaveValue('feature_');
  await key.fill('feature new'); // a space: refused before sending
  await expect(page.getByText('Bare bokstaver, tall og _ . -', { exact: false })).toBeVisible();
  await key.fill('feature_new_checkout');
  await page.getByLabel('Beskrivelse').fill('Naya checkout flow');
  await shot(page, 'admin-settings-new-flag');
  await page.getByRole('button', { name: 'Opprett' }).click();
  await expect
    .poll(() => writes.find((w) => w[0] === 'PUT')?.[1])
    .toEqual({
      key: 'feature_new_checkout',
      value: false,
      description: 'Naya checkout flow',
      create: true,
    });
  await expect(page.getByText('feature_new_checkout')).toBeVisible();
  await expect(page.getByText('Flagg').first()).toBeVisible();

  await page.getByRole('button', { name: 'Slett homepage_banner' }).click();
  await page.getByRole('button', { name: 'Slett', exact: true }).click();
  await expect.poll(() => writes.find((w) => w[0] === 'DELETE')?.[1]).toBe('homepage_banner');
  await expect(page.getByText('Tekst øverst')).toHaveCount(0);
  await shot(page, 'admin-settings');
  expect(errors).toEqual([]);
});
