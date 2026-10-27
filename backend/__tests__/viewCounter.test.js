/** utils/viewCounter: views are buffered and flushed as one bulkWrite, never lost on a failed flush. */
let client = null; // a fake ioredis client, or null = Redis off
jest.mock('../config/redis', () => ({ PREFIX: 't', getRedis: () => client }));
jest.mock('../models/Service', () => ({ bulkWrite: jest.fn(async () => ({})) }));

const Service = require('../models/Service');
const views = require('../utils/viewCounter');

const incs = () => Object.fromEntries(Service.bulkWrite.mock.calls.at(-1)[0].map((o) => [o.updateOne.filter._id, o.updateOne.update.$inc.views]));

beforeEach(() => {
  client = null;
  views._pending.clear();
  Service.bulkWrite.mockClear();
});

it('without Redis: counts in memory and flushes one bulkWrite of summed $inc', async () => {
  for (const id of ['a', 'a', 'a', 'b', 'b']) await views.count(id);
  expect(await views.flush()).toBe(2);
  expect(Service.bulkWrite).toHaveBeenCalledTimes(1);
  expect(incs()).toEqual({ a: 3, b: 2 });
  expect(await views.flush()).toBe(0); // drained
  expect(Service.bulkWrite).toHaveBeenCalledTimes(1);
});

it('a failed bulkWrite keeps the counts for the next flush', async () => {
  await views.count('a');
  Service.bulkWrite.mockRejectedValueOnce(new Error('down'));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  expect(await views.flush()).toBe(0);
  await views.count('a');
  await views.flush();
  expect(incs()).toEqual({ a: 2 });
});

it('with Redis: HINCRBY per view, drained atomically (HGETALL+DEL in one MULTI)', async () => {
  const hash = {};
  const multi = [];
  client = {
    status: 'ready',
    hincrby: async (k, f, n) => (hash[f] = (hash[f] || 0) + n),
    multi: () => {
      const m = { hgetall: () => (multi.push('hgetall'), m), del: () => (multi.push('del'), m), exec: async () => { const all = { ...hash }; for (const f of Object.keys(hash)) delete hash[f]; return [[null, all], [null, 1]]; } };
      return m;
    },
  };
  for (const id of ['x', 'x', 'y']) await views.count(id);
  expect(views._pending.size).toBe(0); // nothing in memory when Redis takes it
  await views.flush();
  expect(multi).toEqual(['hgetall', 'del']);
  expect(incs()).toEqual({ x: 2, y: 1 });
});

it('falls back to memory when the Redis write fails', async () => {
  client = { status: 'ready', hincrby: async () => { throw new Error('boom'); }, multi: () => ({ hgetall() { return this; }, del() { return this; }, exec: async () => { throw new Error('boom'); } }) };
  await views.count('z');
  await views.flush();
  expect(incs()).toEqual({ z: 1 });
});
