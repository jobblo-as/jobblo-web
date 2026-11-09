import { test } from '@playwright/test';
import { expect, mockApi, shot, watchErrors } from './helpers/app.js';

/** Super Admin → Chatrapporter (list, detail, decisions), Chat-gjennomgang viewer, Chatter search. */
test.describe.configure({ timeout: 120_000 });

const RID = '64e000000000000000000001';
const CID = '64e000000000000000000002';
const MID = '64e000000000000000000003';
const kari = { _id: 'u5', name: 'Kari Berg', email: 'kari@example.test' };
const svein = { _id: 'u6', name: 'Svein Svindel', email: 'svein@example.test' };
const report = {
  _id: RID,
  chatId: { _id: CID, status: 'paid' },
  scope: 'message',
  messageId: MID,
  reportType: 'off_platform_payment_request',
  title: 'Ber om betaling på Vipps',
  description:
    'Han skriver at jeg må betale på Vipps i stedet for SafePay, ellers kommer han ikke.',
  status: 'under_review',
  priority: 'high',
  reportedBy: kari,
  reportedUser: svein,
  assignedAdminId: { _id: 'a1', name: 'TEST Admin', email: 'admin@example.test' },
  serviceId: { _id: 's1', title: 'Male terrasse' },
  createdAt: '2026-11-08T09:00:00.000Z',
  updatedAt: '2026-11-08T10:00:00.000Z',
  evidence: [],
  internalNotes: [],
  officialMessages: [],
  timeline: [
    {
      _id: 't1',
      action: 'assigned',
      actorId: { _id: 'a1', name: 'TEST Admin' },
      description: 'Tildelt til TEST Admin',
      createdAt: '2026-11-08T10:00:00.000Z',
    },
  ],
};
const summary = {
  open: 2,
  under_review: 1,
  action_required: 1,
  waiting_for_reporter: 0,
  waiting_for_reported_user: 0,
  resolved: 5,
  dismissed: 3,
  closed: 0,
  total: 12,
  urgent: 1,
  high: 2,
  resolvedThisMonth: 4,
  unassigned: 2,
  safePayLinked: 3,
};

test('chat reports: counts, Norwegian labels, Avvis and message send the right bodies', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const sent = {};
  await mockApi(page, {
    as: 'superAdmin',
    routes: {
      'GET /api/admin/chat-reports/summary': () => ({ success: true, data: summary }),
      'GET /api/admin/chat-reports': () => ({
        success: true,
        data: { reports: [report] },
        pagination: { page: 1, limit: 20, total: 1, pages: 1 },
      }),
      [`GET /api/admin/chat-reports/${RID}`]: () => ({ success: true, data: { report } }),
      [`POST /api/admin/chat-reports/${RID}/dismiss`]: ({ body }) => {
        sent.dismiss = body;
        return { success: true, data: { report: { ...report, status: 'dismissed' } } };
      },
      [`POST /api/admin/chat-reports/${RID}/official-message`]: ({ body }) => {
        sent.message = body;
        return { success: true, data: {} };
      },
    },
  });
  await page.goto('/dashboard/chat-reports');
  await expect(page.getByText('2 med høy prioritet')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Alle\s*12/ })).toBeVisible();
  await expect(page.getByText('Betaling utenfor SafePay').first()).toBeVisible();
  await expect(page.getByText('Høy').first()).toBeVisible();
  await shot(page, 'admin-chat-reports');

  await page.getByRole('link', { name: 'Ber om betaling på Vipps', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ber om betaling på Vipps' })).toBeVisible();
  await expect(page.getByText('Saken ble tatt')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Les chatten' })).toHaveAttribute(
    'href',
    `/dashboard/chat-review?chatId=${CID}&reportId=${RID}&source=report`
  );

  await page.getByRole('radio', { name: /Rapportert \(Svein/ }).click();
  await page.getByLabel('Melding til bruker').fill('Betaling skjer kun gjennom SafePay.');
  await page.getByRole('button', { name: 'Send melding' }).click();
  await expect
    .poll(() => sent.message)
    .toEqual({ recipientType: 'reported_user', message: 'Betaling skjer kun gjennom SafePay.' });
  await shot(page, 'admin-chat-report-detail');

  await page.getByRole('button', { name: 'Avvis' }).first().click();
  await page.getByLabel('Begrunnelse *').fill('Ingen brudd funnet i chatten.');
  await page.getByRole('dialog').getByRole('button', { name: 'Avvis' }).click();
  await expect.poll(() => sent.dismiss).toEqual({ reason: 'Ingen brudd funnet i chatten.' });

  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'admin-chat-report-detail-mobile');
  expect(errors).toEqual([]);
});

test('chat review: asks for a reason, then shows people, messages and the reported one', async ({
  page,
}) => {
  const errors = watchErrors(page);
  let reasonSent = null;
  await mockApi(page, {
    as: 'superAdmin',
    routes: {
      [`GET /api/admin/chats/${CID}`]: ({ url }) => {
        reasonSent = url.searchParams.get('accessReason');
        return {
          success: true,
          data: {
            chat: {
              _id: CID,
              status: 'paid',
              messageCount: 2,
              attachmentCount: 0,
              reportCount: 1,
              createdAt: '2026-11-07T09:00:00.000Z',
              updatedAt: '2026-11-08T09:00:00.000Z',
              lastMessageAt: '2026-11-08T08:00:00.000Z',
            },
            participants: {
              customer: {
                ...kari,
                role: 'user',
                accountStatus: 'active',
                verified: true,
                profileLink: '/dashboard/users/u5',
              },
              provider: {
                ...svein,
                role: 'user',
                accountStatus: 'active',
                verified: false,
                profileLink: '/dashboard/users/u6',
              },
            },
            relatedRecords: {
              serviceId: 's1',
              serviceTitle: 'Male terrasse',
              orderId: 'o1',
              safePayOrderId: 'o1',
              paymentStatus: 'paid',
              orderStatus: 'paid',
              disputeStatus: null,
              agreedPrice: 2400,
              safePayDetailLink: '/dashboard/safepay/o1',
              reportDetailLink: `/dashboard/chat-reports/${RID}`,
              disputeId: null,
            },
            messages: [
              {
                _id: 'm1',
                type: 'text',
                text: 'Hei, når kan du starte?',
                sender: { _id: 'u5', name: 'Kari Berg', role: 'user' },
                attachments: [],
                systemData: null,
                isReported: false,
                createdAt: '2026-11-08T07:00:00.000Z',
              },
              {
                _id: MID,
                type: 'text',
                text: 'Betal meg på Vipps først.',
                sender: { _id: 'u6', name: 'Svein Svindel', role: 'user' },
                attachments: [],
                systemData: null,
                isReported: true,
                createdAt: '2026-11-08T08:00:00.000Z',
              },
            ],
            reports: [],
            accessLogged: true,
          },
        };
      },
      [`GET /api/admin/chat-reports/${RID}`]: () => ({ success: true, data: { report } }),
    },
  });
  await page.goto(`/dashboard/chat-review?chatId=${CID}&reportId=${RID}&source=report`);
  await page.getByRole('button', { name: 'Søk', exact: true }).click();
  await page.getByRole('button', { name: 'Bekreft og åpne chat' }).click();
  await expect(page.getByText('Betal meg på Vipps først.')).toBeVisible();
  await expect(page.getByText('Meldinger (2)')).toBeVisible();
  await expect(page.getByText('Svein Svindel').first()).toBeVisible();
  await expect(page.getByText('Tilbyder', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Betaling utenfor SafePay')).toBeVisible();
  expect(reasonSent).toBe('Chat report investigation');
  await shot(page, 'admin-chat-review');
  expect(errors).toEqual([]);
});

test('chats: a name is a text search, a full id is a Chat ID', async ({ page }) => {
  const { calls } = await mockApi(page, {
    as: 'superAdmin',
    routes: {
      'GET /api/admin/chats': () => ({
        success: true,
        data: { chats: [] },
        pagination: { page: 1, limit: 20, total: 0, pages: 0 },
      }),
    },
  });
  await page.goto('/dashboard/chats');
  const box = page.getByPlaceholder(/Søk på Chat ID/);
  await box.fill('Kari');
  await expect
    .poll(() =>
      calls.some((c) => c.pathname === '/api/admin/chats' && c.search.includes('search=Kari'))
    )
    .toBe(true);
  await box.fill(CID);
  await expect
    .poll(() =>
      calls.some((c) => c.pathname === '/api/admin/chats' && c.search.includes(`chatId=${CID}`))
    )
    .toBe(true);
  expect(calls.some((c) => c.search.includes('chatId=Kari'))).toBe(false);
});
