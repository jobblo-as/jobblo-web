// Run: node src/utils/activeClass.check.mjs
// An `active:` class on a plain View/Text/Image makes NativeWind upgrade it to its own
// Pressable, which then takes taps meant for the Pressable around it (the camera shutter
// needed two presses because of this). Put pressed styles on the Pressable instead.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['app', 'src'];
const PLAIN_WITH_ACTIVE = /<(View|Text|Image)\b[^>]*className=[^>]*\bactive:/g;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

const hits = ROOTS.flatMap(files).flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(PLAIN_WITH_ACTIVE)].map(
    (m) => `${file}: <${m[1]} … active:`
  )
);
assert.deepEqual(hits, [], `active: on a non-pressable element:\n${hits.join('\n')}`);

// The pattern itself still catches the bug that was fixed.
assert.match('<View className="h-4 bg-white active:bg-white/70" />', PLAIN_WITH_ACTIVE);
console.log('activeClass: ok');
