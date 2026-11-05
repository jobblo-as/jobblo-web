import { test } from '@playwright/test';
import { expect, mockApi, shot, watchErrors, USERS } from './helpers/app.js';

/** Profile edit and notifications, on a mocked API. (Membership: membership.spec.js.) */

test.describe.configure({ timeout: 120_000 });

test('profile edit: only the changed field is sent', async ({ page }) => {
  const errors = watchErrors(page);
  const { calls } = await mockApi(page, {
    as: { ...USERS.user, lastName: 'Kunde' },
    routes: {
      [`PUT /api/users/${USERS.user._id}`]: ({ body, state }) => {
        Object.assign(state.session, body);
        return state.session;
      },
    },
  });
  await page.goto('/settings/name');
  const save = page.getByRole('button', { name: 'Lagre endringer' });
  const first = page.getByLabel('Fornavn');
  await expect(first).toHaveValue(USERS.user.name);
  await expect(save).toBeDisabled(); // nothing changed yet
  await first.fill('Kari');
  await save.click();
  await expect.poll(() => calls.find((c) => c.method === 'PUT')?.body).toEqual({ name: 'Kari' });
  expect(calls.find((c) => c.method === 'PUT').pathname).toBe(`/api/users/${USERS.user._id}`);
  expect(errors).toEqual([]);
});

test('addresses: the land is saved by itself with a typed address, no Land field', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const { calls } = await mockApi(page, {
    as: { ...USERS.user, address: '', postNumber: '', postSted: '', country: '' },
    routes: {
      [`PUT /api/users/${USERS.user._id}`]: ({ body, state }) => {
        Object.assign(state.session, body);
        return state.session;
      },
    },
  });
  await page.goto('/settings/addresses');
  // The four fields: Adresse (search), Gateadresse, Postnr., Sted — and no Land.
  await expect(page.locator('#address-search')).toBeVisible();
  await expect(page.getByLabel('Gateadresse')).toBeVisible();
  await expect(page.getByLabel('Land')).toHaveCount(0);

  await page.getByLabel('Postnr.').fill('0150');
  await page.getByLabel('Sted').fill('Oslo');
  await page.getByRole('button', { name: 'Lagre adresser' }).click();
  await expect
    .poll(() => calls.find((c) => c.method === 'PUT')?.body)
    .toEqual({ postNumber: '0150', postSted: 'Oslo', country: 'Norge' });
  expect(errors).toEqual([]);

  // The separate "Lokasjon" page is gone.
  await expect(page.getByRole('link', { name: 'Lokasjon' })).toHaveCount(0);
});

test('addresses: the street is searched in Kartverket and a suggestion fills the rest', async ({
  page,
}) => {
  const { calls } = await mockApi(page, {
    as: { ...USERS.user, address: '', postNumber: '', postSted: '', country: '' },
    routes: {
      [`PUT /api/users/${USERS.user._id}`]: ({ body, state }) => {
        Object.assign(state.session, body);
        return state.session;
      },
    },
  });
  await page.route('https://ws.geonorge.no/**', (route) =>
    route.fulfill({
      json: {
        adresser: [
          {
            adressetekst: 'Borggata 8',
            postnummer: '0650',
            poststed: 'OSLO',
            kommunenummer: '0301',
            kommunenavn: 'OSLO',
            representasjonspunkt: { lat: 59.909, lon: 10.778 },
          },
        ],
      },
    })
  );
  await page.goto('/settings/addresses');
  await page.locator('#address-search').fill('Borg');
  await page.getByRole('option').getByText('Borggata 8').click();
  await expect(page.getByLabel('Gateadresse')).toHaveValue('Borggata 8');
  await expect(page.getByLabel('Postnr.')).toHaveValue('0650');
  await expect(page.getByLabel('Sted')).toHaveValue('Oslo');
  await expect(page.getByText('Adressen er funnet', { exact: true })).toBeVisible();
  // The search shows the whole address, Gateadresse only the street — not the same text twice.
  await expect(page.locator('#address-search')).toHaveValue('Borggata 8, 0650 Oslo');
  // Not offered its own address back as "Mine adresser".
  await page.locator('#address-search').fill('Borggata');
  await expect(page.getByRole('option').filter({ hasText: 'Mine adresser' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Lagre adresser' }).click();
  await expect
    .poll(() => calls.find((c) => c.method === 'PUT')?.body)
    .toEqual({ address: 'Borggata 8', postNumber: '0650', postSted: 'Oslo', country: 'Norge' });
});

test('addresses: a saved address is looked up once for the map pin', async ({ page }) => {
  await mockApi(page, {
    as: { ...USERS.user, address: 'Rolf Hofmos gate 30', postNumber: '0655', postSted: 'Oslo' },
  });
  const searched = [];
  await page.route('https://ws.geonorge.no/**', (route) => {
    const q = new URL(route.request().url()).searchParams;
    searched.push([q.get('sok'), q.get('postnummer')]);
    return route.fulfill({ json: { adresser: [] } });
  });
  await page.goto('/settings/addresses');
  await expect(page.locator('#address-search')).toHaveValue('Rolf Hofmos gate 30, 0655 Oslo');
  await expect.poll(() => searched).toContainEqual(['Rolf Hofmos gate 30', '0655']);
});

test('notifications: listed, and "mark all as read" clears the unread count', async ({ page }) => {
  const errors = watchErrors(page);
  const items = [
    {
      _id: 'n1',
      type: 'message',
      content: 'Ny melding fra TEST Provider',
      read: false,
      createdAt: new Date().toISOString(),
    },
    {
      _id: 'n2',
      type: 'order',
      content: 'Oppdraget ditt er betalt',
      read: true,
      createdAt: '2026-10-20T10:00:00.000Z',
    },
  ];
  const { calls } = await mockApi(page, {
    as: 'user',
    routes: {
      'GET /api/notifications': () => ({ data: items, currentPage: 1, totalPages: 1 }),
      'GET /api/notifications/unread-count': () => ({ count: items.filter((n) => !n.read).length }),
      'PUT /api/notifications/read-all': () => {
        items.forEach((n) => {
          n.read = true;
        });
        return { success: true };
      },
    },
  });
  await page.goto('/alerts');
  await expect(page.getByText('Ny melding fra TEST Provider')).toBeVisible();
  await expect(page.getByText('Oppdraget ditt er betalt')).toBeVisible();
  await expect(page.getByText('1 uleste varsler')).toBeVisible();
  await page.getByRole('button', { name: 'Merk alle som lest' }).click();
  await expect(page.getByText('Alt er lest')).toBeVisible();
  expect(
    calls.some((c) => c.method === 'PUT' && c.pathname === '/api/notifications/read-all')
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('Abonnementer: a purchase opens to its details, a refunded Hast says when and why', async ({
  page,
}) => {
  const day = (n) => new Date(Date.now() - n * 86400e3).toISOString();
  await mockApi(page, {
    as: 'user',
    routes: {
      '/api/stripe/subscription': () => ({ subscription: null }),
      '~GET ^/api/transactions/user$': () => ({
        transactions: [
          {
            _id: 'tx-hast',
            planName: 'Hast',
            amount: 39,
            currency: 'nok',
            status: 'refunded',
            type: 'urgent',
            createdAt: day(4),
            serviceId: null,
            refundedAt: day(1),
            refundReason: 'Oppdraget ble ikke publisert, så Hast ble ikke brukt.',
          },
          {
            _id: 'tx-hast-2',
            planName: 'Hast',
            amount: 39,
            currency: 'nok',
            status: 'succeeded',
            type: 'urgent',
            createdAt: day(2),
            serviceId: { _id: '64b000000000000000000001', title: 'TEST Male stue' },
          },
        ],
        totalPages: 1,
      }),
    },
  });
  await page.goto('/settings/subscriptions');
  const refunded = page.getByRole('button', { name: /Hast.*Refundert/ });
  await expect(refunded).toHaveAttribute('aria-expanded', 'false');
  await refunded.click();
  await expect(refunded).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.getByText('Hvorfor: Oppdraget ble ikke publisert, så Hast ble ikke brukt.')
  ).toBeVisible();
  await expect(page.getByText('Ikke publisert', { exact: true })).toBeVisible();
  // No plan: no endless "Laster kontaktinformasjon…".
  await expect(page.getByText(/Laster kontaktinformasjon/)).toHaveCount(0);
  await shot(page, 'abonnementer-refundert');
  // One open at a time; the paid one names its job.
  await page.getByRole('button', { name: /Hast.*Fullført/ }).click();
  await expect(page.getByText(/Hvorfor:/)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'TEST Male stue' })).toBeVisible();
});
