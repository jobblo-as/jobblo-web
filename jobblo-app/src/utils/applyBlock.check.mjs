// Run: node src/utils/applyBlock.check.mjs
import assert from 'node:assert/strict';
import { applyBlockReason } from './applyBlock.ts';

// Open, or nothing loaded yet: the user may apply. A declined request may apply again.
for (const job of [
  undefined,
  null,
  {},
  { status: 'open' },
  { status: 'open', isLimitReached: false },
])
  assert.equal(applyBlockReason(job), null);
assert.equal(applyBlockReason({ status: 'open' }, 'declined'), null);

// Every status the backend refuses blocks the button (these four were missing before).
for (const status of ['awaiting_payment', 'paid', 'in_progress', 'waiting_for_approval'])
  assert.equal(applyBlockReason({ status }), 'Utfører er valgt');
for (const status of ['completed', 'closed', 'cancelled', 'expired', 'draft'])
  assert.ok(applyBlockReason({ status })?.startsWith('Oppdraget '));

// Full applicant list (maxApplicants reached).
assert.equal(applyBlockReason({ status: 'open', isLimitReached: true }), 'Fulltegnet');

// The user's own request: pending, or accepted (it could be sent again before).
assert.equal(applyBlockReason({ status: 'open' }, 'pending'), 'Forespørsel sendt');
assert.equal(applyBlockReason({ status: 'open' }, 'accepted'), 'Forespørsel godkjent');
// The chosen provider sees their own state; a full list does not hide a pending request.
assert.equal(applyBlockReason({ status: 'awaiting_payment' }, 'accepted'), 'Forespørsel godkjent');
assert.equal(
  applyBlockReason({ status: 'open', isLimitReached: true }, 'pending'),
  'Forespørsel sendt'
);
// A finished job says so first.
assert.equal(applyBlockReason({ status: 'completed' }, 'accepted'), 'Oppdraget er fullført');
console.log('applyBlock: ok');
