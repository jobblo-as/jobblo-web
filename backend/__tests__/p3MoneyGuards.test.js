/**
 * P3 money guards:
 *  - Two simultaneous shop purchases cannot spend one balance twice.
 *  - Admin dispute amounts must be finite numbers >= 0 with at most two decimals.
 * Models mocked; real controllers.
 */
const captured = {};
jest.mock('../utils/apiResponse', () => ({
  asyncHandler: (fn) => fn,
  sendSuccess: jest.fn(),
  sendError: jest.fn((res, message, status) => {
    captured.error = { message, status };
    return res;
  }),
  buildPagination: jest.fn(),
}));
jest.mock('../utils/pagination', () => ({
  parsePagination: jest.fn(),
  parseObjectId: jest.fn((v) => v),
  parseSort: jest.fn(),
  parseDate: jest.fn(),
}));
jest.mock('../models/Dispute', () => ({ findById: jest.fn() }));
jest.mock('../models/Order', () => ({}));
jest.mock('../models/Payment', () => ({}));
jest.mock('../models/Payout', () => ({}));
jest.mock('../models/SafePayHistory', () => ({}));
jest.mock('../models/ChatMessage', () => ({}));
jest.mock('../models/Notification', () => ({}));
jest.mock('../models/JobbloShop', () => ({ findById: jest.fn() }));
jest.mock('../models/User', () => ({
  findById: jest.fn(),
  findOneAndUpdate: jest.fn(),
  exists: jest.fn(),
}));
jest.mock('../services/admin/activityService', () => ({ logActivity: jest.fn() }));
jest.mock('../utils/errorLogger', () => ({ logApplicationError: jest.fn() }));
jest.mock('../config/stripe', () => ({ getStripe: jest.fn(), getStripeForMode: jest.fn() }));
jest.mock('../services/stripe/financialOperations', () => ({
  executeRefund: jest.fn(),
  executeTransferReversal: jest.fn(),
}));

const Dispute = require('../models/Dispute');
const JobbloShop = require('../models/JobbloShop');
const User = require('../models/User');

beforeEach(() => {
  jest.clearAllMocks();
  captured.error = null;
});

describe('shop purchase', () => {
  const { buyItem } = require('../controllers/JobbloShopController');
  const tick = () => new Promise((r) => setImmediate(r));

  it('only one of two concurrent purchases spends the balance', async () => {
    const row = { _id: 'u1', pointsBalance: 10, pointsHistory: [] };
    JobbloShop.findById.mockResolvedValue({
      _id: 'item1',
      title: 'Boost',
      coins: 10,
      isActive: true,
    });
    // A read-modify-write sees a snapshot and writes it back later (the old race)...
    User.findById.mockImplementation(async () => {
      const snap = { ...row, pointsHistory: [...row.pointsHistory] };
      snap.save = async () => {
        await tick();
        Object.assign(row, {
          pointsBalance: snap.pointsBalance,
          pointsHistory: snap.pointsHistory,
        });
      };
      return snap;
    });
    // ...while a conditional update is atomic.
    User.findOneAndUpdate.mockImplementation(async (filter, update) => {
      await tick();
      if (row.pointsBalance < filter.pointsBalance.$gte) return null;
      row.pointsBalance += update.$inc.pointsBalance;
      row.pointsHistory.push(update.$push.pointsHistory);
      return { pointsBalance: row.pointsBalance };
    });
    User.exists.mockResolvedValue(true);

    const results = await Promise.all(
      [1, 2].map(async () => {
        const res = {
          code: 200,
          status(c) {
            this.code = c;
            return this;
          },
          json() {
            return this;
          },
        };
        await buyItem({ body: { id: 'item1' }, user: { id: 'u1' } }, res);
        return res.code;
      })
    );
    expect(results.sort()).toEqual([200, 400]);
    expect(row.pointsBalance).toBe(0);
    expect(row.pointsHistory).toHaveLength(1);
  });
});

describe('admin dispute amounts', () => {
  const { resolveDispute } = require('../controllers/admin/disputesAdminController');
  const run = (body) =>
    resolveDispute(
      {
        params: { disputeId: 'd1' },
        body: { outcome: 'partial_refund', reason: 'ok', ...body },
        user: { _id: 'a1' },
        ip: '1',
        headers: {},
      },
      {},
      jest.fn()
    );

  it.each([
    ['a negative amount', { customerAmount: -100 }],
    ['a string', { providerAmount: '100' }],
    ['NaN-ish', { customerAmount: Infinity }],
    ['three decimals', { customerAmount: 10.005 }],
  ])('refuses %s before touching the dispute', async (_l, body) => {
    Dispute.findById.mockReturnValue({ populate: async () => null });
    await run(body);
    expect(captured.error).toMatchObject({ status: 400 });
    expect(Dispute.findById).not.toHaveBeenCalled();
  });

  it('accepts whole and two-decimal amounts', async () => {
    Dispute.findById.mockReturnValue({ populate: async () => null });
    await run({ customerAmount: 100.25, providerAmount: 0 });
    expect(Dispute.findById).toHaveBeenCalled(); // got past validation (then 404 on the mocked dispute)
  });
});
