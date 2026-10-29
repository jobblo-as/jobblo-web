import { test } from '@playwright/test';
import { expect, mockApi, shot, watchErrors, SERVICE } from './helpers/app.js';

/** Search/filter, view a listing, save it, apply to it, and edit/publish a job, on a mocked API. */

test.describe.configure({ timeout: 120_000 });

const OTHER = {
  ...SERVICE,
  _id: '64b000000000000000000002',
  title: 'TEST Flytte sofa',
  categories: ['Flytting'],
  urgent: true,
};
const page1 = (data) => ({
  data,
  pagination: { total: data.length, totalPages: 1, page: 1, limit: 16 },
});

test('search and the urgent filter go to the API and narrow the list', async ({ page }) => {
  const errors = watchErrors(page);
  const { calls } = await mockApi(page, {
    routes: {
      'GET /api/services': ({ url }) => {
        const q = url.searchParams;
        let list = [SERVICE, OTHER];
        if (q.get('search'))
          list = list.filter((s) => s.title.toLowerCase().includes(q.get('search').toLowerCase()));
        if (q.get('urgent') === 'true') list = list.filter((s) => s.urgent);
        return page1(list);
      },
    },
  });
  await page.setViewportSize({ width: 1400, height: 900 }); // filter sidebar is visible on desktop
  await page.goto('/search');
  await expect(page.getByText(SERVICE.title).first()).toBeVisible();
  await expect(page.getByText(OTHER.title).first()).toBeVisible();

  await page.getByLabel('Søk etter oppdrag').fill('male');
  await page.getByRole('button', { name: 'Søk', exact: true }).click();
  await expect(page).toHaveURL(/search=male/);
  await expect(page.getByText(OTHER.title)).toHaveCount(0);
  await expect(page.getByText(SERVICE.title).first()).toBeVisible();
  expect(calls.some((c) => c.pathname === '/api/services' && /search=male/.test(c.search))).toBe(
    true
  );

  await page.getByLabel('Tøm søket').click();
  await page
    .getByRole('switch', { name: /Haster/ })
    .first()
    .click();
  await expect
    .poll(() => calls.some((c) => c.pathname === '/api/services' && /urgent=true/.test(c.search)))
    .toBe(true);
  await expect(page.getByText(SERVICE.title)).toHaveCount(0);
  await expect(page.getByText(OTHER.title).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('a listing opens from the search results', async ({ page }) => {
  const errors = watchErrors(page);
  await mockApi(page, {
    routes: {
      'GET /api/services': () => page1([SERVICE]),
      [`GET /api/services/${SERVICE._id}`]: () => SERVICE,
    },
  });
  await page.goto('/search');
  await page.getByText(SERVICE.title).first().click();
  await expect(page).toHaveURL(new RegExp(`/job-listing/${SERVICE._id}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(SERVICE.title);
  await expect(page.getByText(SERVICE.description).first()).toBeVisible();
  expect(errors).toEqual([]);
});

function jobRoutes(extra = {}) {
  return {
    [`GET /api/services/${SERVICE._id}`]: () => SERVICE,
    'GET /api/connect/status': () => ({ payoutReady: true }),
    'GET /api/stripe/v2/entitlements': () => ({
      includedContacts: 5,
      consumedIncludedContacts: 0,
      remainingIncludedContacts: 5,
    }),
    'GET /api/config/FREE_PRIVATE_JOBS_UNDER_10000': () => ({ value: false }),
    ...extra,
  };
}

test('a provider applies to a job with a message', async ({ page }) => {
  const errors = watchErrors(page);
  const { calls } = await mockApi(page, {
    as: 'provider',
    routes: jobRoutes({
      'POST /api/orders/request': ({ body }) => ({
        _id: 'req-1',
        serviceId: body.serviceId,
        status: 'pending',
      }),
    }),
  });
  await page.goto(`/job-listing/${SERVICE._id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(SERVICE.title);
  await page.getByRole('button', { name: 'Send forespørsel', exact: true }).first().click();
  await page
    .getByPlaceholder('Skriv en melding til leverandøren...')
    .fill('Hei, jeg kan gjøre dette på lørdag.');
  await page.getByRole('button', { name: 'Send forespørsel', exact: true }).last().click();
  await expect(page.getByText('Forespørsel sendt! Venter på godkjenning.')).toBeVisible();
  expect(calls.find((c) => c.pathname === '/api/orders/request').body).toMatchObject({
    serviceId: SERVICE._id,
    message: 'Hei, jeg kan gjøre dette på lørdag.',
  });
  expect(errors).toEqual([]);
});

test('the owner of a job cannot apply to it', async ({ page }) => {
  await mockApi(page, { as: 'user', routes: jobRoutes() });
  await page.goto(`/job-listing/${SERVICE._id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(SERVICE.title);
  await expect(page.getByRole('button', { name: 'Send forespørsel', exact: true })).toHaveCount(0);
});

test('a visitor who applies is sent to log in', async ({ page }) => {
  await mockApi(page, { routes: jobRoutes() });
  await page.goto(`/job-listing/${SERVICE._id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(SERVICE.title);
  await page.getByRole('button', { name: 'Send forespørsel', exact: true }).first().click();
  await expect(page).toHaveURL(/\/login$/);
});

test('saving a listing, then browsing favourite lists', async ({ page }) => {
  const errors = watchErrors(page);
  const saved = new Set();
  const list = {
    _id: 'list-1',
    name: 'Oppussing',
    services: [SERVICE],
    userId: '64a000000000000000000002',
    createdAt: '2026-10-20T10:00:00.000Z',
  };
  const { calls } = await mockApi(page, {
    as: 'provider',
    routes: jobRoutes({
      '~POST ^/api/favorites/': ({ url }) => {
        saved.add(url.pathname.split('/').pop());
        return { success: true };
      },
      '~DELETE ^/api/favorites/': ({ url }) => {
        saved.delete(url.pathname.split('/').pop());
        return { success: true };
      },
      'GET /api/lists': () => [list],
      'GET /api/lists/list-1': () => list,
      'GET /api/favorites': () => ({
        favorites: [...saved].map((id) => ({ _id: `fav-${id}`, service: { ...SERVICE, _id: id } })),
      }),
    }),
  });
  await page.goto(`/job-listing/${SERVICE._id}`);
  await page.getByRole('button', { name: 'Lagre oppdraget' }).click();
  await expect(page.getByRole('button', { name: 'Fjern fra lagrede' })).toBeVisible();
  expect(
    calls.some((c) => c.method === 'POST' && c.pathname === `/api/favorites/${SERVICE._id}`)
  ).toBe(true);
  await page.goto('/favorites');
  await page.getByText('Oppussing').first().click();
  await expect(page).toHaveURL(/\/favorites\/list\/list-1$/);
  await expect(page.getByText(SERVICE.title).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('publish a job: step 1 validates, a complete draft (edit mode) is saved', async ({ page }) => {
  const errors = watchErrors(page);
  const full = {
    ...SERVICE,
    countyCode: '03',
    municipalityCode: '0301',
    images: ['https://example.test/a.jpg'],
    fromDate: '2026-11-01',
    toDate: '2026-11-02',
    duration: { value: 2, unit: 'hours' },
  };
  const { calls } = await mockApi(page, {
    as: 'user',
    routes: {
      [`GET /api/services/${SERVICE._id}`]: () => full,
      [`PUT /api/services/${SERVICE._id}`]: () => full,
    },
  });
  // New job: nothing filled in, "next" names what is missing and does not advance.
  await page.goto('/Publish-job');
  await expect(page.getByRole('heading', { name: 'Legg ut et oppdrag' })).toBeVisible();
  await page.getByRole('button', { name: 'Neste', exact: true }).click();
  // Photos are optional: the empty form names the title etc., never a missing photo.
  await expect(page.getByText(/Vennligst fyll ut: .*tittel/)).toBeVisible();
  await expect(page.getByText('Vennligst last opp minst ett bilde.')).toHaveCount(0);

  // Edit: the stored job is loaded and saved back.
  await page.goto(`/Publish-job/${SERVICE._id}`);
  await expect(page.getByRole('heading', { name: 'Rediger oppdraget' })).toBeVisible();
  await expect(page.locator(`input[value="${SERVICE.title}"]`)).toHaveCount(1);
  expect(
    calls.some((c) => c.pathname === `/api/services/${SERVICE._id}` && c.method === 'GET')
  ).toBe(true);
  // Two pages, not four: page 2 holds place/time/price with checklist and contact folded in.
  await expect(page.getByText('Steg 1 av 2')).toBeVisible();
  await page.getByRole('button', { name: 'Neste', exact: true }).click();
  await expect(page.getByText('Steg 2 av 2')).toBeVisible();
  await expect(page.getByRole('button', { name: /Publiser oppdrag/ })).toBeVisible();
  await expect(page.getByText('Legg til sjekkliste')).toBeVisible();
  await expect(page.locator('#job-email')).toBeHidden();
  await page.getByText('Kontaktinformasjon (Valgfritt)').click();
  await expect(page.locator('#job-email')).toBeVisible();
  await page.getByRole('button', { name: /Publiser oppdrag/ }).click();
  await expect
    .poll(() =>
      calls.some((c) => c.pathname === `/api/services/${SERVICE._id}` && c.method === 'PUT')
    )
    .toBe(true);
  expect(errors).toEqual([]);
});

test('a new job starts with the profile e-mail as contact', async ({ page }) => {
  await mockApi(page, { as: 'user' });
  await page.goto('/Publish-job');
  await expect(page.getByRole('heading', { name: 'Legg ut et oppdrag' })).toBeVisible();
  // The autosaved draft (IndexedDB) carries the prefilled contact, no step-4 walk needed.
  const draftEmail = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open('jobblo-form-db');
          open.onerror = () => resolve(null);
          open.onsuccess = () => {
            const req = open.result
              .transaction('job-form-data')
              .objectStore('job-form-data')
              .get('current-form');
            req.onsuccess = () => resolve(req.result?.data?.email ?? null);
            req.onerror = () => resolve(null);
          };
        })
    );
  await expect.poll(draftEmail).toBe('customer@example.test');
});

test('AI draft is reviewed in a popup and never replaces typed text unless ticked', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const { calls } = await mockApi(page, {
    as: 'user',
    routes: {
      'POST /api/ai/generate-full-listing': () => ({
        success: true,
        data: {
          title: 'AI-tittel',
          description: 'AI skrev denne beskrivelsen av oppdraget.',
          category: 'Maling',
          skills: [],
          duration: { value: 3, unit: 'hours' },
          locationRelevance: 'on-site',
          priceRange: null,
          suggestedPrice: 2500,
          pricingReasoning: 'Estimat basert på 3 timer.',
          paymentType: 'Fastpris',
          isEstimate: true,
        },
      }),
    },
  });
  await page.goto('/Publish-job');
  await page.locator('#job-title').fill('Min egen tittel');
  await page.getByPlaceholder(/Male en liten bod/).fill('Male boden min utvendig');
  await page.getByRole('button', { name: 'Foreslå et utkast' }).click();

  const dialog = page.getByRole('dialog', { name: 'Forslag til utkast' });
  await expect(dialog).toBeVisible();
  // Nothing written yet; the typed title starts unticked, the empty description ticked.
  await expect(page.locator('#job-title')).toHaveValue('Min egen tittel');
  await expect(dialog.getByRole('checkbox', { name: /Tittel/ })).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /Beskrivelse/ })).toBeChecked();
  await dialog.getByRole('button', { name: /Bruk valgte/ }).click();

  await expect(dialog).toBeHidden();
  await expect(page.locator('#job-title')).toHaveValue('Min egen tittel');
  await expect(page.locator('#job-description')).toHaveValue(
    'AI skrev denne beskrivelsen av oppdraget.'
  );
  expect(calls.some((c) => c.pathname === '/api/ai/generate-full-listing')).toBe(true);
  expect(errors).toEqual([]);
});

// A 40×30 green PNG: a real image the upload accepts and the thumbnail shows.
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAeElEQVR4nMXCgQVCAQBF0TfR3eEtkyRJkiRfkiRJkiRJozbGPU4YVRnGVYZJlWFaZZhVGeZVhkWVYVllWFUZ1lWGTZVhW2UYqgy7KsO+ynCoMhyrDKcqw7nKcKkyXKsMtyrDvcrwqDI8qwyvKsO7yvCpMnyrDL8q/wwGbp2frO4OAAAAAElFTkSuQmCC',
  'base64'
);

// A light photo (white with a small orange logo), like a company logo on white.
const LIGHT_PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAIAAAADnC86AAAAOElEQVR4nO3NsQkAIAwAsJ7jsd7ZG6STF+hWRAhkT1StJ0IsFovF4s/jnONOLBaLxQ3EYrFYLD7aFyykPs0f8CcAAAAASUVORK5CYII=',
  'base64'
);

test('"Foreslå et utkast": photos alone are enough, and they are sent with the request', async ({
  page,
}) => {
  const errors = watchErrors(page);
  // The AI answers only when the test lets it, so the loading dialog can be looked at.
  let answer;
  const answered = new Promise((resolve) => (answer = resolve));
  const { calls } = await mockApi(page, {
    as: 'user',
    routes: {
      'POST /api/ai/generate-full-listing': async () => (
        await answered,
        {
          success: true,
          data: {
            title: 'Male boden utvendig',
            description: 'Boden på bildet trenger ny maling utvendig, ca. 8 m².',
            category: 'Maling',
            checklist: ['Dekke til bakken', 'Skrape løs maling', 'Male to strøk'],
            skills: [],
            duration: { value: 4, unit: 'hours' },
            locationRelevance: 'on-site',
            priceRange: null,
            suggestedPrice: 2400,
            pricingReasoning: 'Estimat basert på 4 timer.',
            paymentType: 'Fastpris',
            isEstimate: true,
          },
        }
      ),
    },
  });
  await page.goto('/Publish-job');
  const suggest = page.getByRole('button', { name: 'Foreslå et utkast' });
  // Nothing yet: no photo and no text.
  await expect(suggest).toBeDisabled();
  await expect(page.getByText('Legg til bilder eller skriv minst 5 tegn')).toBeVisible();
  await shot(page, '1-tomt-skjema');

  await page
    .locator('input[type="file"]:not([capture])')
    .setInputFiles({ name: 'bod.png', mimeType: 'image/png', buffer: PHOTO });
  await expect(page.getByText('Bruker 1 bilde')).toBeVisible();
  await expect(suggest).toBeEnabled();
  await shot(page, '2-bilde-lagt-til');

  await suggest.click();
  // While it works: the photo circles in "Lager utkast".
  const loading = page.getByRole('dialog', { name: 'Lager utkast' });
  await expect(loading).toBeVisible();
  await expect(loading.locator('img')).toHaveCount(1);
  await expect(loading.getByText('Ser på bildene…')).toBeVisible();
  await shot(page, '3a-lager-utkast');
  answer();
  await expect(loading).toBeHidden();
  const dialog = page.getByRole('dialog', { name: 'Forslag til utkast' });
  await expect(dialog).toBeVisible();
  // The job's own checklist is offered too, whole, and ticked (the form had none yet).
  await expect(dialog.getByRole('checkbox', { name: /Sjekkliste/ })).toBeChecked();
  await expect(dialog.getByText('• Male to strøk')).toBeVisible();
  await shot(page, '3-forslag-til-utkast');
  await dialog.getByRole('button', { name: /Bruk valgte/ }).click();
  await expect(page.locator('#job-title')).toHaveValue('Male boden utvendig');
  await shot(page, '4-utkast-brukt');

  // The ticked checklist lands in the form's checklist (page 2), replacing nothing typed.
  await page.getByRole('button', { name: 'Neste', exact: true }).click();
  await page.getByText('Legg til sjekkliste').click();
  for (const step of ['Dekke til bakken', 'Skrape løs maling', 'Male to strøk'])
    await expect(page.locator(`input[value="${step}"]`)).toHaveCount(1);
  await shot(page, '5-sjekkliste-i-skjema');

  // One request, multipart, carrying the photo; the old per-photo endpoint is not used.
  const sent = calls.filter((c) => c.pathname === '/api/ai/generate-full-listing');
  expect(sent).toHaveLength(1);
  expect(String(sent[0].body)).toContain('name="images"');
  expect(calls.some((c) => c.pathname === '/api/ai/analyze-job-image')).toBe(false);
  expect(errors).toEqual([]);
});

test('"Lager utkast": Avbryt stops the AI request and nothing reaches the form', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await mockApi(page, {
    as: 'user',
    // Never answers: only "Avbryt" can end the wait.
    routes: { 'POST /api/ai/generate-full-listing': () => new Promise(() => {}) },
  });
  await page.goto('/Publish-job');
  await page.getByPlaceholder(/Male en liten bod/).fill('Male boden min utvendig');
  await page.getByRole('button', { name: 'Foreslå et utkast' }).click();
  const loading = page.getByRole('dialog', { name: 'Lager utkast' });
  await expect(loading.getByText('Leser beskrivelsen…')).toBeVisible();
  await loading.getByRole('button', { name: 'Avbryt' }).click();
  await expect(loading).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Forslag til utkast' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Foreslå et utkast' })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('photos: a row of tiles, reordered with the arrows, sent in that order', async ({ page }) => {
  const errors = watchErrors(page);
  const { calls } = await mockApi(page, {
    as: 'user',
    routes: {
      'GET /api/job-drafts': () => ({ drafts: [] }),
      'GET /api/job-drafts/d1': () => ({
        draft: {
          _id: 'd1',
          data: {
            title: SERVICE.title,
            description: SERVICE.description,
            categories: 'Maling',
            address: 'Testveien 1',
            city: 'Oslo',
            postalCode: '0150',
            countyCode: '03',
            municipalityCode: '0301',
            latitude: 59.91,
            longitude: 10.75,
            price: 3000,
            paymentType: 'Fastpris',
            durationValue: 2,
            durationUnit: 'hours',
          },
        },
      }),
      'PUT /api/job-drafts/d1': () => ({ draft: { _id: 'd1' } }),
      'DELETE /api/job-drafts/d1': () => ({ ok: true }),
      'POST /api/services': () => ({ status: 201, json: SERVICE }),
    },
  });
  await page.goto('/Publish-job?utkast=d1');
  await expect(page.locator('#job-title')).toHaveValue(SERVICE.title);
  await page.locator('input[type="file"]:not([capture])').setInputFiles([
    { name: 'forfra.png', mimeType: 'image/png', buffer: PHOTO },
    { name: 'bakfra.png', mimeType: 'image/png', buffer: LIGHT_PHOTO },
  ]);
  const photos = page.getByRole('list', { name: 'Bilder i rekkefølge' });
  // Side by side, not stacked: the second tile sits to the right of the first.
  const tiles = photos.getByRole('listitem');
  await expect(tiles).toHaveCount(2);
  const [first, second] = [tiles.nth(0), tiles.nth(1)];
  expect((await second.boundingBox()).x).toBeGreaterThan((await first.boundingBox()).x);
  await shot(page, '1-bilder-i-rad');
  await page.getByRole('button', { name: 'Flytt bilde 2 til venstre' }).click();
  // The moved one is now the main photo; the first tile cannot go further left.
  await expect(first.getByText('Hovedbilde')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Flytt bilde 1 til venstre' })).toBeDisabled();
  await shot(page, '2-flyttet-til-venstre');

  await page.getByRole('button', { name: 'Neste', exact: true }).click();
  await page.getByRole('button', { name: /Gå videre/ }).click();
  await page.getByRole('button', { name: /Publiser oppdrag/ }).click();
  await expect
    .poll(() => calls.some((c) => c.method === 'POST' && c.pathname === '/api/services'))
    .toBe(true);
  const body = String(
    calls.find((c) => c.method === 'POST' && c.pathname === '/api/services').body
  );
  // Files go in the shown order, so new:0 is the photo now first ("bakfra").
  expect(body.indexOf('filename="bakfra.png"')).toBeLessThan(body.indexOf('filename="forfra.png"'));
  expect(body).toContain('["new:0","new:1"]');
  expect(body).not.toContain('imageCaptions');
  expect(errors).toEqual([]);
});

test('the job page thumbnails: a light photo stays visible, a tap shows it', async ({ page }) => {
  const job = {
    ...SERVICE,
    images: ['https://example.test/a.jpg', 'https://example.test/b.jpg'],
  };
  // a.jpg is a light photo: the thumbnail must still show as a photo, not an empty box.
  await page.route('https://example.test/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: route.request().url().endsWith('/a.jpg') ? LIGHT_PHOTO : PHOTO,
    })
  );
  await mockApi(page, { routes: { [`GET /api/services/${SERVICE._id}`]: () => job } });
  await page.goto(`/jobs/${SERVICE._id}`);
  await expect(page.getByRole('heading', { name: SERVICE.title }).first()).toBeVisible();
  await expect(page.getByText('1 / 2')).toBeVisible();
  await page.getByRole('button', { name: 'Vis bilde 2' }).click();
  await expect(page.getByText('2 / 2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vis bilde 2' })).toHaveAttribute(
    'aria-current',
    'true'
  );
  await shot(page, 'jobbside-miniatyrer');
});

test('"Dine utkast": photos are stored with the draft and come back with it', async ({ page }) => {
  const errors = watchErrors(page);
  const DRAFT_PHOTO = 'https://example.test/utkast-bilde.jpg';
  const full = {
    title: SERVICE.title,
    description: SERVICE.description,
    categories: 'Maling',
    address: 'Testveien 1',
    city: 'Oslo',
    postalCode: '0150',
    countyCode: '03',
    municipalityCode: '0301',
    latitude: 59.91,
    longitude: 10.75,
    price: 3000,
    paymentType: 'Fastpris',
    durationValue: 2,
    durationUnit: 'hours',
    draftImageUrls: { 'bod.png:120:1': DRAFT_PHOTO },
  };
  const { calls } = await mockApi(page, {
    as: 'user',
    routes: {
      'GET /api/job-drafts': () => ({ drafts: [] }),
      'POST /api/job-drafts': () => ({ status: 201, json: { draft: { _id: 'd2' } } }),
      'PUT /api/job-drafts/d2': () => ({ draft: { _id: 'd2' } }),
      'POST /api/job-drafts/d2/images': () => ({ status: 201, json: { url: DRAFT_PHOTO } }),
      'GET /api/job-drafts/d3': () => ({ draft: { _id: 'd3', data: full } }),
      'PUT /api/job-drafts/d3': () => ({ draft: { _id: 'd3' } }),
      'DELETE /api/job-drafts/d3': () => ({ ok: true }),
      'POST /api/services': () => ({ status: 201, json: SERVICE }),
    },
  });
  await page.route('https://example.test/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: PHOTO })
  );

  // 1. A new draft: once it exists on the server, its photo is uploaded to it.
  await page.goto('/Publish-job');
  await page.locator('#job-title').fill('Vaske vinduer');
  await page
    .locator('input[type="file"]:not([capture])')
    .setInputFiles({ name: 'bod.png', mimeType: 'image/png', buffer: PHOTO });
  await expect
    .poll(() =>
      calls.some((c) => c.method === 'POST' && c.pathname === '/api/job-drafts/d2/images')
    )
    .toBe(true);
  // The draft remembers it (so it is not uploaded again).
  await expect
    .poll(() =>
      calls.some(
        (c) =>
          c.method === 'PUT' &&
          c.pathname === '/api/job-drafts/d2' &&
          Object.values(c.body?.data?.draftImageUrls || {}).includes(DRAFT_PHOTO)
      )
    )
    .toBe(true);

  // 2. Opened from "Dine utkast" (another device: no local files), the photo is there.
  await page.evaluate(() => indexedDB.deleteDatabase('jobblo-form-db'));
  await page.goto('/Publish-job?utkast=d3');
  await expect(page.locator(`img[src="${DRAFT_PHOTO}"]`)).toHaveCount(1);
  await shot(page, 'utkast-med-bilde');

  // 3. Publishing uses the stored photo: no file upload, the draft is named.
  await page.getByRole('button', { name: 'Neste', exact: true }).click();
  await page.getByRole('button', { name: /Gå videre/ }).click();
  await page.getByRole('button', { name: /Publiser oppdrag/ }).click();
  await expect
    .poll(() => calls.some((c) => c.method === 'POST' && c.pathname === '/api/services'))
    .toBe(true);
  const body = String(
    calls.find((c) => c.method === 'POST' && c.pathname === '/api/services').body
  );
  expect(body).toContain(JSON.stringify([DRAFT_PHOTO]));
  expect(body).toMatch(/name="draftId"\s+d3/);
  expect(body).not.toContain('filename=');
  expect(errors).toEqual([]);
});

test('"Dine utkast": typing saves a server draft, a listed draft opens, and can be deleted', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const { calls } = await mockApi(page, {
    as: 'user',
    routes: {
      'GET /api/job-drafts': () => ({
        drafts: [{ _id: 'd1', title: 'Utkast fra mobilen', updatedAt: '2026-10-20T10:00:00Z' }],
      }),
      'GET /api/job-drafts/d1': () => ({
        draft: {
          _id: 'd1',
          data: { title: 'Utkast fra mobilen', description: 'Skrevet på telefonen i går kveld.' },
        },
      }),
      'POST /api/job-drafts': () => ({ status: 201, json: { draft: { _id: 'd2' } } }),
      'PUT /api/job-drafts/d2': () => ({ draft: { _id: 'd2' } }),
      'DELETE /api/job-drafts/d1': () => ({ ok: true }),
    },
  });
  await page.goto('/Publish-job');
  const list = page.getByRole('region', { name: 'Dine utkast' });
  await expect(list.getByText('Utkast fra mobilen')).toBeVisible();

  // Typing a title saves it on the server (debounced, once).
  await page.locator('#job-title').fill('Vaske vinduer');
  await expect
    .poll(() => calls.filter((c) => c.method === 'POST' && c.pathname === '/api/job-drafts').length)
    .toBe(1);
  expect(
    calls.find((c) => c.method === 'POST' && c.pathname === '/api/job-drafts').body.data.title
  ).toBe('Vaske vinduer');

  // A listed draft opens in the form.
  await list.getByText('Utkast fra mobilen').click();
  await expect(page).toHaveURL(/\?utkast=d1$/);
  await expect(page.locator('#job-title')).toHaveValue('Utkast fra mobilen');

  await list.getByRole('button', { name: /Slett utkastet Utkast fra mobilen/ }).click();
  await expect
    .poll(() => calls.some((c) => c.method === 'DELETE' && c.pathname === '/api/job-drafts/d1'))
    .toBe(true);
  expect(errors).toEqual([]);
});

test('address: one Kartverket search fills postnummer, sted, fylke and kommune, and they are published', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const full = {
    ...SERVICE,
    countyCode: '03',
    municipalityCode: '0301',
    images: ['https://example.test/a.jpg'],
    fromDate: '2026-11-01',
    toDate: '2026-11-02',
    duration: { value: 2, unit: 'hours' },
  };
  const { calls } = await mockApi(page, {
    as: 'user',
    routes: {
      [`GET /api/services/${SERVICE._id}`]: () => full,
      [`PUT /api/services/${SERVICE._id}`]: () => full,
      'GET /api/location-filter/tree': () => [
        { code: '03', name: 'Oslo', children: [{ code: '0301', name: 'Oslo' }] },
        { code: '46', name: 'Vestland', children: [{ code: '4601', name: 'Bergen' }] },
      ],
    },
  });
  // Kartverket's address register, answered locally.
  await page.route('https://ws.geonorge.no/**', (route) =>
    route.fulfill({
      json: {
        adresser: [
          {
            adressetekst: 'Bryggen 1',
            postnummer: '5003',
            poststed: 'BERGEN',
            kommunenummer: '4601',
            kommunenavn: 'BERGEN',
            representasjonspunkt: { lat: 60.397, lon: 5.324 },
          },
        ],
      },
    })
  );

  await page.goto(`/Publish-job/${SERVICE._id}`);
  await page.getByRole('button', { name: 'Neste', exact: true }).click();
  await expect(page.getByText('Steg 2 av 2')).toBeVisible();
  // No fylke/kommune dropdowns any more: the address decides them.
  await expect(page.locator('#job-county')).toHaveCount(0);

  await page.locator('#job-address').fill('Bryggen 1');
  await page.getByRole('option').getByText('Bryggen 1').click();
  await expect(page.getByText(/Lokasjon bekreftet · 5003 Bergen/)).toBeVisible();
  await expect(page.locator('#job-postal-code')).toHaveValue('5003');
  await expect(page.locator('#job-city')).toHaveValue('Bergen');

  await page.getByRole('button', { name: /Publiser oppdrag/ }).click();
  await expect
    .poll(() =>
      calls.some((c) => c.method === 'PUT' && c.pathname === `/api/services/${SERVICE._id}`)
    )
    .toBe(true);
  const sent = String(
    calls.find((c) => c.method === 'PUT' && c.pathname === `/api/services/${SERVICE._id}`).body
  );
  for (const [field, value] of [
    ['location[postalCode]', '5003'],
    ['location[city]', 'Bergen'],
    ['countyCode', '46'],
    ['municipalityCode', '4601'],
  ]) {
    expect(sent).toMatch(
      new RegExp(`name="${field.replace(/[[\]]/g, '\\$&')}"\\r?\\n\\r?\\n${value}\\r?\\n`)
    );
  }
  expect(errors).toEqual([]);
});

// BUG (a11y): OrderRequestModal (components/job/OrderRequestModal.tsx) has no role="dialog" /
// aria-modal / accessible name, and its close "X" button (line ~49) has no label.
test('"Nesten ferdig": Hast is paid on Stripe first, then back here to publish', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const { calls } = await mockApi(page, {
    as: 'user',
    routes: {
      'GET /api/job-drafts': () => ({ drafts: [] }),
      'GET /api/job-drafts/d1': () => ({
        draft: {
          _id: 'd1',
          data: {
            title: SERVICE.title,
            description: SERVICE.description,
            categories: 'Maling',
            address: 'Testveien 1',
            city: 'Oslo',
            postalCode: '0150',
            countyCode: '03',
            municipalityCode: '0301',
            latitude: 59.91,
            longitude: 10.75,
            price: 3000,
            paymentType: 'Fastpris',
            durationValue: 2,
            durationUnit: 'hours',
            currentStep: 2,
          },
        },
      }),
      'PUT /api/job-drafts/d1': () => ({ draft: { _id: 'd1' } }),
      'DELETE /api/job-drafts/d1': () => ({ ok: true }),
      'POST /api/services': () => ({ status: 201, json: { ...SERVICE, urgent: true } }),
      [`GET /api/services/${SERVICE._id}`]: () => ({ ...SERVICE, urgent: true }),
      'POST /api/stripe/create-urgent-payment': () => ({
        url: 'https://checkout.stripe.test/pay',
      }),
      'GET /api/stripe/urgent-status/cs_test_abc': () => ({ status: 'paid', purchaseId: 'p1' }),
      'GET /api/location-filter/tree': () => [
        { code: '03', name: 'Oslo', children: [{ code: '0301', name: 'Oslo' }] },
      ],
    },
  });
  await page.route('https://checkout.stripe.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Stripe</h1>' })
  );

  await page.goto('/Publish-job?utkast=d1');
  await expect(page.getByText('Steg 2 av 3')).toBeVisible();
  await page.getByRole('button', { name: /Gå videre/ }).click();

  await expect(page.getByText('Steg 3 av 3')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nesten ferdig!' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Trygg betaling med SafePay' })).toBeVisible();
  // Standard (free) is the default; nothing is charged unless Hast is picked.
  await expect(page.getByRole('radio', { name: /^Standard/ })).toBeChecked();
  await expect(page.getByRole('button', { name: /Publiser oppdrag/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Betal 39 kr/ })).toHaveCount(0);
  await page.getByRole('radio', { name: /^Hast/ }).check();
  await expect(page.getByText('39 kr').last()).toBeVisible();
  // Hast swaps the bar's publish button for its own pay button.
  await expect(page.getByRole('button', { name: /Publiser oppdrag/ })).toHaveCount(0);
  await shot(page, 'hast-betal-knapp');
  await page.getByRole('button', { name: 'Betal 39 kr' }).click();

  // 1. Stripe first, for no job yet: nothing is published before the payment.
  await expect(page).toHaveURL('https://checkout.stripe.test/pay');
  const pay = calls.find(
    (c) => c.method === 'POST' && c.pathname === '/api/stripe/create-urgent-payment'
  );
  expect(pay.body).toEqual({});
  expect(calls.some((c) => c.method === 'POST' && c.pathname === '/api/services')).toBe(false);

  // 2. Stripe sends the user back to the same form; the draft refills it.
  await page.goto('/Publish-job?hast=paid&session_id=cs_test_abc');
  await expect(page.getByText(/Betalingen er fullført/)).toBeVisible();
  await expect(page.getByRole('radio', { name: /^Standard/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Betal 39 kr/ })).toHaveCount(0);
  await shot(page, 'hast-betalt-publiser');

  // 3. Now publish: the paid purchase goes with the job, and its page opens.
  await page.getByRole('button', { name: /Publiser oppdrag/ }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${SERVICE._id}$`));
  const sent = String(
    calls.find((c) => c.method === 'POST' && c.pathname === '/api/services').body
  );
  expect(sent).toMatch(/name="urgentPurchaseId"\s+p1/);
  expect(sent).toContain(SERVICE.title);
  await expect(page.getByText('Haster').first()).toBeVisible();
  await shot(page, 'hast-jobbside');
  expect(errors).toEqual([]);
});

test('the apply modal is an accessible dialog with a labelled close button', async ({ page }) => {
  await mockApi(page, { as: 'provider', routes: jobRoutes() });
  await page.goto(`/job-listing/${SERVICE._id}`);
  await page.getByRole('button', { name: 'Send forespørsel', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Send forespørsel' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Lukk/ })).toBeVisible();
});
