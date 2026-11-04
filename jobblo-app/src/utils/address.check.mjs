// Self-check for address.ts. Run: node src/utils/address.check.mjs
import assert from 'node:assert/strict';
import { fullAddress } from './address.ts';

assert.equal(
  fullAddress({ address: 'Oslia 17', postalCode: '2460', city: 'Osen' }),
  'Oslia 17, 2460 Osen'
);
assert.equal(fullAddress({ city: 'Osen' }), 'Osen');
assert.equal(fullAddress({ address: 'Oslia 17' }), 'Oslia 17');
assert.equal(fullAddress(null), '');
console.log('address: all checks passed');
