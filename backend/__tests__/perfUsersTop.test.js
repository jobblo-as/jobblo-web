/** GET /api/users/top: lean rows read like documents (id), and one live-user count shared by all viewers. */
delete process.env.REDIS_URL; // in-process cache
const User = require('../models/User');
const { getTopUsers } = require('../controllers/users/searchController');

const OID = '64b000000000000000000001';
let leaned;
beforeEach(async () => {
  await require('../utils/cache').invalidate('users');
  leaned = false;
  const rows = [
    { _id: { toString: () => OID }, name: 'Kari', reviewCount: 3, email: 'secret@x.no' },
  ];
  const chain = {
    select: () => chain,
    sort: () => chain,
    skip: () => chain,
    limit: () => chain,
    lean: async () => ((leaned = true), rows),
  };
  jest.spyOn(User, 'find').mockReturnValue(chain);
  jest.spyOn(User, 'countDocuments').mockResolvedValue(11);
});
afterEach(() => jest.restoreAllMocks());

const top = async (userId) => {
  const res = {
    status() {
      return this;
    },
    json: jest.fn(),
  };
  await getTopUsers({ query: {}, userId }, res);
  return res.json.mock.calls[0][0];
};

it('lean rows keep the public id and drop private fields', async () => {
  const body = await top('viewer-a');
  expect(leaned).toBe(true);
  expect(body.data[0]).toMatchObject({ id: OID, name: 'Kari' });
  expect(body.data[0].email).toBeUndefined();
});

it('total is live users minus the viewer, counted once for every viewer', async () => {
  const a = await top('viewer-a');
  const b = await top('viewer-b');
  expect(a.pagination.total).toBe(10);
  expect(b.pagination.total).toBe(10);
  expect(User.countDocuments).toHaveBeenCalledTimes(1);
  expect(User.countDocuments).toHaveBeenCalledWith({ isDeleted: { $ne: true } });
});
