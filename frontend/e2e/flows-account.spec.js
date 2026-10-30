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
