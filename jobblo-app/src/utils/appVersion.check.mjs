// Run: node src/utils/appVersion.check.mjs
import assert from 'node:assert/strict';
import { appVersionLabel } from './appVersion.ts';

assert.equal(appVersionLabel('1.0.0', '12'), '1.0.0 (12)');
assert.equal(appVersionLabel('1.0.0', null), '1.0.0'); // web: no native build number
assert.equal(appVersionLabel('1.0.0', ''), '1.0.0');
assert.equal(appVersionLabel(undefined, '12'), ''); // no version: the line shows just "Jobblo"
console.log('appVersion: ok');
