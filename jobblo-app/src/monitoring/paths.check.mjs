// Check for paths.ts (what the mobile reporter sends as an API path).
// Run: node src/monitoring/paths.check.mjs
import assert from 'node:assert/strict';
import { templatePath } from './paths.ts';

assert.equal(templatePath('/services/6ad90a9e94221dfd9681ff17/apply?token=secret'), '/services/:id/apply');
assert.equal(templatePath('https://api.jobblo.no/api/orders/6AD90A9E94221DFD9681FF17'), '/orders/:id');
assert.equal(templatePath('/notifications/42/read'), '/notifications/:id/read');
assert.equal(templatePath('/auth/profile'), '/auth/profile');
assert.equal(templatePath('/apiary/list'), '/apiary/list'); // only a leading /api/ segment is stripped
assert.equal(templatePath(undefined), '');
// Screen paths (security review P3): ids and Stripe session ids out.
assert.equal(templatePath('/safepay/success/cs_live_a1B2c3D4e5F6g7H8'), '/safepay/success/:id');
assert.equal(templatePath('/safepay/success?session_id=cs_test_a1B2c3D4e5'), '/safepay/success');
assert.equal(templatePath('/messages/6ad90a9e94221dfd9681ff17'), '/messages/:id');
assert.equal(templatePath('/payouts/acct_1Pq2Rs3Tu4Vw5Xy6/pi_3AbC4dEf5GhI6jKl'), '/payouts/:id/:id');
assert.equal(templatePath('/x/123e4567-e89b-12d3-a456-426614174000'), '/x/:id');
assert.equal(templatePath('/push_tokens/current'), '/push_tokens/current');
assert.equal(templatePath('/profile/settings/safepay'), '/profile/settings/safepay');
console.log('paths.check: ok');
