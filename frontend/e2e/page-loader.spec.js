import { test } from '@playwright/test';
import { expect, mockApi, shot } from './helpers/app.js';

/**
 * One loader everywhere, the sprout one: the session check and the dashboards' lazy load
 * showed a plain "Laster …" line first, then the sprout. A watcher records any loader
 * shown without the sprout while the page loads.
 */
for (const [path, as] of [
  ['/alerts', 'user'],
  ['/dashboard', 'superAdmin'],
  ['/developer/queues', 'developer'],
]) {
  test(`${path}: no plain text loader, only the sprout`, async ({ page }) => {
    await mockApi(page, {
      as,
      routes: {
        'POST /api/auth/refresh-token': async () => {
          await new Promise((r) => setTimeout(r, 1500));
          return { accessToken: 'at-1' };
        },
      },
    });
    await page.addInitScript(() => {
      window.__plainLoader = false;
      new MutationObserver(() => {
        for (const el of document.querySelectorAll('[role="status"]'))
          if (/Laster/.test(el.textContent || '') && !el.querySelector('svg'))
            window.__plainLoader = true;
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto(path);
    if (path === '/alerts') {
      // The sprout, once the intro has played (stem, then the leaves).
      await page.waitForTimeout(1000);
      await shot(page, 'page-loader');
    }
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => window.__plainLoader)).toBe(false);
  });
}
