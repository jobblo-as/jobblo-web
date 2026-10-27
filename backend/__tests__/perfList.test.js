/**
 * GET /api/services (public list): card-only projection, one count per filter shared by its
 * pages, and the county → municipality lookup memoized instead of queried per request.
 */
delete process.env.REDIS_URL; // in-process cache: no shared state with other runs
const Service = require('../models/Service');
const NorwayMunicipality = require('../models/NorwayMunicipality');
const { getAllServices } = require('../controllers/services/browseController');

let selected;
beforeEach(() => {
  selected = [];
  const chain = { select: (s) => (selected.push(s), chain), populate: () => chain, lean: () => chain, skip: () => chain, limit: () => chain, sort: async () => [] };
  jest.spyOn(Service, 'find').mockReturnValue(chain);
  jest.spyOn(Service, 'countDocuments').mockResolvedValue(42);
  jest.spyOn(NorwayMunicipality, 'find').mockReturnValue({ select: () => ({ lean: async () => [{ code: '0301' }] }) });
  jest.spyOn(require('../services/monitoring/searchHealth'), 'recordSearch').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const list = async (query) => {
  const res = { json: jest.fn(), status() { return this; } };
  await getAllServices({ query }, res);
  return res.json.mock.calls[0][0];
};

it('leaves imageMetadata and the checklist out of the list', async () => {
  await list({});
  expect(selected).toContain('-imageMetadata -checklist');
});

it('pages of one filter share one count; another filter gets its own', async () => {
  const a = await list({ category: 'Maling', page: '1' });
  const b = await list({ category: 'Maling', page: '2' });
  await list({ category: 'Flytting', page: '1' });
  expect(a.pagination.total).toBe(42);
  expect(b.pagination.total).toBe(42);
  expect(Service.countDocuments).toHaveBeenCalledTimes(2);
});

it('county filter: municipality codes are looked up once, then memoized', async () => {
  await list({ countyCodes: '03' });
  await list({ countyCodes: '03', page: '2' });
  expect(NorwayMunicipality.find).toHaveBeenCalledTimes(1);
  const filter = Service.find.mock.calls.at(-1)[0];
  expect(JSON.stringify(filter)).toContain('0301');
});

it('selectedDefaults restores defaults of selected paths only (no unselected field appears)', () => {
  const { selectedDefaults } = require('../utils/lean');
  const User = require('../models/User');
  const out = selectedDefaults(User, { _id: 'u', name: 'A' }, 'name completedJobs verified');
  expect(out).toEqual({ _id: 'u', name: 'A', completedJobs: 0, verified: false });
});
