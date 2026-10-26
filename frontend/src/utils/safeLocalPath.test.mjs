// node --test src/utils/safeLocalPath.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { safeLocalPath } from './safeLocalPath.ts';

const O = 'https://jobblo.no';

test('keeps same-site paths', () => {
  assert.equal(safeLocalPath('/developer/queues?tab=1#x', '/', O), '/developer/queues?tab=1#x');
});

test('rejects paths the browser resolves to another host', () => {
  for (const p of ['//evil.com', '/\\evil.com', '/\t/evil.com', '/\n/evil.com', 'https://evil.com', 'evil.com', '', null]) {
    assert.equal(safeLocalPath(p, '/', O), '/', JSON.stringify(p));
  }
});
