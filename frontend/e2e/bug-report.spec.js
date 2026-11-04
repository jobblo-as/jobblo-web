import { test } from '@playwright/test';
import { expect, mockApi, shot } from './helpers/app.js';

/**
 * "Rapporter en feil": opens on the page it is clicked from (no page change), carries that
 * page's URL and the screenshots the user picks, and shows up in the developer dashboard.
 */

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex'
);

test('a user reports a bug from the footer, with the page and a screenshot', async ({ page }) => {
  let sent = null;
  await mockApi(page, {
    as: 'user',
    routes: {
      'POST /api/support/tickets': ({ request }) => {
        sent = request.postDataBuffer()?.toString('latin1') ?? '';
        return { status: 201, json: { message: 'ok', ticketId: 't1' } };
      },
    },
  });
  await page.goto('/search/job/all');
  await page.getByRole('button', { name: 'Rapporter en feil' }).first().click();

  const dialog = page.getByRole('dialog', { name: 'Rapporter en feil' });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/search\/job\/all$/); // same page, no navigation
  await expect(dialog.getByText('/search/job/all')).toBeVisible();

  // Too short: the dialog says so, nothing is sent.
  await dialog.getByRole('textbox').first().fill('feil');
  await dialog.getByRole('button', { name: 'Send rapport' }).click();
  await expect(dialog.getByRole('alert')).toContainText('minst 10 tegn');
  expect(sent).toBeNull();

  await dialog
    .getByRole('textbox')
    .first()
    .fill('Filteret viser ingen oppdrag selv om det finnes.');
  await dialog.getByLabel('Velg skjermbilder').setInputFiles({
    name: 'skjerm.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(dialog.getByAltText('Skjermbilde 1')).toBeVisible();
  await shot(page, 'bug-report-dialog');
  await dialog.getByRole('button', { name: 'Send rapport' }).click();

  await expect(page.getByText('Takk! Feilen er sendt til utviklerne.')).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(sent).toContain('name="kind"\r\n\r\nbug');
  expect(sent).toMatch(/name="pageUrl"\r\n\r\nhttp:\/\/127\.0\.0\.1:\d+\/search\/job\/all/);
  expect(sent).toContain('name="platform"\r\n\r\nweb');
  expect(sent).toContain('filename="skjerm.png"');
});

test('the developer dashboard shows the bug report with its page and screenshot', async ({
  page,
}) => {
  const row = {
    _id: '64f000000000000000000001',
    subject: 'Feilrapport: /search/job/all',
    email: 'c***@example.test',
    status: 'open',
    priority: 'medium',
    escalated: false,
    kind: 'bug',
    pageUrl: 'http://127.0.0.1:5176/search/job/all',
    screenshots: ['https://example.test/shot.png'],
    client: { platform: 'web', screen: '1280x720', userAgent: 'Mozilla/5.0' },
    createdAt: '2026-11-05T10:00:00.000Z',
    updatedAt: '2026-11-05T10:00:00.000Z',
    sla: { dueAt: '2026-11-08T10:00:00.000Z', breached: false, metAt: null },
  };
  const { calls } = await mockApi(page, {
    as: 'developer',
    routes: {
      'GET /api/developer/tickets': () => ({
        success: true,
        data: {
          summary: { byStatus: { open: 1 }, byPriority: { medium: 1 }, breached: 0, escalated: 0 },
          slaHours: { critical: 4, high: 24, medium: 72, low: 168 },
          tickets: [row],
        },
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      }),
      'GET /api/developer/developers': () => ({ success: true, data: { developers: [] } }),
      [`GET /api/developer/tickets/${row._id}`]: () => ({
        success: true,
        data: { ticket: { ...row, message: 'Filteret viser ingen oppdrag.', history: [] } },
      }),
    },
  });
  await page.route('https://example.test/**', (r) =>
    r.fulfill({ contentType: 'image/png', body: PNG })
  );
  await page.goto('/developer/tickets');
  await page.getByRole('button', { name: 'Bug reports' }).click();
  await expect.poll(() => calls.some((c) => c.search.includes('kind=bug'))).toBe(true);
  await page.getByText('Feilrapport: /search/job/all').first().click();
  await expect(page.getByText('Bug report', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: row.pageUrl })).toBeVisible();
  await expect(page.getByAltText('Screenshot 1')).toBeVisible();
  await shot(page, 'bug-report-dashboard');
});
