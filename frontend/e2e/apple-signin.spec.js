import { test } from '@playwright/test';
import { API, expect, mockApi } from './helpers/app.js';

/**
 * "Fortsett med Apple" on the website: hidden unless the build sets VITE_APPLE_SIGNIN_ENABLED=true
 * (the server on 5177 does, see playwright.config.js), and it starts GET /api/auth/web/apple.
 */

test.describe.configure({ timeout: 120_000 });

for (const path of ['/login', '/register']) {
  test(`${path}: Apple button hidden by default`, async ({ page }) => {
    await mockApi(page);
    await page.goto(path);
    await expect(page.getByRole('button', { name: 'Fortsett med Google' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fortsett med Apple' })).toHaveCount(0);
  });

  test.describe(`${path} with VITE_APPLE_SIGNIN_ENABLED=true`, () => {
    test.use({ baseURL: 'http://127.0.0.1:5177' });

    test('shows the Apple button, which starts the web flow on the API', async ({ page }) => {
      await mockApi(page, {
        routes: { 'GET /api/auth/web/apple': () => ({ status: 200, json: { started: true } }) },
      });
      await page.goto(path);
      const apple = page.getByRole('button', { name: 'Fortsett med Apple' });
      await expect(apple).toBeVisible();
      const started = page.waitForRequest(`${API}/api/auth/web/apple`);
      await apple.click();
      expect((await started).isNavigationRequest()).toBe(true);
    });
  });
}
