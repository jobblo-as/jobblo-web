const { safePayCalculation, customerTotal } = require('../utils/safePayAmounts');

describe('SafePay amounts: the customer pays the price, the fee comes out of the payout', () => {
  it('390 kr: customer 390, fee 12, provider 378', () => {
    expect(safePayCalculation({ agreedPrice: 390 })).toEqual({
      basePrice: 390,
      fee: 12,
      total: 390,
      providerNet: 378,
    });
  });

  it('an order paid under the old rule keeps what was actually charged', () => {
    expect(customerTotal({ agreedPrice: 390, checkoutAmountMinor: 40200 })).toBe(402);
    expect(safePayCalculation({ agreedPrice: 390, checkoutAmountMinor: 40200 }).providerNet).toBe(
      378
    );
  });

  it('no price is zero, never NaN', () => {
    expect(safePayCalculation({})).toEqual({ basePrice: 0, fee: 0, total: 0, providerNet: 0 });
  });
});
