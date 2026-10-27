const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

/**
 * Authorization review: favourites/lists exposing non-public listings, sender emails in
 * order messages, superAdmin assignable from the admin panel, timeEntries in public
 * reads, and the second (unaudited) POST /api/users create path.
 */

function q(value) {
  const o = { args: { populate: [] } };
  for (const m of ['sort', 'skip', 'limit', 'select', 'lean']) o[m] = jest.fn(() => o);
  o.populate = jest.fn((arg) => (o.args.populate.push(arg), o));
  o.then = (res, rej) => Promise.resolve(value).then(res, rej);
  return o;
}
jest.mock('../models/Service', () => ({ findById: jest.fn() }));
jest.mock('../models/Favorite', () => ({ find: jest.fn(), findOne: jest.fn(), create: jest.fn() }));
jest.mock('../models/List', () => ({ find: jest.fn(), findOne: jest.fn() }));
jest.mock('../models/User', () => ({ findOne: jest.fn(), findById: jest.fn(), create: jest.fn(), findByIdAndUpdate: jest.fn(), countDocuments: jest.fn() }));
jest.mock('../models/Session', () => ({}));
jest.mock('../services/admin/activityService', () => ({ logActivity: jest.fn() }));

const Service = require('../models/Service');
const Favorite = require('../models/Favorite');
const List = require('../models/List');
const User = require('../models/User');
const favoriteController = require('../controllers/favoriteController');
const listController = require('../controllers/listController');
const usersAdmin = require('../controllers/admin/usersAdminController');

const ME = String(new mongoose.Types.ObjectId());
const OWNER = String(new mongoose.Types.ObjectId());
const SID = String(new mongoose.Types.ObjectId());
const LID = String(new mongoose.Types.ObjectId());

function res() {
  const r = {};
  r.status = jest.fn(() => r);
  r.json = jest.fn(() => r);
  return r;
}

beforeEach(() => jest.clearAllMocks());

describe('favourites and lists only hold public listings (or your own)', () => {
  it('refuses to favourite or list someone else\'s draft', async () => {
    Service.findById.mockResolvedValue({ _id: SID, userId: OWNER, status: 'draft' });
    const r1 = res();
    await favoriteController.addFavorite({ userId: ME, params: { serviceId: SID } }, r1);
    expect(r1.status).toHaveBeenCalledWith(404);
    expect(Favorite.create).not.toHaveBeenCalled();

    List.findOne.mockResolvedValue({ services: [], save: jest.fn() });
    const r2 = res();
    await listController.addServiceToList({ userId: ME, body: { listId: LID, serviceId: SID } }, r2);
    expect(r2.status).toHaveBeenCalledWith(404);
  });

  it('reads filter populated services by public status, owner excepted, and drop empty favourites', async () => {
    const fq = q([{ service: null }, { service: { _id: SID } }]);
    Favorite.find.mockReturnValue(fq);
    const r = res();
    await favoriteController.getFavorites({ userId: ME, query: {} }, r);
    expect(fq.args.populate[0].match).toEqual({ $or: [{ status: { $in: ['open', 'active'] } }, { userId: ME }] });
    expect(r.json.mock.calls[0][0].data).toEqual([{ service: { _id: SID } }]);

    const lq = q([]);
    List.find.mockReturnValue(lq);
    await listController.getUserLists({ userId: ME, query: {} }, res());
    expect(lq.args.populate[0].match.$or[1]).toEqual({ userId: ME });

    const oq = q(null);
    List.findOne.mockReturnValue(oq);
    await listController.getListById({ userId: ME, params: { listId: LID } }, res());
    expect(oq.args.populate[0].match.$or[0]).toEqual({ status: { $in: ['open', 'active'] } });
  });
});

describe('admin panel cannot mint a superAdmin', () => {
  it('createUser and changeUserRole refuse role superAdmin', async () => {
    const admin = { _id: new mongoose.Types.ObjectId() };
    const r1 = res();
    await usersAdmin.createUser({ user: admin, body: { name: 'a', email: 'a@b.no', password: 'x'.repeat(12), role: 'superAdmin' } }, r1, jest.fn());
    expect(r1.status).toHaveBeenCalledWith(400);
    expect(User.create).not.toHaveBeenCalled();

    const r2 = res();
    await usersAdmin.changeUserRole({ user: admin, params: { id: OWNER }, body: { role: 'superAdmin' } }, r2, jest.fn());
    expect(r2.status).toHaveBeenCalledWith(400);
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});

describe('static guards', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

  it('timeEntries are deselected by default on Service', () => {
    // Covers the public detail (and its cache), list, nearby, favourites and lists at once.
    const RealService = jest.requireActual('../models/Service');
    expect(RealService.schema.path('timeEntries').options.select).toBe(false);
  });

  it('order messages never populate the sender email', () => {
    expect(read('controllers/messageController.js')).not.toMatch(/populate\('senderId', '[^']*email/);
  });

  it('POST /api/users (unaudited create path) is gone', () => {
    expect(read('routes/users.js')).not.toMatch(/router\.post\('\/',/);
    expect(read('controllers/users/profileController.js')).not.toMatch(/exports\.createUser/);
  });
});

describe('final review: list search and contributor emails', () => {
  it('Z2: only the list OWNER sees emails; a contributor (added without consent) does not', async () => {
    const doc = {
      toObject: () => ({
        user: [{ _id: OWNER, name: 'Owner', email: 'owner@example.test' }],
        contributors: [{ _id: ME, name: 'Me', email: 'me@example.test' }, { _id: 'v1', name: 'Victim', email: 'victim@example.test' }],
      }),
    };
    List.findOne.mockReturnValue(q(doc));
    const r = res();
    await listController.getListById({ userId: ME, params: { listId: LID } }, r);
    expect(JSON.stringify(r.json.mock.calls[0][0])).not.toMatch(/@example\.test/);
    const r2 = res();
    await listController.getListById({ userId: OWNER, params: { listId: LID } }, r2);
    expect(JSON.stringify(r2.json.mock.calls[0][0])).toMatch(/victim@example\.test/);
  });

  it('Z2: addContributors takes at most 20 existing, live users', async () => {
    const save = jest.fn();
    List.findOne.mockResolvedValue({ contributors: [], save });
    User.find = jest.fn(() => ({ select: () => ({ lean: async () => [{ _id: 'a'.repeat(24) }] }) }));
    const ids = Array.from({ length: 50 }, () => String(new mongoose.Types.ObjectId()));
    await listController.addContributors({ userId: OWNER, params: { listId: LID }, body: { userIds: ids } }, res());
    const [filter] = User.find.mock.calls[0];
    expect(filter._id.$in).toHaveLength(20);
    expect(filter.isDeleted).toEqual({ $ne: true });
  });

  it('Z1: search-all list results populate only visible listings', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'users', 'searchController.js'), 'utf8');
    expect(src).not.toMatch(/\.populate\('services'\)/);
    expect(src).toMatch(/\.populate\(visibleServices\(req\.userId\)\)/);
  });
});
