/**
 * Admin job reports: summary counts by resolvedAt, the note limit, the reportType filter only
 * takes known values, and the detail returns the other reports on the same ad.
 */
const calls = { count: [], find: [] };
const chain = (result) => {
  const q = { select: () => q, populate: () => q, sort: () => q, skip: () => q, limit: () => q };
  q.lean = async () => result;
  return q;
};
let found = null;
jest.mock('../models/JobReport', () => ({
  VALID_REPORT_TYPES: ['spam', 'scam_or_fraud'],
  schema: { path: () => ({ enumValues: ['open', 'under_review', 'resolved', 'dismissed'] }) },
  aggregate: jest.fn(async () => [{ _id: 'open', count: 2 }]),
  countDocuments: jest.fn(async (q) => (calls.count.push(q), 3)),
  find: jest.fn((q) => (calls.find.push(q), chain([{ _id: 'r2', reportType: 'spam' }]))),
  findById: jest.fn(() => (found ? Object.assign(chain(found), found) : chain(null))),
}));

const ctl = require('../controllers/admin/jobReportsAdminController');
const ID = '64b000000000000000000001';
const run = async (fn, req) => {
  const res = { status: jest.fn(() => res), json: jest.fn((b) => ((res.body = b), res)) };
  await fn({ params: {}, query: {}, body: {}, user: { _id: 'a' }, ...req }, res, jest.fn());
  return res;
};

test('"resolved this month" counts by resolvedAt, not updatedAt', async () => {
  const res = await run(ctl.getReportsSummary);
  expect(res.body.data.open).toBe(2);
  const q = calls.count.find((c) => c?.status === 'resolved');
  expect(q.resolvedAt).toBeDefined();
  expect(q.updatedAt).toBeUndefined();
});

test('reportType filter ignores unknown values and objects', async () => {
  await run(ctl.getReports, { query: { reportType: { $ne: 'x' } } });
  expect(calls.find.at(-1).reportType).toBeUndefined();
  await run(ctl.getReports, { query: { reportType: 'spam' } });
  expect(calls.find.at(-1).reportType).toBe('spam');
});

test('a note over 1000 chars is a 400, not a 500', async () => {
  const res = await run(ctl.updateStatus, {
    params: { reportId: ID },
    body: { status: 'resolved', note: 'x'.repeat(1001) },
  });
  expect(res.status).toHaveBeenCalledWith(400);
});

test('detail returns other reports on the ad and the reported user count', async () => {
  found = { _id: ID, serviceId: { _id: 's1' }, reportedUser: { _id: 'u1' } };
  const res = await run(ctl.getReportById, { params: { reportId: ID } });
  expect(res.body.data.related).toHaveLength(1);
  expect(res.body.data.reportedUserReports).toBe(3);
  expect(calls.find.at(-1).serviceId).toBe('s1');
});
