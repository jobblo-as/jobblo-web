// Varslingsinnstillinger: a push group the user turned off is not pushed (still in Varsler);
// the preferences endpoint takes only the known groups, as booleans.
const mongoose = require('mongoose');

jest.mock('../models/User', () => ({ findById: jest.fn(), findByIdAndUpdate: jest.fn() }));
const User = require('../models/User');
const { pushWanted, PUSH_GROUPS } = require('../services/notifications');
const controller = require('../controllers/pushTokenController');

const lean = (value) => ({ select: () => ({ lean: async () => value }) });
const res = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
});

test('a group turned off is not pushed; others and ungrouped types are', async () => {
  User.findById.mockReturnValue(lean({ pushPreferences: { messages: false } }));
  expect(await pushWanted('u1', 'message')).toBe(false);
  expect(await pushWanted('u1', 'application')).toBe(true); // missing = on
  expect(await pushWanted('u1', 'system')).toBe(true); // no group: always
  expect(PUSH_GROUPS.orders).toEqual(['order', 'payment']);
});

test('preferences: only known groups, booleans', async () => {
  let r = res();
  await controller.updatePreferences({ userId: 'u1', body: { messages: 'no' } }, r);
  expect(r.statusCode).toBe(400);

  r = res();
  await controller.updatePreferences({ userId: 'u1', body: { evil: true } }, r);
  expect(r.statusCode).toBe(400);
  expect(User.findByIdAndUpdate).not.toHaveBeenCalled();

  User.findByIdAndUpdate.mockReturnValue(lean({ pushPreferences: { orders: false } }));
  r = res();
  await controller.updatePreferences({ userId: 'u1', body: { orders: false, evil: true } }, r);
  expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
    'u1',
    { $set: { 'pushPreferences.orders': false } },
    { new: true }
  );
  expect(r.body.preferences).toEqual({
    messages: true,
    applications: true,
    orders: false,
    reviews: true,
    jobs: true,
  });
});
