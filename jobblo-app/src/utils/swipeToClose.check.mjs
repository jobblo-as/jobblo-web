// Run: node src/utils/swipeToClose.check.mjs
import assert from 'node:assert/strict';
import { shouldClose } from './swipeToClose.ts';

const drag = (x, y, vx = 0, vy = 0) => ({
  translationX: x,
  translationY: y,
  velocityX: vx,
  velocityY: vy,
});

// Down and up both close, by distance or by a quick flick.
for (const single of [true, false]) {
  assert.equal(shouldClose(drag(0, 200), single), true);
  assert.equal(shouldClose(drag(0, -200), single), true);
  assert.equal(shouldClose(drag(0, 40, 0, 1200), single), true);
  assert.equal(shouldClose(drag(0, -40, 0, -1200), single), true);
  // A small, slow drag springs back.
  assert.equal(shouldClose(drag(30, 60), single), false);
}
// Sideways closes only a single photo; with several it turns the page instead.
assert.equal(shouldClose(drag(200, 0), true), true);
assert.equal(shouldClose(drag(-200, 0), true), true);
assert.equal(shouldClose(drag(-40, 0, -1200, 0), true), true);
assert.equal(shouldClose(drag(200, 0), false), false);
assert.equal(shouldClose(drag(-40, 0, -1200, 0), false), false);
console.log('swipeToClose: ok');
