// Run: node src/utils/sectionRoots.check.mjs
// A link straight into a tab section (Stripe return to profile/settings/payout, a chat from a
// push) must still get the section's first page underneath, or back and the tab do nothing.
// And "Rediger" right after publishing needs the owner list refreshed by the create mutation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const ROOT = /export const unstable_settings = \{ anchor: 'index' \}/;

for (const section of ['profile', 'messages']) {
  assert.match(read(`app/(app)/${section}/_layout.tsx`), ROOT, `${section} needs index underneath`);
}

const createHook = read('src/hooks/useCreateJob.ts');
const createMutation = createHook.slice(0, createHook.indexOf('useUpdateJobMutation'));
assert.match(createMutation, /queryKeys\.jobs\.mine/, 'publishing must refresh the owner list');

// The apply dialog is a native Modal: it must close before "Fullfør Stripe Connect" navigates,
// and Utbetalinger must know where it was opened from so back returns there.
const jobPage = read('app/(app)/jobs/[id].tsx');
assert.match(
  jobPage,
  /onGoToPayout=\{\(\) => \{[\s\S]*?setIsApplyModalOpen\(false\);[\s\S]*?from: 'job'[\s\S]*?withAnchor: true/,
  'apply dialog must close, then open Utbetalinger with from=job and its anchor'
);
assert.match(
  read('app/(app)/provider/orders/[orderId].tsx'),
  /from: 'order'[\s\S]*?withAnchor: true/
);
const payout = read('app/(app)/profile/settings/payout.tsx');
assert.match(
  payout,
  /getParent\(\)\?\.goBack\(\);\s*navigation\.dispatch\(\{ type: 'POP_TO_TOP' \}\)/
);
assert.match(payout, /onBack=\{fromElsewhere \? leaveToCaller : undefined\}/);

console.log('sectionRoots: ok');
