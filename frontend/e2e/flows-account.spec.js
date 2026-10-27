import { test } from '@playwright/test';
import { expect, mockApi, watchErrors, USERS } from './helpers/app.js';

/** Profile edit and notifications, on a mocked API. (Membership: membership.spec.js.) */

test.describe.configure({ timeout: 120_000 });

test('profile edit: only the changed field is sent', async ({ page }) => {
  const errors = watchErrors(page);
  const { calls } = await mockApi(page, {
    as: { ...USERS.user, lastName: 'Kunde' },
    routes: {
      [`PUT /api/users/${USERS.user._id}`]: ({ body, state }) => { Object.assign(state.session, body); return state.session; },
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
    { _id: 'n1', type: 'message', content: 'Ny melding fra TEST Provider', read: false, createdAt: new Date().toISOString() },
    { _id: 'n2', type: 'order', content: 'Oppdraget ditt er betalt', read: true, createdAt: '2026-10-20T10:00:00.000Z' },
  ];
  const { calls } = await mockApi(page, {
    as: 'user',
    routes: {
      'GET /api/notifications': () => ({ data: items, currentPage: 1, totalPages: 1 }),
      'GET /api/notifications/unread-count': () => ({ count: items.filter((n) => !n.read).length }),
      'PUT /api/notifications/read-all': () => { items.forEach((n) => { n.read = true; }); return { success: true }; },
    },
  });
  await page.goto('/alerts');
  await expect(page.getByText('Ny melding fra TEST Provider')).toBeVisible();
  await expect(page.getByText('Oppdraget ditt er betalt')).toBeVisible();
  await expect(page.getByText('1 uleste varsler')).toBeVisible();
  await page.getByRole('button', { name: 'Merk alle som lest' }).click();
  await expect(page.getByText('Alt er lest')).toBeVisible();
  expect(calls.some((c) => c.method === 'PUT' && c.pathname === '/api/notifications/read-all')).toBe(true);
  expect(errors).toEqual([]);
});
