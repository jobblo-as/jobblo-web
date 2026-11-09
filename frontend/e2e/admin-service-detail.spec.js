import { test } from '@playwright/test';
import { expect, mockApi, shot, watchErrors } from './helpers/app.js';

/** Super Admin → Tjenester → one job: requests, award, payment, payout and the timeline. */
test.describe.configure({ timeout: 120_000 });

const ID = '64b000000000000000000001';
const person = (_id, name, email) => ({ _id, name, email });
const owner = person('u1', 'Eier Hansen', 'eier@example.test');
const ola = person('u2', 'Ola Nordmann', 'ola@example.test');
const kari = person('u3', 'Kari Berg', 'kari@example.test');

const activity = {
  service: {
    _id: ID,
    title: 'Male terrasse',
    status: 'closed',
    price: 2400,
    paymentType: 'Fastpris',
    categories: ['Maling'],
    location: { address: 'Borggata 8', city: 'Oslo' },
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-07T10:00:00.000Z',
    userId: owner,
  },
  stats: {
    requests: 2,
    pending: 0,
    accepted: 1,
    declined: 1,
    withdrawn: 0,
    orders: 1,
    paid: 1,
    favorites: 4,
    reports: 0,
    disputes: 0,
  },
  requests: [
    {
      _id: 'r1',
      providerId: ola,
      status: 'accepted',
      message: 'Kan gjøre det på lørdag.',
      createdAt: '2026-11-02T09:00:00.000Z',
    },
    {
      _id: 'r2',
      providerId: kari,
      status: 'declined',
      message: 'Ledig neste uke.',
      createdAt: '2026-11-02T12:00:00.000Z',
    },
  ],
  orders: [
    {
      _id: 'o1',
      providerId: ola,
      customerId: owner,
      status: 'completed',
      paymentStatus: 'paid',
      agreedPrice: 2400,
      paymentConfirmedAt: '2026-11-03T08:00:00.000Z',
      completedAt: '2026-11-06T16:00:00.000Z',
      createdAt: '2026-11-03T07:30:00.000Z',
    },
  ],
  payouts: [
    {
      _id: 'p1',
      orderId: 'o1',
      status: 'transferred',
      grossAmount: 2400,
      platformFee: 240,
      netProviderAmount: 2160,
      transferCompletedAt: '2026-11-07T09:00:00.000Z',
    },
  ],
  urgent: [
    {
      _id: 'h1',
      status: 'consumed',
      amountMinor: 4900,
      paidAt: '2026-11-01T10:05:00.000Z',
      createdAt: '2026-11-01T10:04:00.000Z',
    },
  ],
  extraContacts: [],
  reviews: [
    {
      _id: 'v1',
      reviewerId: owner,
      revieweeRole: 'seeker',
      rating: 5,
      comment: 'Veldig fornøyd',
      createdAt: '2026-11-07T10:00:00.000Z',
    },
  ],
  reports: [],
  disputes: [],
  timeline: [
    {
      at: '2026-11-01T10:00:00.000Z',
      kind: 'created',
      text: 'Oppdraget ble lagt ut av Eier Hansen',
    },
    { at: '2026-11-02T09:00:00.000Z', kind: 'request', text: 'Ola Nordmann sendte forespørsel' },
    { at: '2026-11-02T12:00:00.000Z', kind: 'request', text: 'Kari Berg sendte forespørsel' },
    { at: '2026-11-03T07:30:00.000Z', kind: 'order', text: 'Tildelt Ola Nordmann' },
    { at: '2026-11-03T08:00:00.000Z', kind: 'paid', text: 'Betaling mottatt (2400 kr)' },
    { at: '2026-11-07T09:00:00.000Z', kind: 'payout', text: 'Utbetalt 2160 kr til utfører' },
  ],
};

test('job detail shows who applied, who got it, payment and payout', async ({ page }) => {
  const errors = watchErrors(page);
  await mockApi(page, {
    as: 'superAdmin',
    routes: {
      'GET /api/admin/services': () => ({
        success: true,
        data: {
          services: [
            {
              _id: ID,
              title: 'Male terrasse',
              categories: ['Maling'],
              price: 2400,
              status: 'closed',
              views: 31,
              createdAt: '2026-11-01T10:00:00.000Z',
              userId: owner,
            },
          ],
        },
        pagination: { page: 1, limit: 20, total: 1, pages: 1 },
      }),
      [`GET /api/admin/services/${ID}/activity`]: () => ({ success: true, data: activity }),
    },
  });

  await page.goto('/dashboard/services');
  await page.getByRole('button', { name: 'Detaljer Male terrasse' }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/services/${ID}$`));
  await expect(page.getByRole('heading', { name: 'Male terrasse' })).toBeVisible();

  await expect(page.getByText('Kan gjøre det på lørdag.')).toBeVisible();
  await expect(page.getByText('Ledig neste uke.')).toBeVisible();
  await expect(page.getByText('Avslått', { exact: true })).toBeVisible();
  await expect(page.getByText('2160 kr til utfører')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ordre', exact: true })).toHaveAttribute(
    'href',
    '/dashboard/orders/o1'
  );
  await expect(page.getByText('Kunde betalte')).toBeVisible();
  await expect(page.getByText('Jobblo gebyr').first()).toBeVisible();
  await expect(page.getByText('Ikke ennå')).toHaveCount(0); // every step of the journey reached
  await expect(page.getByText('Veldig fornøyd')).toBeVisible();
  await shot(page, 'admin-service-detail');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'admin-service-detail-mobile');
  expect(errors).toEqual([]);
});
