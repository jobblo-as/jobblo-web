import { chromium } from '@playwright/test';

/**
 * Global setup: open the app once before any test. The first page load on a fresh dev
 * server pre-bundles every dependency (a minute or more on this repo), which used to land
 * inside whichever spec ran first and blow its 30 s timeout.
 */
export default async function warmup(config) {
  const { baseURL } = config.projects[0].use;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('http://127.0.0.1:5017/**', (route) => route.fulfill({ status: 401, json: {} }));
    await page.goto(`${baseURL}/login`, { timeout: 300_000 });
    await page.getByPlaceholder('deg@eksempel.no').waitFor({ timeout: 300_000 });
  } finally {
    await browser.close();
  }
}
