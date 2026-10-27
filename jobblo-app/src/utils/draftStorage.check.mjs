// Check for draftStorage.ts (security review M9: drafts must not survive logout).
// Run: node src/utils/draftStorage.check.mjs
import assert from 'node:assert/strict';

const data = new Map();
globalThis.require = () => ({
  getItem: async (k) => data.get(k) ?? null,
  setItem: async (k, v) => void data.set(k, v),
  removeItem: async (k) => void data.delete(k),
});
const { createJobDraftKey, clearUserDrafts } = await import('./draftStorage.ts');
delete globalThis.require;

assert.notEqual(createJobDraftKey('u1'), createJobDraftKey('u2'), 'drafts are per account');
data.set('jobblo-create-job-draft', 'legacy shared draft');
data.set(createJobDraftKey('u1'), 'u1 address');
data.set(createJobDraftKey('u2'), 'u2 address');
await clearUserDrafts('u1');
assert.equal(data.has(createJobDraftKey('u1')), false, 'logout clears own draft');
assert.equal(data.has('jobblo-create-job-draft'), false, 'pre-scoping shared draft cleared');
assert.equal(data.get(createJobDraftKey('u2')), 'u2 address', 'other accounts untouched');
console.log('draftStorage: all checks passed');
