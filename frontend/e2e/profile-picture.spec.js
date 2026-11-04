import { test } from '@playwright/test';
import { USERS, expect, mockApi, shot } from './helpers/app.js';

/** Settings → Profilbilde: Norwegian, on-brand, and choosing a photo uploads it. */
test('choosing a profile photo uploads it as the avatar', async ({ page }) => {
  let uploaded = null;
  await mockApi(page, {
    as: 'user',
    routes: {
      [`PUT /api/users/${USERS.user._id}`]: ({ request }) => {
        uploaded = request.postData() || '';
        return { ...USERS.user, avatarUrl: 'https://example.test/a.png' };
      },
    },
  });
  await page.goto('/settings/picture');
  await expect(page.getByRole('heading', { name: 'Vis hvem du er' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ta bilde' })).toBeVisible();
  await shot(page, 'profile-picture');

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Velg bilde' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'me.png',
    mimeType: 'image/png',
    buffer: Buffer.from('89504e470d0a1a0a', 'hex'),
  });
  await expect.poll(() => uploaded).toContain('name="avatar"');
});
