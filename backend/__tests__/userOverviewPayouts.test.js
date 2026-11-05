const { payoutSums } = require('../controllers/admin/userOverviewController');

test('only transferred payouts count as paid out; released and processing are in progress', () => {
  const totals = [
    { _id: 'transferred', n: 2, net: 1000 },
    { _id: 'processing', n: 1, net: 300 },
    { _id: 'released_internal', n: 1, net: 200 },
    { _id: 'pending', n: 1, net: 50 },
    { _id: 'failed', n: 1, net: 80 },
    { _id: 'reconciliation_required', n: 1, net: 70 },
  ];
  expect(payoutSums(totals)).toEqual({ paidOut: 1000, payoutInProgress: 500, payoutsFailed: 2 });
  expect(payoutSums([])).toEqual({ paidOut: 0, payoutInProgress: 0, payoutsFailed: 0 });
});
