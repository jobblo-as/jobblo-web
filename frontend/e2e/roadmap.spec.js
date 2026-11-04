import { test } from '@playwright/test';
import { expect, mockApi, shot } from './helpers/app.js';

/** /upcoming: Norwegian, Jobblo's look, filters with counts, and an empty state per filter. */
const FEATURES = [
  {
    _id: 'f1',
    title: 'Vipps-betaling',
    description: 'Betal med Vipps i SafePay.',
    status: 'in-progress',
    tag: 'feature',
    progress: 60,
    releaseDate: '2026-12-01',
  },
  {
    _id: 'f2',
    title: 'Raskere søk',
    description: 'Søket svarer før du er ferdig å skrive.',
    status: 'planned',
    tag: 'improvement',
    progress: 0,
  },
  {
    _id: 'f3',
    title: 'BankID-innlogging',
    description: 'Logg inn med BankID.',
    status: 'completed',
    tag: 'security',
    progress: 100,
    releaseDate: '2026-10-01',
  },
];

test('roadmap lists features with status, filters by them, and explains an empty filter', async ({
  page,
}) => {
  let features = FEATURES;
  await mockApi(page, { routes: { 'GET /api/upcoming': () => features } });
  await page.goto('/upcoming');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Det vi bygger nå.');
  await expect(page.getByRole('heading', { name: 'Vipps-betaling' })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: /Vipps-betaling: 60 %/ })).toBeVisible();
  await expect(page.getByText('Lansert oktober 2026')).toBeVisible();
  await shot(page, 'roadmap');

  await page.getByRole('button', { name: /^Lansert/ }).click();
  await expect(page.getByRole('heading', { name: 'BankID-innlogging' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Vipps-betaling' })).toHaveCount(0);

  features = FEATURES.filter((f) => f.status !== 'completed');
  await page.reload();
  await page.getByRole('button', { name: /^Lansert/ }).click();
  await expect(page.getByRole('heading', { name: 'Ingenting her ennå' })).toBeVisible();
  await page.getByRole('button', { name: 'Vis alle' }).click();
  await expect(page.getByRole('heading', { name: 'Raskere søk' })).toBeVisible();
});

test('roadmap with nothing on it', async ({ page }) => {
  await mockApi(page, { routes: { 'GET /api/upcoming': () => [] } });
  await page.goto('/upcoming');
  await expect(page.getByRole('heading', { name: 'Mer er på vei' })).toBeVisible();
  await shot(page, 'roadmap-empty');
});
