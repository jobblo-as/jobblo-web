// Check for evidenceFile.ts (signed evidence URLs, PDF detection, openDocument never throws).
// Run: node src/utils/evidenceFile.check.mjs
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve: (s, c, next) =>
    s === 'react-native' ? { url: 'stub:rn', shortCircuit: true } : next(s, c),
  load: (u, c, next) =>
    u === 'stub:rn'
      ? {
          format: 'module',
          shortCircuit: true,
          source:
            'export const Linking = globalThis.__linking; export const Alert = { alert: (...a) => globalThis.__alerts.push(a) };',
        }
      : next(u, c),
});
globalThis.__alerts = [];
globalThis.__linking = {
  canOpenURL: async () => {
    throw new Error('no handler');
  },
  openURL: async () => {},
};
const { isPdfUrl, openDocument } = await import('./evidenceFile.ts');

assert.equal(
  isPdfUrl('https://x.blob.core.windows.net/e/after.pdf?sv=2024&sig=abc'),
  true,
  'signed URL'
);
assert.equal(isPdfUrl('https://x/e/AFTER.PDF#page=2'), true);
assert.equal(isPdfUrl('https://x/e/photo.jpg?name=a.pdf'), false, 'only the path counts');
assert.equal(isPdfUrl('https://x/e/photo.jpg'), false);
await openDocument('https://x/e/a.pdf'); // must not throw
assert.equal(globalThis.__alerts.length, 1, 'failure shown to the user');
console.log('evidenceFile: all checks passed');
