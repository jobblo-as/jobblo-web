import { test } from '@playwright/test';
import { expect, mockApi, shot, watchErrors } from './helpers/app.js';

/** Super Admin → Ordrer → one order: parties, money split, journey, timeline in Norwegian. */
test.describe.configure({ timeout: 120_000 });

const OID = '64c000000000000000000001';
const detail = {
  order: {
    _id: OID,
    status: 'completed',
    paymentStatus: 'paid',
    agreedPrice: 2400,
    checkoutAmountMinor: 240000,
    chatId: 'c1',
    createdAt: '2026-11-03T07:30:00.000Z',
    updatedAt: '2026-11-07T09:00:00.000Z',
    paymentConfirmedAt: '2026-11-03T08:00:00.000Z',
    startedAt: '2026-11-04T08:00:00.000Z',
    readyForReviewAt: '2026-11-06T15:00:00.000Z',
    completedAt: '2026-11-06T16:00:00.000Z',
    customer: {
      _id: 'u1',
      name: 'Eier Hansen',
      email: 'eier@example.test',
      phone: '+47 400 00 000',
    },
    provider: {
      _id: 'u2',
      name: 'Ola Nordmann',
      email: 'ola@example.test',
      connectAccount: true,
      payoutEnabled: true,
    },
    service: { _id: 's1', title: 'Male terrasse', status: 'closed' },
  },
  issues: [],
  payment: {
    status: 'succeeded',
    amount: 2400,
    stripePaymentIntentId: 'pi_test_123',
    createdAt: '2026-11-03T08:00:00.000Z',
  },
  payout: {
    status: 'transferred',
    grossAmount: 2400,
    platformFee: 240,
    netProviderAmount: 2160,
    releaseSource: 'customer_approval',
    stripeTransferId: 'tr_test_1',
    transferCompletedAt: '2026-11-07T09:00:00.000Z',
  },
  safePay: { status: 'completed', amounts: { totalCustomer: 2400, fee: 240, netProvider: 2160 } },
  disputes: [],
  operations: [],
  incidents: [],
  transfers: [],
  notifications: [
    {
      _id: 'n1',
      type: 'order_completed',
      content: 'Oppdraget er fullført',
      read: true,
      createdAt: '2026-11-06T16:00:00.000Z',
    },
  ],
  errors: [],
  timeline: [
    { at: '2026-11-03T07:30:00.000Z', source: 'order', title: 'Order created' },
    {
      at: '2026-11-03T08:00:00.000Z',
      source: 'stripe',
      title: 'Payment confirmed',
      tone: 'success',
    },
    {
      at: '2026-11-07T09:00:00.000Z',
      source: 'payout',
      title: 'Transfer completed',
      tone: 'success',
    },
  ],
};

test('order detail: who, the money split and the journey', async ({ page }) => {
  const errors = watchErrors(page);
  await mockApi(page, {
    as: 'superAdmin',
    routes: {
      [`GET /api/admin/orders/${OID}/details`]: () => ({ success: true, data: detail }),
    },
  });
  await page.goto(`/dashboard/orders/${OID}`);
  await expect(page.getByRole('heading', { name: 'Male terrasse' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Eier Hansen' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ola Nordmann' })).toBeVisible();
  await expect(page.getByText('Kunde betalte')).toBeVisible();
  await expect(page.getByText('2 160 kr').first()).toBeVisible();
  await expect(page.getByText('Utbetalt til tilbyder')).toBeVisible(); // timeline in Norwegian
  await expect(page.getByText('Ikke ennå')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Oppdrag' })).toHaveAttribute(
    'href',
    '/dashboard/services/s1'
  );
  await shot(page, 'admin-order-detail');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'admin-order-detail-mobile');
  expect(errors).toEqual([]);
});
