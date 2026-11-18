// Run: node src/utils/locationPermissionStep.check.mjs
import assert from 'node:assert/strict';
import { locationPermissionStep } from './locationPermissionStep.ts';

// Already allowed: no sheet at all.
assert.equal(locationPermissionStep({ granted: true, canAskAgain: true }), 'granted');
assert.equal(locationPermissionStep({ granted: true, canAskAgain: false }), 'granted');
// Never asked, or "Don't allow" once on Android (it may ask again): explainer, then the prompt.
assert.equal(locationPermissionStep({ granted: false, canAskAgain: true }), 'ask');
assert.equal(locationPermissionStep(undefined), 'ask');
assert.equal(locationPermissionStep({ granted: false }), 'ask');
// Denied for good (iOS after "Don't allow", Android "don't ask again"): only Settings helps.
assert.equal(locationPermissionStep({ granted: false, canAskAgain: false }), 'settings');
console.log('locationPermissionStep: ok');
