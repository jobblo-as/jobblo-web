const mongoose = require('mongoose');

/**
 * Regression guard for security review M2 (unbounded list endpoints) and M6 (smaller
 * authorization gaps: time entries, other users' non-public listings, global read flag
 * on system notifications, public config by any key).
 */

// A chainable query that records skip/limit and resolves to `value`.
const calls = [];
function q(value = []) {
  const o = { args: {} };
  for (const m of ['populate', 'sort', 'select', 'lean']) o[m] = jest.fn(() => o);
  o.skip = jest.fn((n) => ((o.args.skip = n), o));
  o.limit = jest.fn((n) => ((o.args.limit = n), o));
  o.then = (res, rej) => Promise.resolve(value).then(res, rej);
  calls.push(o);
  return o;
}
const model = () => ({
  find: jest.fn(() => q()),
  findOne: jest.fn(() => q(null)),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(() => q({ _id: 'n', userId: null, read: false, readBy: ['x'] })),
  countDocuments: jest.fn(async () => 0),
  updateMany: jest.fn(async () => ({})),
});
jest.mock('../models/Service', () => model());
jest.mock('../models/Order', () => model());
jest.mock('../models/Favorite', () => model());
jest.mock('../models/List', () => model());
jest.mock('../models/JobRequest', () => model());
jest.mock('../models/Review', () => model());
jest.mock('../models/Notification', () => model());
jest.mock('../models/GlobalConfig', () => model());

const Service = require('../models/Service');
const Order = require('../models/Order');
const Notification = require('../models/Notification');
const GlobalConfig = require('../models/GlobalConfig');
const serviceController = require('../controllers/serviceController');
const favoriteController = require('../controllers/favoriteController');
const listController = require('../controllers/listController');
const orderController = require('../controllers/orderController');
const reviewController = require('../controllers/reviewController');
const applicantController = require('../controllers/applicantController');
const notificationController = require('../controllers/notificationController');
const globalConfigController = require('../controllers/globalConfigController');
const { forViewer } = require('../services/notifications');

const OWNER = String(new mongoose.Types.ObjectId());
const OTHER = String(new mongoose.Types.ObjectId());
const SID = String(new mongoose.Types.ObjectId());

function res() {
  const r = {};
  r.status = jest.fn(() => r);
  r.json = jest.fn(() => r);
  return r;
}
const lastLimit = () => calls.filter((c) => 'limit' in c.args).at(-1)?.args.limit;

beforeEach(() => {
  calls.length = 0;
  jest.clearAllMocks();
});

describe('M2: list endpoints are bounded', () => {
  const huge = { limit: '99999999', page: '-5' };
  it.each([
    ['favorites', () => favoriteController.getFavorites({ userId: OWNER, query: huge }, res())],
    ['lists', () => listController.getUserLists({ userId: OWNER, query: huge }, res())],
    ['orders', () => orderController.getAllOrders({ userId: OWNER, query: huge }, res())],
    ['job requests', () => orderController.getMyJobRequests({ userId: OWNER, query: huge }, res())],
    ['user reviews', () => reviewController.getUserReviews({ params: { userId: OWNER }, query: huge }, res())],
    ['all reviews', () => reviewController.getAllReviews({ query: huge }, res())],
    ['user services', () => serviceController.getUserServices({ params: { id: OWNER }, userId: OWNER, query: huge }, res())],
  ])('%s caps the page at 100', async (_name, run) => {
    await run();
    expect(lastLimit()).toBe(100);
  });

  it('applicants caps the page at 100', async () => {
    Service.findById.mockResolvedValue({ _id: SID, userId: OWNER });
    await applicantController.getApplicantsForService({ params: { serviceId: SID }, userId: OWNER, query: huge }, res());
    expect(lastLimit()).toBe(100);
  });
});

describe('M6a: time entries are participant-only', () => {
  it('refuses a stranger and serves the owner', async () => {
    Service.findById.mockReturnValue(q({ _id: SID, userId: OWNER, timeEntries: [{ hours: 2 }] }));
    const stranger = res();
    await serviceController.getTimeEntries({ params: { id: SID }, userId: OTHER }, stranger);
    expect(stranger.status).toHaveBeenCalledWith(403);

    const owner = res();
    await serviceController.getTimeEntries({ params: { id: SID }, userId: OWNER }, owner);
    expect(owner.json).toHaveBeenCalledWith([{ hours: 2 }]);
  });

  it('serves the assigned worker', async () => {
    Service.findById.mockReturnValue(q({ _id: SID, userId: OWNER, timeEntries: [] }));
    Order.findOne.mockReturnValueOnce(q({ _id: 'o' }));
    const r = res();
    await serviceController.getTimeEntries({ params: { id: SID }, userId: OTHER }, r);
    expect(r.status).not.toHaveBeenCalledWith(403);
  });
});

describe('M6b: another user sees only public listings', () => {
  it('filters by public status for others, not for the owner', async () => {
    await serviceController.getUserServices({ params: { id: OWNER }, userId: OTHER, query: {} }, res());
    expect(Service.find.mock.calls[0][0].status).toEqual({ $in: ['open', 'active'] });

    await serviceController.getUserServices({ params: { id: OWNER }, userId: OWNER, query: {} }, res());
    expect(Service.find.mock.calls[1][0].status).toBeUndefined();
  });
});

describe('M6c: reading a system notification is per user', () => {
  it('markAsRead adds the caller to readBy instead of setting the global flag', async () => {
    Notification.findById.mockResolvedValue({ _id: 'n', userId: null, isSystem: true });
    const r = res();
    await notificationController.markAsRead({ params: { id: SID }, userId: 'x' }, r);
    expect(Notification.findByIdAndUpdate.mock.calls[0][1]).toEqual({ $addToSet: { readBy: 'x' } });
    expect(r.json.mock.calls[0][0]).toEqual({ _id: 'n', userId: null, read: true });
  });

  it('unread count includes unread broadcasts the caller has not read', async () => {
    await notificationController.getUnreadCount({ userId: OWNER }, res());
    const filter = Notification.countDocuments.mock.calls[0][0];
    expect(filter.$or).toContainEqual({ userId: null, isSystem: true, readBy: { $ne: OWNER } });
  });

  it('list shows read per viewer and never exposes readBy', () => {
    const n = { _id: 'n', userId: null, read: false, readBy: [OWNER] };
    expect(forViewer(n, OWNER)).toEqual({ _id: 'n', userId: null, read: true });
    expect(forViewer(n, OTHER)).toEqual({ _id: 'n', userId: null, read: false });
  });
});

describe('M6d: public config is allowlisted', () => {
  it('404s an internal key without touching the DB, serves a public one', async () => {
    const r = res();
    await globalConfigController.getConfigByKey({ params: { key: 'STRIPE_TEST_MODE' } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(GlobalConfig.findOne).not.toHaveBeenCalled();

    GlobalConfig.findOne.mockResolvedValueOnce({ key: 'FREE_PRIVATE_JOBS_UNDER_10000', value: true });
    const ok = res();
    await globalConfigController.getConfigByKey({ params: { key: 'FREE_PRIVATE_JOBS_UNDER_10000' } }, ok);
    expect(ok.status).toHaveBeenCalledWith(200);
  });
});
