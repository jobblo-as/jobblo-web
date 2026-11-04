// Self-check for the bug report store. Run: node src/features/bugReport/store.check.mjs
import assert from 'node:assert/strict';
import { useBugReport } from './store.ts';

const s = () => useBugReport.getState();
s().trackScreen('/jobs/123');
s().trackScreen('/profile/settings');
s().trackScreen('/profile/settings/notifications');
assert.equal(s().lastScreen, '/jobs/123', 'settings screens are not the screen reported');
s().trackScreen('/messages/abc');
assert.equal(s().lastScreen, '/messages/abc');
s().openBugReport();
assert.equal(s().open, true);
s().closeBugReport();
assert.equal(s().open, false);
console.log('bugReport store: all checks passed');
