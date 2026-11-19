// Run: node src/utils/appVersion.check.mjs
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { appVersionLabel } from './appVersion.ts';

assert.equal(appVersionLabel('1.0.0', '12'), '1.0.0 (12)');
assert.equal(appVersionLabel('1.0.0', null), '1.0.0'); // web: no native build number
assert.equal(appVersionLabel('1.0.0', ''), '1.0.0');
assert.equal(appVersionLabel(undefined, '12'), ''); // no version: the line shows just "Jobblo"
// No screen imports expo-application directly: in an app build made before it was added, the
// import throws and takes the whole route down. Read it through utils/nativeBuildVersion.
const root = new URL('../../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const offenders = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.tsx?$/.test(name) && /from 'expo-application'/.test(readFileSync(path, 'utf8')))
      offenders.push(path);
  }
};
walk(join(root, 'app'));
walk(join(root, 'src'));
assert.deepEqual(offenders, []);
console.log('appVersion: ok');
