// Run: node src/utils/edgeSwipe.check.mjs
import assert from 'node:assert/strict';
import { edgeSwipeEnabled, isBackSwipe } from './edgeSwipe.ts';

// Pages with no native swipe-back: the app adds one.
for (const path of [
  '/jobs/abc123',
  '/users/u1',
  '/job-applicants/s1',
  '/provider/orders/o1',
  '/safepay/checkout/o1',
  '/safepay/success',
  '/disputes/create',
  '/explore',
  '/recommended-taskers',
  '/my-applications',
  '/my-jobs',
  '/favorites',
  '/favorites/',
])
  assert.equal(edgeSwipeEnabled(path), true, path);

// Tab roots and screens that already have the native iOS swipe: left alone.
for (const path of [
  '/',
  '/create-job',
  '/messages',
  '/messages/c1',
  '/alerts',
  '/profile',
  '/profile/settings/addresses',
  '/favorites/l1',
  '/jobs',
  '/users',
])
  assert.equal(edgeSwipeEnabled(path), false, path);

// Far enough, or a quick flick; a short slow drag or a leftward one is not "back".
assert.equal(isBackSwipe({ translationX: 90, velocityX: 0 }), true);
assert.equal(isBackSwipe({ translationX: 30, velocityX: 900 }), true);
assert.equal(isBackSwipe({ translationX: 40, velocityX: 100 }), false);
assert.equal(isBackSwipe({ translationX: -120, velocityX: -900 }), false);
console.log('edgeSwipe: ok');
