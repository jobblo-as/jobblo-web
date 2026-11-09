import { test } from '@playwright/test';
import { expect, mockApi, shot, watchErrors } from './helpers/app.js';

/** Vedlikeholdsmodus: one area off disables only its button; the whole site off shows the screen. */
test.describe.configure({ timeout: 120_000 });

const status = (over) => ({
  'GET /api/maintenance': () => ({
    success: true,
    data: { enabled: false, message: '', areas: [], ...over },
  }),
});

test('admin switches Google sign-in off; only that button is disabled', async ({ page }) => {
  const errors = watchErrors(page);
  let saved = null;
  await mockApi(page, {
    as: 'superAdmin',
    routes: {
      'GET /api/admin/maintenance': () => ({
        success: true,
        data: {
          maintenanceMode: { enabled: false, message: '', areas: {} },
          areas: [
            { key: 'payments', label: 'Betalinger (Stripe)', writesOnly: true },
            { key: 'login_google', label: 'Google-innlogging', writesOnly: false },
          ],
          defaultMessage: 'Vi utfører vedlikehold. Prøv igjen om litt.',
        },
      }),
      'PUT /api/admin/maintenance': ({ body }) => ((saved = body), { success: true, data: body }),
    },
  });
  await page.goto('/dashboard/maintenance');
  await page.getByRole('switch', { name: 'Steng Google-innlogging' }).click();
  await page.getByLabel('Melding for Google-innlogging').fill('Google er nede, bruk Vipps.');
  await shot(page, 'maintenance-admin');
  await page.getByRole('button', { name: 'Lagre' }).click();
  await expect
    .poll(() => saved)
    .toEqual({
      enabled: false,
      message: '',
      areas: { login_google: { enabled: true, message: 'Google er nede, bruk Vipps.' } },
    });
  expect(errors).toEqual([]);
});

test('login: Google off is disabled with its message, Vipps still works', async ({ page }) => {
  await mockApi(page, {
    routes: status({
      areas: [
        { key: 'login_google', label: 'Google-innlogging', message: 'Google er nede, bruk Vipps.' },
      ],
    }),
  });
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Fortsett med Google' })).toBeDisabled();
  await expect(page.getByText('Google er nede, bruk Vipps.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Fortsett med/ }).first()).toBeEnabled(); // Vipps
  await shot(page, 'maintenance-login');
});

test('whole site off: users see the message, sign-in stays open', async ({ page }) => {
  await mockApi(page, { routes: status({ enabled: true, message: 'Oppgradering til kl 14.' }) });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Vedlikehold' })).toBeVisible();
  await expect(page.getByText('Oppgradering til kl 14.')).toBeVisible();
  await shot(page, 'maintenance-site');
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Fortsett med Google' })).toBeEnabled();
});

test('whole site off: a Super Admin still sees the site', async ({ page }) => {
  await mockApi(page, {
    as: 'superAdmin',
    routes: status({ enabled: true, message: 'Oppgradering til kl 14.' }),
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Vedlikehold' })).toHaveCount(0);
});
