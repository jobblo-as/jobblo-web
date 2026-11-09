import { test } from '@playwright/test';
import { expect, mockApi, shot, watchErrors, SERVICE } from './helpers/app.js';

/** Super Admin → Jobbrapporter: summary cards, list, detail + decision; public report button. */
test.describe.configure({ timeout: 120_000 });

const RID = '64d000000000000000000001';
const reporter = { _id: 'u5', name: 'Kari Berg', email: 'kari@example.test', role: 'user' };
const owner = { _id: 'u6', name: 'Svein Svindel', email: 'svein@example.test', role: 'user' };
const service = {
  _id: SERVICE._id,
  title: 'Male terrasse',
  price: 2400,
  status: 'open',
  images: [],
};
const report = {
  _id: RID,
  serviceId: {
    ...service,
    location: { address: 'Borggata 8', city: 'Oslo' },
    categories: ['Maling'],
    description: 'Male terrasse 30 kvm.',
    createdAt: '2026-11-01T10:00:00.000Z',
  },
  reportedBy: reporter,
  reportedUser: owner,
  reportType: 'scam_or_fraud',
  description: 'Han ber om betaling på Vipps før jobben starter.',
  status: 'open',
  assignedAdminId: null,
  createdAt: '2026-11-08T09:00:00.000Z',
  updatedAt: '2026-11-08T09:00:00.000Z',
  resolvedAt: null,
  resolutionNote: null,
  resolvedBy: null,
};
const summary = {
  open: 3,
  under_review: 1,
  resolved: 7,
  dismissed: 2,
  resolvedThisMonth: 4,
  unassigned: 2,
  total: 13,
};

test('list shows summary counts and Norwegian labels; detail resolves with a note', async ({
  page,
}) => {
  const errors = watchErrors(page);
  let sent = null;
  await mockApi(page, {
    as: 'superAdmin',
    routes: {
      'GET /api/admin/job-reports/summary': () => ({ success: true, data: summary }),
      'GET /api/admin/job-reports': () => ({
        success: true,
        data: { reports: [report] },
        pagination: { page: 1, limit: 20, total: 1, pages: 1 },
      }),
      [`GET /api/admin/job-reports/${RID}`]: () => ({
        success: true,
        data: {
          report,
          related: [
            {
              _id: 'r2',
              reportType: 'fake_job',
              status: 'open',
              createdAt: '2026-11-07T09:00:00.000Z',
              reportedBy: { _id: 'u7', name: 'Per Hansen', email: 'p@x.test' },
            },
          ],
          reportedUserReports: 3,
        },
      }),
      [`PATCH /api/admin/job-reports/${RID}/status`]: ({ body }) => {
        sent = body;
        return { success: true, data: { report: { ...report, status: body.status } } };
      },
    },
  });
  await page.goto('/dashboard/job-reports');
  await expect(page.getByText('7 løst totalt')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Åpne\s*3/ })).toBeVisible();
  await expect(page.getByText('Svindel').first()).toBeVisible();
  await expect(page.getByText('scam or fraud')).toHaveCount(0);
  await shot(page, 'admin-job-reports');

  await page.getByRole('link', { name: 'Male terrasse', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Male terrasse' })).toBeVisible();
  await expect(page.getByText('Han ber om betaling på Vipps')).toBeVisible();
  await expect(page.getByText('1 annen rapport på annonsen')).toBeVisible();
  await expect(page.getByText('2 andre rapporter')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Oppdrag' })).toHaveAttribute(
    'href',
    `/dashboard/services/${SERVICE._id}`
  );
  await shot(page, 'admin-job-report-detail');

  await page.getByRole('button', { name: 'Løs' }).click();
  await page.getByLabel('Notat').fill('Annonsen er fjernet.');
  await page.getByRole('button', { name: 'Ja, løs' }).click();
  await expect.poll(() => sent).toEqual({ status: 'resolved', note: 'Annonsen er fjernet.' });

  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'admin-job-report-detail-mobile');
  expect(errors).toEqual([]);
});

test('public page: owner sees no Rapporter, server error text reaches the user', async ({
  page,
}) => {
  const job = { ...SERVICE, userId: { ...SERVICE.userId, _id: '64a000000000000000000002' } };
  const { state } = await mockApi(page, {
    as: 'user',
    routes: {
      [`GET /api/services/${SERVICE._id}`]: () => job,
      [`POST /api/services/${SERVICE._id}/reports`]: () => ({
        status: 409,
        json: { error: 'Du har allerede rapportert denne annonsen.' },
      }),
    },
  });
  await page.goto(`/job-listing/${SERVICE._id}`);
  await page.getByRole('button', { name: 'Rapporter', exact: true }).click();
  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Spam' }).click();
  await page.locator('textarea').fill('Samme annonse lagt ut fem ganger.');
  await page.getByRole('button', { name: 'Send rapport', exact: true }).click();
  await expect(page.getByText('Du har allerede rapportert denne annonsen.')).toBeVisible();
  await shot(page, 'job-report-already-reported');

  // Same page as the owner: no button to report your own ad.
  state.session = { ...state.session, _id: '64a000000000000000000002' };
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rapporter', exact: true })).toHaveCount(0);
});
