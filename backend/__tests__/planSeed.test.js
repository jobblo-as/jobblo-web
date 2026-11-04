// The plan seed only adds missing plans. It deleted every plan and inserted new ones with new
// ids, which cut a live subscription off its plan (subscription_v2.planId pointed at nothing).
jest.mock('../models/SubscriptionPlan', () => ({
  deleteMany: jest.fn(),
  insertMany: jest.fn(),
  bulkWrite: jest.fn(async (ops) => ({ upsertedCount: ops.length })),
}));
const SubscriptionPlan = require('../models/SubscriptionPlan');
const seedPlans = require('../seeds/plan.seed');

test('never deletes or replaces a plan; inserts only those missing (by name + type)', async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  await seedPlans();
  expect(SubscriptionPlan.deleteMany).not.toHaveBeenCalled();
  expect(SubscriptionPlan.insertMany).not.toHaveBeenCalled();
  const ops = SubscriptionPlan.bulkWrite.mock.calls[0][0];
  expect(ops).toHaveLength(6);
  for (const { updateOne } of ops) {
    expect(Object.keys(updateOne.filter).sort()).toEqual(['name', 'type']);
    expect(Object.keys(updateOne.update)).toEqual(['$setOnInsert']);
    expect(updateOne.upsert).toBe(true);
  }
});
