import { test } from '@playwright/test';
import { expect, mockApi, watchErrors, SERVICE } from './helpers/app.js';

/** Search/filter, view a listing, save it, apply to it, and edit/publish a job, on a mocked API. */

test.describe.configure({ timeout: 120_000 });

const OTHER = { ...SERVICE, _id: '64b000000000000000000002', title: 'TEST Flytte sofa', categories: ['Flytting'], urgent: true };
const page1 = (data) => ({ data, pagination: { total: data.length, totalPages: 1, page: 1, limit: 16 } });

test('search and the urgent filter go to the API and narrow the list', async ({ page }) => {
  const errors = watchErrors(page);
  const { calls } = await mockApi(page, {
    routes: {
      'GET /api/services': ({ url }) => {
        const q = url.searchParams;
        let list = [SERVICE, OTHER];
        if (q.get('search')) list = list.filter((s) => s.title.toLowerCase().includes(q.get('search').toLowerCase()));
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
  expect(calls.some((c) => c.pathname === '/api/services' && /search=male/.test(c.search))).toBe(true);

  await page.getByLabel('Tøm søket').click();
  await page.getByRole('switch', { name: /Haster/ }).first().click();
  await expect.poll(() => calls.some((c) => c.pathname === '/api/services' && /urgent=true/.test(c.search))).toBe(true);
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
    'GET /api/stripe/v2/entitlements': () => ({ includedContacts: 5, consumedIncludedContacts: 0, remainingIncludedContacts: 5 }),
    'GET /api/config/FREE_PRIVATE_JOBS_UNDER_10000': () => ({ value: false }),
    ...extra,
  };
}

test('a provider applies to a job with a message', async ({ page }) => {
  const errors = watchErrors(page);
  const { calls } = await mockApi(page, {
    as: 'provider',
    routes: jobRoutes({ 'POST /api/orders/request': ({ body }) => ({ _id: 'req-1', serviceId: body.serviceId, status: 'pending' }) }),
  });
  await page.goto(`/job-listing/${SERVICE._id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(SERVICE.title);
  await page.getByRole('button', { name: 'Send forespørsel', exact: true }).first().click();
  await page.getByPlaceholder('Skriv en melding til leverandøren...').fill('Hei, jeg kan gjøre dette på lørdag.');
  await page.getByRole('button', { name: 'Send forespørsel', exact: true }).last().click();
  await expect(page.getByText('Forespørsel sendt! Venter på godkjenning.')).toBeVisible();
  expect(calls.find((c) => c.pathname === '/api/orders/request').body).toMatchObject({ serviceId: SERVICE._id, message: 'Hei, jeg kan gjøre dette på lørdag.' });
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
  const list = { _id: 'list-1', name: 'Oppussing', services: [SERVICE], userId: '64a000000000000000000002', createdAt: '2026-10-20T10:00:00.000Z' };
  const { calls } = await mockApi(page, {
    as: 'provider',
    routes: jobRoutes({
      '~POST ^/api/favorites/': ({ url }) => { saved.add(url.pathname.split('/').pop()); return { success: true }; },
      '~DELETE ^/api/favorites/': ({ url }) => { saved.delete(url.pathname.split('/').pop()); return { success: true }; },
      'GET /api/lists': () => [list],
      'GET /api/lists/list-1': () => list,
      'GET /api/favorites': () => ({ favorites: [...saved].map((id) => ({ _id: `fav-${id}`, service: { ...SERVICE, _id: id } })) }),
    }),
  });
  await page.goto(`/job-listing/${SERVICE._id}`);
  await page.getByRole('button', { name: 'Lagre oppdraget' }).click();
  await expect(page.getByRole('button', { name: 'Fjern fra lagrede' })).toBeVisible();
  expect(calls.some((c) => c.method === 'POST' && c.pathname === `/api/favorites/${SERVICE._id}`)).toBe(true);
  await page.goto('/favorites');
  await page.getByText('Oppussing').first().click();
  await expect(page).toHaveURL(/\/favorites\/list\/list-1$/);
  await expect(page.getByText(SERVICE.title).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('publish a job: step 1 validates, a complete draft (edit mode) is saved', async ({ page }) => {
  const errors = watchErrors(page);
  const full = {
    ...SERVICE, countyCode: '03', municipalityCode: '0301', images: ['https://example.test/a.jpg'],
    fromDate: '2026-11-01', toDate: '2026-11-02', duration: { value: 2, unit: 'hours' },
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
  await page.getByRole('button', { name: /Neste/ }).first().click();
  // Photos are optional: the empty form names the title etc., never a missing photo.
  await expect(page.getByText(/Vennligst fyll ut: .*tittel/)).toBeVisible();
  await expect(page.getByText('Vennligst last opp minst ett bilde.')).toHaveCount(0);

  // Edit: the stored job is loaded and saved back.
  await page.goto(`/Publish-job/${SERVICE._id}`);
  await expect(page.getByRole('heading', { name: 'Rediger oppdraget' })).toBeVisible();
  await expect(page.locator(`input[value="${SERVICE.title}"]`)).toHaveCount(1);
  expect(calls.some((c) => c.pathname === `/api/services/${SERVICE._id}` && c.method === 'GET')).toBe(true);
  // Two pages, not four: page 2 holds place/time/price with checklist and contact folded in.
  await expect(page.getByText('Steg 1 av 2')).toBeVisible();
  await page.getByRole('button', { name: /Neste/ }).first().click();
  await expect(page.getByText('Steg 2 av 2')).toBeVisible();
  await expect(page.getByRole('button', { name: /Publiser oppdrag/ })).toBeVisible();
  await expect(page.getByText('Legg til sjekkliste')).toBeVisible();
  await expect(page.locator('#job-email')).toBeHidden();
  await page.getByText('Kontaktinformasjon (Valgfritt)').click();
  await expect(page.locator('#job-email')).toBeVisible();
  await page.getByRole('button', { name: /Publiser oppdrag/ }).click();
  await expect.poll(() => calls.some((c) => c.pathname === `/api/services/${SERVICE._id}` && c.method === 'PUT')).toBe(true);
  expect(errors).toEqual([]);
});

test('a new job starts with the profile e-mail as contact', async ({ page }) => {
  await mockApi(page, { as: 'user' });
  await page.goto('/Publish-job');
  await expect(page.getByRole('heading', { name: 'Legg ut et oppdrag' })).toBeVisible();
  // The autosaved draft (IndexedDB) carries the prefilled contact, no step-4 walk needed.
  const draftEmail = () => page.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('jobblo-form-db');
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const req = open.result.transaction('job-form-data').objectStore('job-form-data').get('current-form');
      req.onsuccess = () => resolve(req.result?.data?.email ?? null);
      req.onerror = () => resolve(null);
    };
  }));
  await expect.poll(draftEmail).toBe('customer@example.test');
});

test('AI draft is reviewed in a popup and never replaces typed text unless ticked', async ({ page }) => {
  const errors = watchErrors(page);
  const { calls } = await mockApi(page, {
    as: 'user',
    routes: {
      'POST /api/ai/generate-full-listing': () => ({
        success: true,
        data: {
          title: 'AI-tittel', description: 'AI skrev denne beskrivelsen av oppdraget.', category: 'Maling',
          skills: [], duration: { value: 3, unit: 'hours' }, locationRelevance: 'on-site',
          priceRange: null, suggestedPrice: 2500, pricingReasoning: 'Estimat basert på 3 timer.',
          paymentType: 'Fastpris', isEstimate: true,
        },
      }),
    },
  });
  await page.goto('/Publish-job');
  await page.locator('#job-title').fill('Min egen tittel');
  await page.getByRole('button', { name: 'Foreslå utkast med AI' }).click();
  await page.getByPlaceholder(/Male en liten bod/).fill('Male boden min utvendig');
  await page.getByRole('button', { name: 'Foreslå utkast', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Forslag til utkast' });
  await expect(dialog).toBeVisible();
  // Nothing written yet; the typed title starts unticked, the empty description ticked.
  await expect(page.locator('#job-title')).toHaveValue('Min egen tittel');
  await expect(dialog.getByRole('checkbox', { name: /Tittel/ })).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /Beskrivelse/ })).toBeChecked();
  await dialog.getByRole('button', { name: /Bruk valgte/ }).click();

  await expect(dialog).toBeHidden();
  await expect(page.locator('#job-title')).toHaveValue('Min egen tittel');
  await expect(page.locator('#job-description')).toHaveValue('AI skrev denne beskrivelsen av oppdraget.');
  expect(calls.some((c) => c.pathname === '/api/ai/generate-full-listing')).toBe(true);
  expect(errors).toEqual([]);
});

test('"Dine utkast": typing saves a server draft, a listed draft opens, and can be deleted', async ({ page }) => {
  const errors = watchErrors(page);
  const { calls } = await mockApi(page, {
    as: 'user',
    routes: {
      'GET /api/job-drafts': () => ({ drafts: [{ _id: 'd1', title: 'Utkast fra mobilen', updatedAt: '2026-10-20T10:00:00Z' }] }),
      'GET /api/job-drafts/d1': () => ({ draft: { _id: 'd1', data: { title: 'Utkast fra mobilen', description: 'Skrevet på telefonen i går kveld.' } } }),
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
  await expect.poll(() => calls.filter((c) => c.method === 'POST' && c.pathname === '/api/job-drafts').length).toBe(1);
  expect(calls.find((c) => c.method === 'POST' && c.pathname === '/api/job-drafts').body.data.title).toBe('Vaske vinduer');

  // A listed draft opens in the form.
  await list.getByText('Utkast fra mobilen').click();
  await expect(page).toHaveURL(/\?utkast=d1$/);
  await expect(page.locator('#job-title')).toHaveValue('Utkast fra mobilen');

  await list.getByRole('button', { name: /Slett utkastet Utkast fra mobilen/ }).click();
  await expect.poll(() => calls.some((c) => c.method === 'DELETE' && c.pathname === '/api/job-drafts/d1')).toBe(true);
  expect(errors).toEqual([]);
});

test('address: one Kartverket search fills postnummer, sted, fylke and kommune, and they are published', async ({ page }) => {
  const errors = watchErrors(page);
  const full = {
    ...SERVICE, countyCode: '03', municipalityCode: '0301', images: ['https://example.test/a.jpg'],
    fromDate: '2026-11-01', toDate: '2026-11-02', duration: { value: 2, unit: 'hours' },
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
  await page.route('https://ws.geonorge.no/**', (route) => route.fulfill({
    json: { adresser: [{ adressetekst: 'Bryggen 1', postnummer: '5003', poststed: 'BERGEN', kommunenummer: '4601', kommunenavn: 'BERGEN', representasjonspunkt: { lat: 60.397, lon: 5.324 } }] },
  }));

  await page.goto(`/Publish-job/${SERVICE._id}`);
  await page.getByRole('button', { name: /Neste/ }).first().click();
  await expect(page.getByText('Steg 2 av 2')).toBeVisible();
  // No fylke/kommune dropdowns any more: the address decides them.
  await expect(page.locator('#job-county')).toHaveCount(0);

  await page.locator('#job-address').fill('Bryggen 1');
  await page.getByRole('option').getByText('Bryggen 1').click();
  await expect(page.getByText(/Lokasjon bekreftet · 5003 Bergen/)).toBeVisible();
  await expect(page.locator('#job-postal-code')).toHaveValue('5003');
  await expect(page.locator('#job-city')).toHaveValue('Bergen');

  await page.getByRole('button', { name: /Publiser oppdrag/ }).click();
  await expect.poll(() => calls.some((c) => c.method === 'PUT' && c.pathname === `/api/services/${SERVICE._id}`)).toBe(true);
  const sent = String(calls.find((c) => c.method === 'PUT' && c.pathname === `/api/services/${SERVICE._id}`).body);
  for (const [field, value] of [['location[postalCode]', '5003'], ['location[city]', 'Bergen'], ['countyCode', '46'], ['municipalityCode', '4601']]) {
    expect(sent).toMatch(new RegExp(`name="${field.replace(/[[\]]/g, '\\$&')}"\\r?\\n\\r?\\n${value}\\r?\\n`));
  }
  expect(errors).toEqual([]);
});

// BUG (a11y): OrderRequestModal (components/job/OrderRequestModal.tsx) has no role="dialog" /
// aria-modal / accessible name, and its close "X" button (line ~49) has no label.
test('the apply modal is an accessible dialog with a labelled close button', async ({ page }) => {
  await mockApi(page, { as: 'provider', routes: jobRoutes() });
  await page.goto(`/job-listing/${SERVICE._id}`);
  await page.getByRole('button', { name: 'Send forespørsel', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Send forespørsel' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Lukk/ })).toBeVisible();
});
