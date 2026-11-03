// Run: node src/types/jobLabels.check.mjs
import assert from 'node:assert/strict';
const { formatDuration, equipmentLabel } = await import('./Jobs.ts');

assert.equal(formatDuration({ value: 3, unit: 'hours' }), '3 timer');
assert.equal(formatDuration({ value: 1, unit: 'hours' }), '1 time');
assert.equal(formatDuration({ value: 1, unit: 'days' }), '1 dag');
assert.equal(formatDuration({ value: 30, unit: 'minutter' }), '30 minutter');
assert.equal(formatDuration({ value: 2 }), '2 timer');
assert.equal(formatDuration({ value: 0, unit: 'hours' }), null);
assert.equal(formatDuration(undefined), null);
assert.equal(equipmentLabel('utstyrfri'), 'Ingen utstyr nødvendig');
assert.equal(equipmentLabel('trengs utstyr'), 'Utstyr må medbringes');
assert.equal(equipmentLabel(undefined), null);
console.log('jobLabels: ok');
