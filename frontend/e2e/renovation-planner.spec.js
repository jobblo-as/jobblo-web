import { test } from '@playwright/test';
import { API, expect, mockApi, shot, watchErrors } from './helpers/app.js';

/**
 * Renovation planner ("Oppussingskalkulator"): describe the home, pick areas, scope, quality
 * and budget, get an estimate from the real pricing config, and turn it into job drafts.
 */

/** The estimate and catalogue are pure arithmetic: answered by the real e2e backend. */
const realBackend = (page) => ({
  'GET /api/renovation/catalogue': async () =>
    (await page.request.get(`${API}/api/renovation/catalogue`)).json(),
  'POST /api/renovation/estimate': async ({ body }) =>
    (await page.request.post(`${API}/api/renovation/estimate`, { data: body })).json(),
});

test('anonymous: estimate, over budget, apply a saving', async ({ page }) => {
  const errors = watchErrors(page);
  await mockApi(page, { routes: realBackend(page) });
  await page.goto('/oppussingskalkulator');

  await expect(page.getByRole('heading', { name: /Hva koster oppussingen/ })).toBeVisible();
  await page.getByLabel('Størrelse').fill('75');
  await page.getByRole('button', { name: 'Bad', exact: true }).click();
  await page.getByRole('button', { name: 'Kjøkken', exact: true }).click();
  // Scope per area: the kitchen goes full.
  const kitchenRow = page.locator('li', { hasText: 'Kjøkken' }).first();
  await kitchenRow.getByRole('button', { name: 'Total' }).click();
  await page.getByRole('button', { name: 'God', exact: true }).click();
  // The site's dropdown (as on Mine annonser): open, pick, and the trigger shows the choice.
  await page.getByLabel('Kvalitet for bad').click();
  await expect(page.getByRole('option', { name: 'Kvalitet som resten' })).toBeVisible();
  // Viewport only: a full-page shot resizes the window, which closes a Radix select.
  if (process.env.E2E_SHOTS)
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/renovation-planner-select-open.png` });
  await page.getByRole('option', { name: 'Premium' }).click();
  await expect(page.getByLabel('Kvalitet for bad')).toHaveText('Premium');
  await page.getByLabel('Boligtype').click();
  await page.getByRole('option', { name: 'Enebolig' }).click();
  await expect(page.getByLabel('Boligtype')).toHaveText('Enebolig');
  await page.getByLabel('Hvor mye vil du bruke?').fill('100 000');
  await page.getByRole('button', { name: 'Beregn estimat' }).click();

  const result = page.locator('#estimate');
  await expect(result.getByText(/^Over budsjettet på 100\s000 kr/)).toBeVisible();
  await expect(result.getByText('Legges ut som anbud').first()).toBeVisible();
  await expect(result.getByText(/Estimatet er veiledende/)).toBeVisible();
  const before = await result.locator('#estimate-heading').innerText();

  const saving = result.locator('li', { hasText: 'Overflate i stedet for total på kjøkken' });
  await saving.getByRole('button', { name: 'Bruk' }).click();
  await expect(result.locator('#estimate-heading')).not.toHaveText(before);
  await expect(
    page.locator('li', { hasText: 'Kjøkken' }).first().getByRole('button', { name: 'Overflate' })
  ).toHaveAttribute('aria-pressed', 'true');

  await expect(
    page.getByRole('button', { name: 'Logg inn for å legge ut som oppdrag' })
  ).toBeVisible();
  await shot(page, 'renovation-planner-estimate');
  expect(errors).toEqual([]);
});

test('signed in: AI reads the listing, the plan becomes one draft per area', async ({ page }) => {
  const drafts = [];
  const uploads = [];
  const updates = [];
  await mockApi(page, {
    as: 'user',
    routes: {
      ...realBackend(page),
      'POST /api/ai/renovation-facts': () => ({
        success: true,
        facts: {
          sizeM2: 82,
          rooms: 3,
          bathrooms: 1,
          yearBuilt: 1978,
          homeType: 'leilighet',
          standardNotes: [{ area: 'kitchen', text: 'Originalt kjøkken fra 1985' }],
          outdatedAreas: ['kitchen', 'bathroom'],
          // Photo 1 shows the kitchen, photo 2 the whole home.
          photoAreas: ['kitchen', null],
        },
      }),
      'POST /api/job-drafts': ({ body }) => {
        drafts.push(body.data);
        return { draft: { _id: `64d00000000000000000000${drafts.length}` } };
      },
      '~POST ^/api/job-drafts/[^/]+/images$': ({ url }) => {
        const id = url.pathname.split('/')[3];
        uploads.push(id);
        return { url: `https://img.example.test/${id}-${uploads.length}.jpg` };
      },
      '~PUT ^/api/job-drafts/[^/]+$': ({ url, body }) => {
        const id = url.pathname.split('/')[3];
        updates.push({ id, data: body.data });
        return { draft: { _id: id } };
      },
    },
  });
  await page.goto('/oppussingskalkulator');

  await page
    .getByPlaceholder(/Kopier beskrivelsen/)
    .fill('Pen 3-roms leilighet på 82 kvm fra 1978. Originalt kjøkken fra 1985.');
  const png = (name) => ({
    name,
    mimeType: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
  });
  await page
    .locator('input[type=file][multiple]')
    .setInputFiles([png('kjokken.png'), png('stue.png')]);
  await page.getByRole('button', { name: 'Les annonsen med AI' }).click();
  // The AI's photo areas are shown and can be changed.
  await expect(page.getByLabel('Rom for kjokken.png')).toHaveText('Kjøkken');
  await expect(page.getByLabel('Rom for stue.png')).toHaveText('Hele boligen');
  // Tiles as on the job form: order them, and the order goes with the jobs.
  await page.getByRole('button', { name: 'Flytt bilde 2 til venstre' }).click();
  await expect(page.getByLabel('Bilder i rekkefølge').getByRole('img').first()).toHaveAttribute(
    'alt',
    'Bilde 1'
  );
  await shot(page, 'renovation-planner-photo-tiles');
  await expect(page.getByLabel('Størrelse')).toHaveValue('82');
  await expect(page.getByLabel('Byggeår')).toHaveValue('1978');
  await expect(page.getByText('Originalt kjøkken fra 1985', { exact: true })).toBeVisible();
  // Outdated areas are pre-selected.
  await expect(page.getByRole('button', { name: 'Kjøkken', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByRole('button', { name: 'Bad', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  await page.getByRole('button', { name: 'Beregn estimat' }).click();
  await page.getByRole('button', { name: 'Legg ut som oppdrag' }).click();
  // What was saved, in a dialog: each draft with its price type and photos.
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText('2 oppdrag er lagret som utkast')).toBeVisible();
  await expect(dialog.getByText(/^Anbud · antatt budsjett/)).toBeVisible();
  await expect(dialog.getByText(/^Fastpris · /)).toBeVisible();
  if (process.env.E2E_SHOTS)
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/renovation-drafts-dialog.png` });
  await dialog.getByRole('button', { name: 'Gå til utkastene' }).click();
  await expect(page).toHaveURL(/\/Publish-job\?utkast=64d000000000000000000001/);
  // The publish page links back to the planner.
  await expect(page.getByRole('link', { name: /Skal du pusse opp\?/ })).toHaveAttribute(
    'href',
    '/oppussingskalkulator'
  );
  await shot(page, 'renovation-planner-publish-link');

  expect(drafts).toHaveLength(2);
  const bathroom = drafts.find((d) => d.title.includes('bad'));
  const kitchen = drafts.find((d) => d.title.includes('kjøkken'));
  expect(bathroom).toMatchObject({ categories: 'Oppussing', paymentType: 'Anbud' });
  expect(Number(bathroom.price)).toBeGreaterThan(0);
  expect(bathroom.description).toMatch(/sertifisert fagperson/);
  expect(kitchen).toMatchObject({ paymentType: 'Fastpris' });
  expect(kitchen.description).toContain('Originalt kjøkken fra 1985');

  // Photos go with the jobs: the kitchen photo only on the kitchen job, the whole-home
  // photo on both. Each is stored with its draft, then the draft is saved with its URLs.
  const idOf = (draft) => `64d00000000000000000000${drafts.indexOf(draft) + 1}`;
  const photosOn = (draft) =>
    Object.values(updates.find((u) => u.id === idOf(draft))?.data.draftImageUrls ?? {});
  expect(uploads.filter((id) => id === idOf(kitchen))).toHaveLength(2);
  expect(uploads.filter((id) => id === idOf(bathroom))).toHaveLength(1);
  expect(photosOn(kitchen)).toHaveLength(2);
  expect(photosOn(bathroom)).toHaveLength(1);
  expect(updates.find((u) => u.id === idOf(kitchen)).data.title).toBe(kitchen.title);
});

test('signed in: FINN link, prospectus and photos, save, share, and the shared page', async ({
  page,
}) => {
  const factsCalls = [];
  const saved = [];
  const SHARE_ID = 'AbCdEfGhIjKlMnOp';
  const estimateFor = async (body) =>
    (await page.request.post(`${API}/api/renovation/estimate`, { data: body })).json();

  await mockApi(page, {
    as: 'user',
    routes: {
      ...realBackend(page),
      'POST /api/ai/renovation-facts': ({ request }) => {
        factsCalls.push({
          type: request.headers()['content-type'] || '',
          body: request.postDataBuffer()?.toString('latin1') || '',
        });
        return {
          success: true,
          facts: {
            sizeM2: 82,
            rooms: 3,
            bathrooms: 1,
            yearBuilt: 1978,
            homeType: 'leilighet',
            standardNotes: [{ area: 'bathroom', text: 'Badet på bildene ser slitt ut' }],
            outdatedAreas: ['bathroom'],
          },
        };
      },
      'GET /api/renovation/plans': () => ({
        plans: saved.map((p) => ({ ...p, total: { low: 1000, high: 2000 } })),
      }),
      'POST /api/renovation/plans': async ({ body }) => {
        const plan = {
          _id: '64e000000000000000000001',
          shareId: null,
          title: body.title,
          updatedAt: '2026-11-23T10:00:00.000Z',
          body,
        };
        saved.push(plan);
        return { plan: { ...plan, estimate: await estimateFor(body) } };
      },
      '~POST ^/api/renovation/plans/[^/]+/share$': () => {
        saved[0].shareId = SHARE_ID;
        return { shareId: SHARE_ID };
      },
      [`GET /api/renovation/shared/${SHARE_ID}`]: async () => {
        const { body } = saved[0];
        const estimate = await estimateFor(body);
        return {
          plan: {
            title: body.title,
            plan: {
              facts: estimate.facts,
              quality: body.quality,
              areas: estimate.areas.map((a) => ({
                key: a.key,
                scope: a.scope,
                quality: a.quality,
              })),
              budget: body.budget,
            },
            yearBuilt: 1978,
            homeType: body.facts.homeType,
            notes: body.notes,
            finnCode: '412345678',
            updatedAt: '2026-11-23T10:00:00.000Z',
            estimate,
          },
        };
      },
      'GET /api/renovation/shared/missingmissing00': () => ({
        status: 404,
        json: { error: 'Fant ikke planen.' },
      }),
    },
  });
  await page.goto('/oppussingskalkulator');

  // FINN: the link only opens the listing; nothing is fetched from FINN.
  await page
    .getByLabel(/FINN-lenke eller FINN-kode/)
    .fill('https://www.finn.no/realestate/homes/ad.html?finnkode=412345678');
  await expect(page.getByRole('link', { name: /Åpne annonsen på FINN/ })).toHaveAttribute(
    'href',
    'https://www.finn.no/412345678'
  );

  await page.locator('input[type=file][accept="application/pdf"]').setInputFiles({
    name: 'prospekt.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n<< /Type /Page >>\n'),
  });
  await page.locator('input[type=file][multiple]').setInputFiles({
    name: 'bad.png',
    mimeType: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
  });
  await expect(page.getByText('prospekt.pdf')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fjern bad.png' })).toBeVisible();

  // No text at all: the files alone are enough for the AI.
  await page.getByRole('button', { name: 'Les annonsen med AI' }).click();
  await expect(page.getByLabel('Størrelse')).toHaveValue('82');
  await expect(page.getByLabel('Boligtype')).toHaveText('Leilighet');
  expect(factsCalls).toHaveLength(1);
  expect(factsCalls[0].type).toContain('multipart/form-data');
  expect(factsCalls[0].body).toContain('name="prospectus"; filename="prospekt.pdf"');
  expect(factsCalls[0].body).toContain('name="images"; filename="bad.png"');
  await expect(page.getByRole('button', { name: 'Bad', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  await page.getByRole('button', { name: 'Beregn estimat' }).click();
  await page.getByLabel('Navn på planen').fill('Leiligheten på Grünerløkka');
  await page.getByRole('button', { name: 'Lagre plan' }).click();
  await expect(page.getByRole('button', { name: 'Lagre endringer' })).toBeVisible();
  expect(saved[0].body).toMatchObject({
    title: 'Leiligheten på Grünerløkka',
    finnCode: 'https://www.finn.no/realestate/homes/ad.html?finnkode=412345678',
    facts: { sizeM2: 82, yearBuilt: 1978, homeType: 'leilighet' },
    areas: [{ key: 'bathroom', scope: 'surface' }],
  });
  await expect(page.getByRole('heading', { name: 'Mine planer' })).toBeVisible();

  await page.getByRole('button', { name: 'Del plan' }).click();
  await expect(page.getByLabel('Delingslenke')).toHaveValue(
    new RegExp(`/oppussingskalkulator/delt/${SHARE_ID}$`)
  );
  await shot(page, 'renovation-planner-saved-shared');

  // The shared page: read-only, no "Bruk", and copying it starts a new plan of your own.
  await page.goto(`/oppussingskalkulator/delt/${SHARE_ID}`);
  await expect(page.getByRole('heading', { name: 'Leiligheten på Grünerløkka' })).toBeVisible();
  await expect(page.getByText('Badet på bildene ser slitt ut')).toBeVisible();
  await expect(page.getByText(/^Leilighet · 82 m²/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Se boligannonsen på FINN/ })).toHaveAttribute(
    'href',
    'https://www.finn.no/412345678'
  );
  await expect(page.getByRole('button', { name: 'Bruk' })).toHaveCount(0);
  await shot(page, 'renovation-planner-shared-page');
  await page.getByRole('button', { name: 'Lag din egen plan fra denne' }).click();
  await expect(page).toHaveURL(/\/oppussingskalkulator$/);
  await expect(page.getByLabel('Størrelse')).toHaveValue('82');
  await expect(page.getByLabel('Boligtype')).toHaveText('Leilighet');
  await page.getByRole('button', { name: 'Beregn estimat' }).click();
  await expect(page.getByRole('button', { name: 'Lagre plan' })).toBeVisible();

  await page.goto('/oppussingskalkulator/delt/missingmissing00');
  await expect(page.getByText('Planen finnes ikke, eller den deles ikke lenger.')).toBeVisible();
});
