// Self-check for contactUsage.ts. Run: node src/utils/contactUsage.check.mjs
import assert from 'node:assert/strict';
import { contactUsage } from './contactUsage.ts';

// v2 entitlements win.
assert.deepEqual(
  contactUsage({
    entitlements: {
      includedContacts: 5,
      consumedIncludedContacts: 1,
      remainingIncludedContacts: 4,
    },
  }),
  { used: 1, limit: 5, remaining: 4 }
);
// v2 off: plan + monthly usage, never below zero.
assert.deepEqual(
  contactUsage({
    errorCode: 'SUBSCRIPTION_V2_ENTITLEMENTS_DISABLED',
    planFreeContacts: 3,
    monthlyUsage: 5,
  }),
  { used: 5, limit: 3, remaining: 0 }
);
// Any other error, or no data yet: show nothing.
assert.equal(
  contactUsage({ errorCode: 'SUBSCRIPTION_ENTITLEMENTS_UNAVAILABLE', planFreeContacts: 3 }),
  null
);
assert.equal(contactUsage({}), null);
console.log('contactUsage: ok');
