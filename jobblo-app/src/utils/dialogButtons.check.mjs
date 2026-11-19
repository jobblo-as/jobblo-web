// Run: node src/utils/dialogButtons.check.mjs
import assert from 'node:assert/strict';
import { stackButtons } from './dialogButtons.ts';

assert.equal(stackButtons('Fortsett å redigere', 'Forkast'), true); // the broken edit dialog
assert.equal(stackButtons('Fortsett å redigere', 'Avbryt annonsen'), true);
assert.equal(stackButtons('Avbryt', 'Slett'), false); // short pairs stay side by side
assert.equal(stackButtons('Avbryt', 'Ja, logg ut'), false);
assert.equal(stackButtons('Avbryt', 'Si opp abonnementet'), true);
console.log('dialogButtons: ok');
