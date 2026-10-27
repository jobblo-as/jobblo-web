// Run: node src/utils/jobPoint.check.mjs
import assert from 'node:assert/strict';
import { jobPoint } from './jobPoint.ts';

// The pin is the exact place the poster chose (API order is [lng, lat]).
assert.deepEqual(jobPoint([10.75219, 59.91373]), { latitude: 59.91373, longitude: 10.75219 });
assert.deepEqual(jobPoint(['5.32415', '60.39299']), { latitude: 60.39299, longitude: 5.32415 });
// No point, a 0,0 placeholder or nonsense → no map.
for (const bad of [undefined, null, [], [0, 0], [NaN, 59], [200, 59], [10, 95], ['x', 'y']])
  assert.equal(jobPoint(bad), null);
console.log('jobPoint: ok');
