import { test } from '@playwright/test';
import { expect, mockApi, shot } from './helpers/app.js';

/**
 * Logs Explorer: presets, a breakdown that filters, "group similar", per-event actions
 * (filter by trace / IP, ±2 min context) and live tail.
 */
test.describe.configure({ timeout: 90_000 });

const ago = (m) => new Date(Date.now() - m * 60e3).toISOString();
const row = (i, over = {}) => ({
  id: `api:${i}`,
  at: ago(i),
  level: 'error',
  service: 'api',
  message: `POST /api/services → 500 (order 64f00000000000000000000${i % 10})`,
  traceId: `tr-${i}`,
  userId: null,
  data: { ip: '84.210.1.2', code: 'E500' },
  ...over,
});
const LOGS = [
  ...Array.from({ length: 5 }, (_, i) => row(i + 1)),
  row(9, { id: 'auth:9', level: 'warn', service: 'auth', message: 'login failed · o***@x.no' }),
  row(12, { id: 'audit:12', level: 'info', service: 'audit', message: 'Plan updated', data: {} }),
];

test('logs explorer: breakdown, presets, grouping, event actions and live tail', async ({
  page,
}) => {
  const { calls } = await mockApi(page, {
    as: 'developer',
    routes: {
      'GET /api/developer/logs': () => ({
        success: true,
        data: {
          logs: LOGS,
          nextBefore: null,
          services: [],
          levels: [],
          unavailable: ['server (stdout)'],
        },
      }),
    },
  });
  const logCalls = () => calls.filter((c) => c.pathname === '/api/developer/logs');
  await page.goto('/developer/logs');
  await expect(page.getByText('7 loaded')).toBeVisible();

  // Breakdown: counts per level and service, click to filter.
  await expect(page.getByRole('button', { name: 'error 5' })).toBeVisible();
  await page.getByRole('button', { name: 'auth 1' }).click();
  await expect.poll(() => logCalls().at(-1)?.search || '').toContain('services=auth');

  // Preset.
  await page.getByRole('button', { name: 'Errors', exact: true }).click();
  await expect.poll(() => logCalls().at(-1)?.search || '').toContain('levels=error%2Cfatal');
  await page.getByRole('button', { name: 'Clear all' }).click();

  // Group similar: the five 500s share one shape.
  await page.getByRole('button', { name: 'Group similar' }).click();
  await expect(page.getByText('×5')).toBeVisible();
  await expect(page.getByText(/3 distinct/)).toBeVisible();
  await page.getByRole('button', { name: 'Group similar' }).click();

  // Event actions.
  await page.getByText('Plan updated').click();
  await page
    .getByText(/POST \/api\/services → 500/)
    .first()
    .click();
  await expect(page.getByRole('button', { name: /ip 84\.210\.1\.2/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'IP page →' })).toHaveAttribute(
    'href',
    '/developer/ips/84.210.1.2'
  );
  await page.waitForTimeout(1500); // let the chart's bars finish animating
  await shot(page, 'logs-explorer');
  await page.getByRole('button', { name: /±2 min context/ }).click();
  await expect.poll(() => logCalls().at(-1)?.search || '').toMatch(/from=.*&to=/);
  await expect(page.getByRole('button', { name: 'Clear time window' })).toBeVisible();

  // Live tail polls every 5 s.
  const before = logCalls().length;
  await page.getByRole('button', { name: 'Live tail' }).click();
  await expect.poll(() => logCalls().length, { timeout: 12_000 }).toBeGreaterThan(before + 1);
});
