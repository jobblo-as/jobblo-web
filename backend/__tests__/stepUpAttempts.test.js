/**
 * Step-up / MFA-setup e-mail code: at most MAX_ATTEMPTS guesses per code, even in parallel.
 * The old read-compare-then-save let N concurrent guesses share one attempt.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const tick = () => new Promise((r) => setImmediate(r));
let row;
jest.mock('../models/StepUpOtp', () => ({
  // Old path: a snapshot that is written back later (the lost update).
  findOne: jest.fn(() => ({
    sort: async () => {
      if (!row) return null;
      const snap = {
        ...row,
        save: async () => {
          await tick();
          row.attempts = snap.attempts;
        },
      };
      return snap;
    },
  })),
  // New path: atomic conditional increment.
  findOneAndUpdate: jest.fn(async (filter, update) => {
    await tick();
    if (!row || row.attempts >= filter.attempts.$lt) return null;
    row.attempts += update.$inc.attempts;
    return { ...row };
  }),
  exists: jest.fn(async () => Boolean(row)),
  deleteMany: jest.fn(async () => {
    row = null;
  }),
}));

const { verifyCode, hashCode } = require('../services/developer/stepUp');

it('20 parallel wrong guesses are compared at most 5 times', async () => {
  row = {
    userId: 'u1',
    codeHash: hashCode('111111'),
    attempts: 0,
    expiresAt: new Date(Date.now() + 60000),
  };
  const guesses = Array.from({ length: 20 }, (_, i) => String(200000 + i));
  const results = await Promise.allSettled(guesses.map((g) => verifyCode({ _id: 'u1' }, 's1', g)));
  const compared = results.filter(
    (r) => r.status === 'rejected' && /^Wrong code/.test(r.reason.message)
  );
  expect(compared.length).toBeLessThanOrEqual(5);
  expect(results.filter((r) => r.reason?.status === 429).length).toBeGreaterThanOrEqual(15);
  // The right code no longer works once the attempts are spent.
  await expect(verifyCode({ _id: 'u1' }, 's1', '111111')).rejects.toMatchObject({ status: 429 });
});

it('the right code within the limit still succeeds and deletes the code', async () => {
  row = {
    userId: 'u1',
    codeHash: hashCode('111111'),
    attempts: 0,
    expiresAt: new Date(Date.now() + 60000),
  };
  await expect(verifyCode({ _id: 'u1' }, 's1', '111111')).resolves.toHaveProperty('token');
  expect(row).toBeNull();
});
