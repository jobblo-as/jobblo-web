// Client review P2: text at least 13 pt and no light-grey text. Fails on new small/pale text.
// Run: node src/theme/textSize.check.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import assert from 'node:assert/strict';

const root = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const SMALL = /text-\[(0\.[0-7]\d*rem|[0-9]px|1[0-2]px)\]|fontSize: ?([0-9]|1[0-2])\b|text-(xs|\[0\.6875rem\])/;
// Deliberately small: tab bar labels (Apple's size), badge digits and a tick in fixed tiny circles.
const ALLOWED = [
  ['app/(app)/_layout.tsx', 'fontSize: 10'],
  ['src/components/GlassTabBar.tsx', 'fontSize: 11'],
  ['app/(auth)/register.tsx', '✓</Text>'],
  ['app/(app)/messages/index.tsx', "charAt(0) || 'U'"],
];
const bad = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.tsx')) {
      const rel = relative(root, p).replace(/\\/g, '/');
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        const allowed = ALLOWED.some(([f, s]) => rel === f && line.includes(s));
        if ((SMALL.test(line) && !allowed) || line.includes('text-subtle')) bad.push(`${rel}:${i + 1}`);
      });
    }
  }
};
walk(join(root, 'app'));
walk(join(root, 'src'));
assert.deepEqual(bad, [], `text smaller than 13 pt or light grey (text-subtle):\n${bad.join('\n')}`);
console.log('text size: ok');
