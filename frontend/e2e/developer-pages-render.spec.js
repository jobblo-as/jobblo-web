import { test } from '@playwright/test';
import { expect, mockApi } from './helpers/app.js';

/**
 * Every developer page renders when its API answers with nothing ({ data: {} }) or is down
 * (503): no "Noe gikk galt", and the sidebar stays (a page error is caught inside the layout).
 */
const ROUTES = [
  '',
  'api',
  'errors',
  'server',
  'mongo',
  'scheduler',
  'webhooks',
  'audit',
  'tools',
  'payments',
  'safepay',
  'subscriptions',
  'reconciliation',
  'users',
  'jobs',
  'logs',
  'live',
  'security',
  'flags',
  'performance',
  'notifications',
  'queues',
  'redis',
  'redis/keys',
  'tickets',
  'deployments',
  'incidents',
  'reports',
  'settings',
  'ips',
  'approvals',
  'investigate',
  'integrity',
  'backups',
  'safepay-machine',
  'synthetic',
  'mobile',
  'dependencies',
  'slo',
  'deployment-impact',
  'costs',
  'capacity',
  'config-drift',
  'failure-simulator',
  'fraud',
  'contracts',
  'connect',
  'ledger',
  'transactions',
  'rum',
  'risk',
  'quality',
  'sessions',
  'search',
  'privacy',
  'runbooks',
  'migrations',
  'event-consistency',
  'marketplace',
  'impact',
  'ips/84.210.1.2',
  'workers',
  'nginx',
  'pm2',
  'caching',
  'security-intel',
  'security-intel/devices',
  'security-intel/devices/cccccccccccccccccccccccccccccccc',
  'security-intel/alerts',
  'security-intel/events',
  'security-intel/analytics',
];
const CHUNKS = 4;
test.describe.configure({ timeout: 600_000 });

for (const mode of ['empty', 'down'])
  for (let c = 0; c < CHUNKS; c++)
    test(`developer pages render with the API ${mode} (${c + 1}/${CHUNKS})`, async ({ page }) => {
      const crashes = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && /TypeError|ReferenceError/.test(m.text()))
          crashes.push(m.text().split('\n')[0].slice(0, 200));
      });
      await mockApi(page, { as: 'developer', fallback: mode });
      const failed = [];
      for (const r of ROUTES.filter((_, i) => i % CHUNKS === c)) {
        crashes.length = 0;
        await page.goto(`/developer${r ? `/${r}` : ''}`);
        // Wait for the page itself (its h1) or the error screen, not a fixed time.
        await page.locator('main h1').first().waitFor({ timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        const crashed = await page.getByRole('heading', { name: 'Noe gikk galt' }).count();
        if (crashed || crashes.length) failed.push(`/${r}: ${crashes[0] || 'error screen'}`);
        await expect(page.getByRole('link', { name: 'Overview' }).first()).toBeVisible();
      }
      expect(failed).toEqual([]);
    });

test('a developer page that fails keeps the dashboard around it', async ({ page }) => {
  await mockApi(page, { as: 'developer' });
  // The page's code cannot load: the lazy route throws, as a render error would.
  await page.route('**/src/pages/DeveloperDashboard/ErrorsPage.tsx*', (r) => r.abort());
  await page.goto('/developer/errors');
  await expect(page.getByRole('heading', { name: 'Noe gikk galt' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Overview' }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Til oversikten' }).click();
  await expect(page).toHaveURL(/\/developer$/);
  await expect(page.getByRole('heading', { name: 'Noe gikk galt' })).toHaveCount(0);
});
