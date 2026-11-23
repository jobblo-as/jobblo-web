import { test } from '@playwright/test';
import { SERVICE, USERS, expect, mockApi, shot, watchErrors } from './helpers/app.js';

/**
 * "Jobs without photos" task 2: while posting, a hint and the AI's photo ideas; after posting,
 * the owner of a job without photos gets "Legg til bilder" on the job page; the next-day
 * reminder in the tray opens that job.
 */

const MINE = { ...SERVICE, _id: '64b0000000000000000000b1', images: [], categories: ['Maling'] };

test('posting: the photo hint, and the AI says what to photograph', async ({ page }) => {
  const errors = watchErrors(page);
  const asked = [];
  await mockApi(page, {
    as: 'user',
    routes: {
      'POST /api/ai/photo-suggestions': ({ body }) => {
        asked.push(body);
        return {
          success: true,
          suggestions: ['Ta et bilde av hele veggen', 'Ta et nærbilde av skadene'],
        };
      },
    },
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/Publish-job');

  await expect(page.getByText('Oppdrag med bilder får flere og mer presise svar.')).toBeVisible();
  const ask = page.getByRole('button', { name: 'Hva bør jeg ta bilde av?' });
  await expect(ask).toBeDisabled(); // nothing written yet
  await page.locator('#job-title').fill('Male stue');
  await page.locator('#job-description').fill('Vegger og tak i en stue på 20 m².');
  await ask.click();

  const ideas = page.getByRole('list', { name: 'Forslag til bilder' });
  await expect(ideas.getByText('Ta et bilde av hele veggen')).toBeVisible();
  await expect(ideas.getByText('Ta et nærbilde av skadene')).toBeVisible();
  expect(asked[0]).toMatchObject({ title: 'Male stue' });
  await shot(page, 'job-photos-posting-tips');
  expect(errors).toEqual([]);
});

test('after posting: the owner of a job without photos gets "Legg til bilder"', async ({
  page,
}) => {
  await mockApi(page, {
    as: 'user',
    routes: {
      [`GET /api/services/${MINE._id}`]: () => ({ ...MINE, userId: { ...USERS.user } }),
    },
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`/job-listing/${MINE._id}`);

  const add = page.getByRole('button', { name: 'Legg til bilder' });
  await expect(add).toBeVisible();
  await shot(page, 'job-photos-owner-button');
  await add.click();
  await expect(page).toHaveURL(new RegExp(`/Publish-job/${MINE._id}$`));
});

test('a visitor does not get "Legg til bilder" on someone else\'s job', async ({ page }) => {
  await mockApi(page, {
    as: 'provider',
    routes: { [`GET /api/services/${MINE._id}`]: () => ({ ...MINE, userId: { ...USERS.user } }) },
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(`/job-listing/${MINE._id}`);
  await expect(page.getByRole('heading', { name: MINE.title }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Legg til bilder' })).toHaveCount(0);
});

test('a very short description: the AI asks, the answers go into the description', async ({
  page,
}) => {
  const asked = [];
  await mockApi(page, {
    as: 'user',
    routes: {
      'POST /api/ai/description-questions': ({ body }) => {
        asked.push(body);
        return {
          success: true,
          short: true,
          questions: [
            { label: 'Størrelse', question: 'Hvor stort er speilet?' },
            { label: 'Hvor', question: 'Hvor skal det monteres?' },
            { label: 'Når', question: 'Når skal det gjøres?' },
          ],
        };
      },
    },
  });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/Publish-job');

  const description = page.locator('#job-description');
  await description.fill('Noen som er flinke med speilglass?');
  await page.getByRole('button', { name: 'Still meg spørsmål' }).click();
  await page.getByLabel('Hvor stort er speilet?').fill('120 x 80 cm');
  await page.getByLabel('Hvor skal det monteres?').fill('På badet');
  await shot(page, 'description-questions');
  await page.getByRole('button', { name: 'Legg til i beskrivelsen' }).click();

  await expect(description).toHaveValue(
    'Noen som er flinke med speilglass?\n\nStørrelse: 120 x 80 cm\nHvor: På badet'
  );
  expect(asked[0]).toMatchObject({ description: 'Noen som er flinke med speilglass?' });
});

test('a description that says enough gets no questions and no AI call', async ({ page }) => {
  const { calls } = await mockApi(page, { as: 'user' });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/Publish-job');
  await page
    .locator('#job-description')
    .fill(
      'Vi trenger hjelp til å montere et speil på 120 x 80 cm på badet i andre etasje. Skruer og plugger har vi selv.'
    );
  await expect(page.getByRole('button', { name: 'Still meg spørsmål' })).toHaveCount(0);
  expect(calls.some((c) => c.pathname === '/api/ai/description-questions')).toBe(false);
});
