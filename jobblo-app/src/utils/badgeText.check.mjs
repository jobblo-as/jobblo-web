// Run: node src/utils/badgeText.check.mjs
import assert from 'node:assert/strict';
const { badgeText } = await import('./badgeText.ts');

assert.equal(badgeText('bg-tint text-brand-text'), 'text-brand-text');
assert.equal(badgeText('border border-line bg-surface text-muted'), 'text-muted');
assert.equal(
  badgeText('bg-[#FFF6E8] dark:bg-warn-tint text-[#A36A1C] dark:text-warn'),
  'text-[#A36A1C] dark:text-warn'
);
assert.equal(badgeText('bg-surface-2'), '');
console.log('badgeText: ok');
