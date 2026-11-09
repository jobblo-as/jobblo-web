/**
 * Admin job detail (GET /api/admin/services/:id/activity): who applied, awards, payment, payout
 * and one timeline in date order.
 */
const chain = (result) => {
  const q = {
    select: () => q,
    populate: () => q,
    sort: () => q,
    lean: async () => result,
  };
  return q;
};
const data = {};
const model = (name) => ({
  findById: jest.fn(() => chain(data[name])),
  find: jest.fn(() => chain(data[name] || [])),
  countDocuments: jest.fn(async () => data[name] || 0),
});
for (const name of [
  'Service',
  'JobRequest',
  'Order',
  'Payout',
  'SafePayHistory',
  'UrgentPurchase',
  'ExtraContactPurchase',
  'Review',
  'JobReport',
  'Favorite',
  'Dispute',
])
  jest.doMock(`../models/${name}`, () => model(name));
jest.mock('../services/admin/activityService', () => ({ logActivity: jest.fn() }));

const ctl = require('../controllers/admin/servicesAdminController');
const ID = '64b000000000000000000001';
const call = async (id) => {
  const res = { status: jest.fn(() => res), json: jest.fn((b) => ((res.body = b), res)) };
  await ctl.getServiceActivity({ params: { id }, user: { _id: 'a' } }, res, jest.fn());
  return res;
};
const d = (day) => new Date(`2026-11-0${day}T10:00:00Z`);

test('bad id is a 400, unknown job a 404', async () => {
  expect((await call('nope')).status).toHaveBeenCalledWith(400);
  data.Service = null;
  expect((await call(ID)).status).toHaveBeenCalledWith(404);
});

test('counts and timeline: posted → requests → award → paid → payout', async () => {
  const ola = { name: 'Ola' };
  const kari = { name: 'Kari' };
  data.Service = { _id: ID, title: 'Male terrasse', createdAt: d(1), userId: { name: 'Eier' } };
  data.JobRequest = [
    { providerId: ola, status: 'accepted', createdAt: d(2) },
    { providerId: kari, status: 'declined', createdAt: d(3) },
    { providerId: { name: 'Per' }, status: 'pending', createdAt: d(3), withdrawnAt: d(4) },
  ];
  data.Order = [
    {
      _id: 'o1',
      providerId: ola,
      agreedPrice: 2400,
      paymentStatus: 'paid',
      createdAt: d(4),
      paymentConfirmedAt: d(5),
      completedAt: d(7),
    },
  ];
  data.Payout = [{ orderId: 'o1', netProviderAmount: 2160, transferCompletedAt: d(8) }];
  data.Favorite = 5;

  const { body } = await call(ID);
  expect(body.data.stats).toMatchObject({
    requests: 3,
    accepted: 1,
    declined: 1,
    pending: 0,
    withdrawn: 1,
    orders: 1,
    paid: 1,
    favorites: 5,
  });
  expect(body.data.timeline.map((e) => e.kind)).toEqual([
    'created',
    'request',
    'request',
    'request',
    'withdrawn',
    'order',
    'paid',
    'completed',
    'payout',
  ]);
  expect(body.data.timeline.find((e) => e.kind === 'paid').text).toMatch(/2\s400 kr/);
});
