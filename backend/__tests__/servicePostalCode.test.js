const Service = require('../models/Service');

// A job's location keeps a 4-digit Norwegian postnummer; anything else is a validation error (400).
describe('Service location postalCode', () => {
  const errorFor = (postalCode) => new Service({ location: { type: 'Point', coordinates: [10.75, 59.91], postalCode } }).validateSync()?.errors?.['location.postalCode'];

  test('accepts a 4-digit postnummer, or none', () => {
    expect(errorFor('0150')).toBeUndefined();
    expect(errorFor(' 5003 ')).toBeUndefined();
    expect(errorFor(undefined)).toBeUndefined();
    expect(errorFor('')).toBeUndefined();
  });

  test('rejects anything else', () => {
    for (const bad of ['150', '01500', 'abcd', '0150 Oslo']) expect(errorFor(bad)).toBeDefined();
  });
});
