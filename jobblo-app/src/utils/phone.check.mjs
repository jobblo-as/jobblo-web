// Self-check for phone.ts. Run: node src/utils/phone.check.mjs
import assert from 'node:assert/strict';
import { formatPhone, norwegianPhone, phoneDigits } from './phone.ts';

assert.equal(phoneDigits('+47 412 34 567'), '41234567');
assert.equal(phoneDigits('004798765432'), '98765432');
assert.equal(phoneDigits('412345678901'), '41234567');

assert.equal(norwegianPhone('+47 412 34 567'), '41234567');
assert.equal(norwegianPhone('22123456'), '22123456');
assert.equal(norwegianPhone('1234'), null);
assert.equal(norwegianPhone('01234567'), null);
assert.equal(norwegianPhone(undefined), null);

assert.equal(formatPhone('41234567'), '412 34 567');
assert.equal(formatPhone('+4791234567'), '912 34 567');
assert.equal(formatPhone('22123456'), '22 12 34 56');
assert.equal(formatPhone('4123'), '412 3'); // while typing
assert.equal(formatPhone(''), '');

console.log('phone: all checks passed');
