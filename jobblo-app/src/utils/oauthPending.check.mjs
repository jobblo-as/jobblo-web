// Check for oauthPending.ts (security review H1). Run: node src/utils/oauthPending.check.mjs
import assert from 'node:assert/strict';
import { decideOAuthLink, OAUTH_PENDING_TTL_MS } from './oauthPending.ts';

const now = 1_800_000_000_000;
assert.equal(decideOAuthLink(now - 1000, false, now), 'accept', 'sign-in started a second ago');
assert.equal(decideOAuthLink(now - OAUTH_PENDING_TTL_MS + 1, false, now), 'accept', 'just inside the window');
assert.equal(decideOAuthLink(now - OAUTH_PENDING_TTL_MS - 1, false, now), 'not-started', 'too old');
assert.equal(decideOAuthLink(null, false, now), 'not-started', 'link with no sign-in started (attacker link)');
assert.equal(decideOAuthLink(0, false, now), 'not-started');
assert.equal(decideOAuthLink(now + 60_000, false, now), 'not-started', 'timestamp in the future');
assert.equal(decideOAuthLink(now - 1000, true, now), 'already-signed-in', 'never switch a signed-in account');
assert.equal(decideOAuthLink(null, true, now), 'already-signed-in');
console.log('oauthPending: all checks passed');
