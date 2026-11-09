/**
 * Admin chat reports: "Avvis" really dismisses (it used to 400 on a missing outcome), the summary
 * has the counts the page shows, and the reportType filter only takes known values.
 */
const calls = { count: [], find: [] };
const chain = (result) => {
  const q = { select: () => q, populate: () => q, sort: () => q, skip: () => q, limit: () => q };
  q.lean = async () => result;
  return q;
};
let doc = null;
jest.mock('../models/ChatReport', () => ({
  VALID_REPORT_TYPES: ['spam', 'threats'],
  schema: {
    path: (p) => ({
      enumValues: p === 'status' ? ['open', 'resolved', 'dismissed'] : ['low', 'high', 'urgent'],
    }),
  },
  aggregate: jest.fn(async () => [
    { _id: 'open', count: 2 },
    { _id: 'dismissed', count: 1 },
  ]),
  countDocuments: jest.fn(async (q) => (calls.count.push(q), 4)),
  find: jest.fn((q) => (calls.find.push(q), chain([]))),
  findById: jest.fn(async () => doc),
}));
jest.mock('../services/admin/activityService', () => ({ logActivity: jest.fn() }));
jest.mock('../services/notifications', () => ({ notify: jest.fn() }));
jest.mock('../services/admin/safePayStateService', () => ({
  openDispute: jest.fn(),
  DISPUTE_ELIGIBLE_STATUSES: [],
}));

const ctl = require('../controllers/admin/chatReportsAdminController');
const ID = '64b000000000000000000001';
const run = async (fn, req) => {
  const res = { status: jest.fn(() => res), json: jest.fn((b) => ((res.body = b), res)) };
  await fn(
    { params: {}, query: {}, body: {}, user: { _id: 'a', name: 'Admin' }, headers: {}, ...req },
    res,
    jest.fn()
  );
  return res;
};

test('dismiss needs only a reason and ends as "dismissed"', async () => {
  doc = { status: 'under_review', timeline: [], save: jest.fn() };
  const res = await run(ctl.dismissReport, {
    params: { reportId: ID },
    body: { reason: 'Ingen brudd funnet.' },
  });
  expect(res.status).toHaveBeenCalledWith(200);
  expect(doc.status).toBe('dismissed');
  expect(doc.resolution).toMatchObject({ outcome: 'no_violation', reason: 'Ingen brudd funnet.' });
});

test('dismiss without a reason, or a non-string reason, is a 400', async () => {
  doc = { status: 'open', timeline: [], save: jest.fn() };
  for (const reason of [undefined, '  ', { $gt: '' }]) {
    const res = await run(ctl.dismissReport, { params: { reportId: ID }, body: { reason } });
    expect(res.status).toHaveBeenCalledWith(400);
  }
  expect(doc.save).not.toHaveBeenCalled();
});

test('summary has dismissed, high and total; month count uses resolvedAt', async () => {
  const res = await run(ctl.getReportsSummary);
  expect(res.body.data).toMatchObject({ open: 2, dismissed: 1, total: 3, high: 4 });
  const month = calls.count.find((q) => q['resolution.resolvedAt']);
  expect(month).toBeDefined();
});

test('reportType filter ignores unknown values and objects', async () => {
  await run(ctl.getReports, { query: { reportType: { $ne: 'x' } } });
  expect(calls.find.at(-1).reportType).toBeUndefined();
  await run(ctl.getReports, { query: { reportType: 'threats' } });
  expect(calls.find.at(-1).reportType).toBe('threats');
});

test('official message: the page sends recipientType, the user is notified', async () => {
  const { notify } = require('../services/notifications');
  doc = {
    reportedBy: 'u1',
    reportedUser: 'u2',
    officialMessages: [],
    timeline: [],
    save: jest.fn(),
  };
  const res = await run(ctl.addOfficialMessage, {
    params: { reportId: ID },
    body: { recipientType: 'reported_user', message: 'Hold tonen saklig.' },
  });
  expect(res.status).toHaveBeenCalledWith(200);
  expect(doc.officialMessages[0]).toMatchObject({ recipientId: 'u2' });
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u2' }));
});

test('a 1000-char reason fits the 500-char timeline entry', async () => {
  doc = { status: 'open', timeline: [], save: jest.fn() };
  await run(ctl.dismissReport, { params: { reportId: ID }, body: { reason: 'x'.repeat(1000) } });
  expect(doc.resolution.reason).toHaveLength(1000);
  expect(doc.timeline[0].description.length).toBeLessThanOrEqual(500);
});
