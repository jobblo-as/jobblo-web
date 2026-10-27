import { test } from '@playwright/test';
import { expect, mockApi, watchErrors, SERVICE, USERS } from './helpers/app.js';

/**
 * The SafePay journey on a mocked API: pick an applicant (contract), chat, pay (Stripe
 * redirect stubbed), provider starts and delivers, customer approves with a review or
 * opens a dispute, and an admin resolves it.
 */

test.describe.configure({ timeout: 120_000 });

const ORDER_ID = '64d000000000000000000001';
const CHAT_ID = '64e000000000000000000001';
const customer = { ...USERS.user, lastName: 'Kunde' };
const provider = { ...USERS.provider, lastName: 'Utfører', averageRating: 4.5 };
const calculation = { basePrice: 3000, fee: 90, total: 3090, providerNet: 2910 };
const order = (status, over = {}) => ({
  _id: ORDER_ID, status, paymentStatus: ['awaiting_payment'].includes(status) ? 'pending' : 'paid',
  serviceId: SERVICE, customerId: customer, providerId: provider, agreedPrice: 3000,
  checklist: [], history: [], beforeImages: [], afterImages: [], chatId: CHAT_ID,
  createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-21T10:00:00.000Z', ...over,
});

test('customer picks an applicant: contract is created and checkout opens', async ({ page }) => {
  const errors = watchErrors(page);
  const applicant = { _id: 'req-1', status: 'pending', message: 'Jeg kan!', applicant: { ...provider }, createdAt: '2026-10-20T11:00:00.000Z' };
  const { calls } = await mockApi(page, {
    as: 'user',
    routes: {
      [`GET /api/applicants/${SERVICE._id}`]: () => ({ service: SERVICE, applicants: [applicant], activeOrder: null }),
      'POST /api/safepay/create-contract': () => ({ orderId: ORDER_ID }),
      [`GET /api/safepay-checkout/details/${ORDER_ID}`]: () => ({ order: order('awaiting_payment'), calculation }),
    },
  });
  await page.goto(`/job-applicants/${SERVICE._id}`);
  await expect(page.getByText(provider.name).first()).toBeVisible();
  await page.getByRole('button', { name: 'Velg og start SafePay' }).click();
  await expect(page).toHaveURL(new RegExp(`/safepay/checkout/${ORDER_ID}$`));
  expect(calls.find((c) => c.pathname === '/api/safepay/create-contract').body).toEqual({ serviceId: SERVICE._id, applicantId: provider._id, requestId: 'req-1' });
  await expect(page.getByText('3 090 kr').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('customer starts a chat with an applicant and sends a message', async ({ page }) => {
  const errors = watchErrors(page);
  const applicant = { _id: 'req-1', status: 'pending', applicant: { ...provider }, createdAt: '2026-10-20T11:00:00.000Z' };
  const messages = [];
  const chat = () => ({ _id: CHAT_ID, clientId: customer, providerId: provider, serviceId: SERVICE, messages: [...messages], status: 'requested', updatedAt: '2026-10-21T10:00:00.000Z' });
  const { calls } = await mockApi(page, {
    as: 'user',
    routes: {
      [`GET /api/applicants/${SERVICE._id}`]: () => ({ service: SERVICE, applicants: [applicant], activeOrder: null }),
      'POST /api/chats/create': () => chat(),
      'GET /api/chats/get': () => [chat()],
      [`GET /api/chats/${CHAT_ID}`]: () => chat(),
      [`POST /api/chats/${CHAT_ID}/message`]: ({ body }) => {
        const m = { _id: `m${messages.length}`, senderId: customer._id, text: body.text, createdAt: new Date().toISOString(), type: 'text' };
        messages.push(m);
        return m;
      },
    },
  });
  await page.goto(`/job-applicants/${SERVICE._id}`);
  await page.getByRole('button', { name: 'Send melding' }).click();
  await expect(page).toHaveURL(new RegExp(`/messages/${CHAT_ID}$`));
  expect(calls.find((c) => c.pathname === '/api/chats/create').body).toEqual({ providerId: provider._id, serviceId: SERVICE._id });
  const input = page.getByPlaceholder('Skriv en melding…');
  await input.fill('Hei! Når kan du starte?');
  await input.press('Enter');
  await expect(page.getByText('Hei! Når kan du starte?').first()).toBeVisible();
  expect(calls.find((c) => c.pathname === `/api/chats/${CHAT_ID}/message`).body).toEqual({ text: 'Hei! Når kan du starte?' });
  expect(errors).toEqual([]);
});

test('SafePay checkout sends the customer to Stripe', async ({ page }) => {
  const errors = watchErrors(page);
  const { calls } = await mockApi(page, {
    as: 'user',
    routes: {
      [`GET /api/safepay-checkout/details/${ORDER_ID}`]: () => ({ order: order('awaiting_payment'), calculation }),
      // A local stand-in for Stripe's hosted Checkout page.
      'POST /api/safepay-checkout/create-session': () => ({ url: `${new URL(page.url()).origin}/mock-stripe-checkout`, sessionId: 'cs_test_1' }),
    },
  });
  await page.goto(`/safepay/checkout/${ORDER_ID}`);
  await expect(page.getByText(SERVICE.title).first()).toBeVisible();
  await page.getByRole('button', { name: /Bekreft og betal/ }).click();
  await page.waitForURL('**/mock-stripe-checkout');
  expect(calls.find((c) => c.pathname === '/api/safepay-checkout/create-session').body).toEqual({ orderId: ORDER_ID });
  expect(errors).toEqual([]);
});

test('a paid order shows no payment button', async ({ page }) => {
  await mockApi(page, { as: 'user', routes: { [`GET /api/safepay-checkout/details/${ORDER_ID}`]: () => ({ order: order('paid'), calculation }) } });
  await page.goto(`/safepay/checkout/${ORDER_ID}`);
  await expect(page.getByText(SERVICE.title).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Bekreft og betal/ })).toHaveCount(0);
});

test('provider starts the job, then marks it done', async ({ page }) => {
  const errors = watchErrors(page);
  let status = 'paid';
  const { calls } = await mockApi(page, {
    as: 'provider',
    routes: {
      [`GET /api/safepay/orders/${ORDER_ID}`]: () => ({ order: order(status), calculation, isProvider: true, isCustomer: false, activeDispute: null }),
      [`POST /api/safepay/orders/${ORDER_ID}/start`]: () => { status = 'in_progress'; return { success: true }; },
      [`POST /api/safepay/orders/${ORDER_ID}/ready-for-review`]: () => { status = 'ready_for_review'; return { success: true }; },
    },
  });
  await page.goto(`/provider/orders/${ORDER_ID}`);
  await page.getByRole('button', { name: 'Start jobben' }).click();
  await expect(page.getByText('Jobb startet!')).toBeVisible();
  await page.getByRole('button', { name: 'Meld jobb som ferdig' }).click();
  await expect(page.getByText('Meldt ferdig!')).toBeVisible();
  await expect(page.getByText(/venter på godkjenning fra oppdragsgiver/)).toBeVisible();
  expect(calls.filter((c) => c.method === 'POST' && c.pathname.startsWith('/api/safepay/')).map((c) => c.pathname)).toEqual([
    `/api/safepay/orders/${ORDER_ID}/start`, `/api/safepay/orders/${ORDER_ID}/ready-for-review`,
  ]);
  expect(errors).toEqual([]);
});

test('provider reviews the customer after completion', async ({ page }) => {
  const reviews = [];
  const { calls } = await mockApi(page, {
    as: 'provider',
    routes: {
      [`GET /api/safepay/orders/${ORDER_ID}`]: () => ({ order: order('completed'), calculation, isProvider: true, isCustomer: false, activeDispute: null }),
      [`GET /api/orders/${ORDER_ID}/review`]: () => reviews,
      'POST /api/reviews': ({ body }) => { reviews.push({ ...body, reviewerId: provider._id }); return { success: true }; },
    },
  });
  await page.goto(`/provider/orders/${ORDER_ID}`);
  await page.getByRole('button', { name: 'Vurder oppdragsgiver' }).click();
  const send = page.getByRole('button', { name: 'Send vurdering' });
  await expect(send).toBeDisabled();
  // The five stars have no accessible name (see report); pick the fourth by position.
  await page.getByText('Helhetlig opplevelse').locator('..').getByRole('button').nth(3).click();
  await page.getByPlaceholder('Skriv en anmeldelse...').fill('Ryddig og hyggelig kunde.');
  await send.click();
  await expect(page.getByText('Du har vurdert oppdragsgiver')).toBeVisible();
  expect(calls.find((c) => c.pathname === '/api/reviews').body).toMatchObject({
    orderId: ORDER_ID, revieweeId: customer._id, revieweeRole: 'seeker', rating: 4, comment: 'Ryddig og hyggelig kunde.',
  });
});

// BUG (a11y): the provider's star-rating buttons are icon-only <button>s with no
// accessible name, so a screen reader announces five unlabeled "button"s.
test('provider review stars have accessible names', async ({ page }) => {
  await mockApi(page, {
    as: 'provider',
    routes: { [`GET /api/safepay/orders/${ORDER_ID}`]: () => ({ order: order('completed'), calculation, isProvider: true, isCustomer: false, activeDispute: null }) },
  });
  await page.goto(`/provider/orders/${ORDER_ID}`);
  await page.getByRole('button', { name: 'Vurder oppdragsgiver' }).click();
  await expect(page.getByRole('button', { name: /4/ })).toHaveCount(1);
});

test('customer approves the delivered job with a rating', async ({ page }) => {
  const errors = watchErrors(page);
  const { calls } = await mockApi(page, {
    as: 'user',
    routes: {
      [`GET /api/safepay-checkout/details/${ORDER_ID}`]: () => ({ order: order('ready_for_review'), calculation }),
      'POST /api/safepay-checkout/approve': () => ({ success: true }),
    },
  });
  await page.goto(`/safepay/approval/${ORDER_ID}`);
  const approve = page.getByRole('button', { name: /Godkjenn jobb og utbetal 2910 kr/ });
  await approve.click();
  await expect(page.getByText('Vennligst gi en helhetlig vurdering (1-5 stjerner)').first()).toBeVisible();
  expect(calls.some((c) => c.pathname === '/api/safepay-checkout/approve')).toBe(false);
  await page.getByRole('radiogroup', { name: 'Vurdering' }).first().getByLabel(/Gi 5 av 5 stjerner/).click();
  await approve.click();
  await expect(page.getByText('Jobb godkjent!').first()).toBeVisible();
  expect(calls.find((c) => c.pathname === '/api/safepay-checkout/approve').body).toMatchObject({ orderId: ORDER_ID, ratings: { overall: 5 } });
  expect(errors).toEqual([]);
});

test('customer opens a dispute instead of approving', async ({ page }) => {
  const errors = watchErrors(page);
  const { calls } = await mockApi(page, {
    as: 'user',
    routes: {
      [`GET /api/safepay-checkout/details/${ORDER_ID}`]: () => ({ order: order('ready_for_review'), calculation }),
      [`POST /api/safepay/contract/${ORDER_ID}/dispute`]: () => ({ success: true, dispute: { _id: 'disp-1', status: 'open' } }),
    },
  });
  await page.goto(`/safepay/approval/${ORDER_ID}`);
  await page.getByRole('button', { name: /Ikke fornøyd\? Opprett en tvist/ }).click();
  await page.getByRole('button', { name: 'Send tvist' }).click();
  await expect(page.getByText('Velg en årsak')).toBeVisible();
  expect(calls.some((c) => c.method === 'POST' && c.pathname.endsWith('/dispute'))).toBe(false);
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Velg årsak…' }) }).selectOption({ index: 1 });
  await page.getByPlaceholder('Kort beskrivelse av problemet (min. 5 tegn)').fill('Ikke ferdig malt');
  await page.getByPlaceholder('Beskriv problemet i detalj (min. 20 tegn)…').fill('Halve veggen mangler fortsatt maling etter avtalt dag.');
  await page.getByRole('button', { name: 'Send tvist' }).click();
  await expect(page.getByText(/Tvisten er opprettet/)).toBeVisible();
  expect(calls.find((c) => c.method === 'POST' && c.pathname.endsWith('/dispute')).body).toMatchObject({ title: 'Ikke ferdig malt' });
  expect(errors).toEqual([]);
});

test('admin sees the dispute and resolves it', async ({ page }) => {
  const errors = watchErrors(page);
  const dispute = {
    _id: 'disp-1', title: 'Ikke ferdig malt', description: 'Halve veggen mangler.', status: 'open', priority: 'high',
    reasonCategory: 'work_not_completed', orderId: { _id: ORDER_ID }, openedAt: '2026-10-22T10:00:00.000Z', createdAt: '2026-10-22T10:00:00.000Z',
    messages: [], evidence: [],
  };
  const { calls } = await mockApi(page, {
    as: 'superAdmin',
    routes: {
      'GET /api/admin/disputes': () => ({ success: true, data: { disputes: [dispute] }, pagination: { total: 1, page: 1, limit: 20, totalPages: 1 } }),
      'GET /api/admin/disputes/summary': () => ({ success: true, data: { open: 1, under_review: 0, resolved: 0, total: 1 } }),
      'GET /api/admin/disputes/disp-1': () => ({ success: true, data: { dispute } }),
      'POST /api/admin/disputes/disp-1/resolve': ({ body }) => {
        Object.assign(dispute, { status: 'resolved', resolution: { outcome: body.outcome, resolvedAt: new Date().toISOString() } });
        return { success: true, data: { dispute } };
      },
    },
  });
  await page.goto('/dashboard/disputes');
  await expect(page.getByText('work not completed').first()).toBeVisible();
  await page.getByRole('link', { name: 'Se detaljer' }).first().click();
  await expect(page.getByRole('heading', { name: dispute.title })).toBeVisible();
  await page.getByRole('button', { name: 'Løs tvist' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Bekreft løsning' })).toBeDisabled();
  await dialog.locator('select').selectOption('full_refund_to_customer');
  await dialog.getByPlaceholder('Forklar beslutningen…').fill('Arbeidet ble ikke levert.');
  await dialog.getByRole('button', { name: 'Bekreft løsning' }).click();
  await expect.poll(() => calls.some((c) => c.pathname === '/api/admin/disputes/disp-1/resolve')).toBe(true);
  expect(calls.find((c) => c.pathname === '/api/admin/disputes/disp-1/resolve').body).toMatchObject({ outcome: 'full_refund_to_customer', reason: 'Arbeidet ble ikke levert.' });
  await expect(page.getByRole('button', { name: 'Gjenåpne' })).toBeVisible();
  expect(errors).toEqual([]);
});
