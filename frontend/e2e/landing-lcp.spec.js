import { test } from '@playwright/test';
import { expect, mockApi } from './helpers/app.js';

/**
 * Landing LCP: when the categories land, the arch keeps the photo already on screen (the same
 * <img>), instead of swapping it for another one — that swap was the page's LCP (~1.3 s late).
 */
test('the hero photo on screen is not replaced when the categories arrive', async ({ page }) => {
  const CATS = [
    'Rengjøring',
    'Rørlegger',
    'Maling',
    'Flytting',
    'Hagearbeid',
    'Oppussing',
    'Transport',
    'Småjobber',
    'Bil & Pleie',
  ].map((name, i) => ({ _id: `c${i}`, name, sortOrder: i, isActive: true }));
  await mockApi(page, {
    routes: {
      'GET /api/categories': async () => {
        await new Promise((r) => setTimeout(r, 800));
        return CATS;
      },
    },
  });
  await page.addInitScript(() => {
    window.__lcpImgs = [];
    new PerformanceObserver((l) =>
      l.getEntries().forEach((e) => e.url && window.__lcpImgs.push(e.url.split('/').pop()))
    ).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  await page.setViewportSize({ width: 1350, height: 900 });
  await page.goto('/');
  // The categories have landed (the chips come from them) …
  await expect(page.getByRole('button', { name: 'Bil & Pleie', exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  // … and the arch still shows the first photo, with no second LCP image.
  await expect(page.getByRole('button', { name: 'Vis Maling' })).toHaveAttribute(
    'aria-current',
    'true'
  );
  // Category photos only (the header logo can be an early LCP image too).
  const photos = (await page.evaluate(() => window.__lcpImgs)).filter((u) => /\.webp/.test(u));
  expect(new Set(photos.map((u) => u.split(/[-.]/)[0])).size).toBeLessThanOrEqual(1);
});
