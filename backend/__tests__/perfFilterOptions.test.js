/** GET /api/filter/options: its four independent reads run concurrently, not one after another. */
const Service = require('../models/Service');
const Category = require('../models/Category');
const { getFilterOptions } = require('../controllers/filterController');

afterEach(() => jest.restoreAllMocks());

it('starts every read before any of them has answered', async () => {
  const started = [];
  let release;
  const gate = new Promise((r) => (release = r));
  const held = (name, value) => () => (started.push(name), gate.then(() => value));
  jest.spyOn(Service, 'aggregate').mockImplementation(held('aggregate', []));
  jest.spyOn(Service, 'countDocuments').mockImplementation(held('count', 0));
  jest.spyOn(Category, 'find').mockReturnValue({ lean: held('categories', []) });
  jest.spyOn(Service, 'distinct').mockResolvedValue([]);

  const res = {
    json: jest.fn(),
    status() {
      return this;
    },
  };
  const done = getFilterOptions({ query: {} }, res);
  await new Promise((r) => setImmediate(r));
  expect(started.sort()).toEqual(['aggregate', 'aggregate', 'categories', 'count']);
  release();
  await done;
  expect(res.json).toHaveBeenCalled();
});
