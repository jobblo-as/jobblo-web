// Run: node src/utils/similarJobs.check.mjs
import assert from 'node:assert/strict';
import { appliedJobIdsOf, visibleSimilarJobs } from './similarJobs.ts';

const job = (id, owner) => ({ _id: id, userId: { _id: owner } });
const server = [job('a', 'me'), job('b', 'x'), job('c', 'y'), job('d', 'x')];

// Own jobs and applied-to jobs are dropped; the server order (near first) stays.
const applied = appliedJobIdsOf([
  { serviceId: { _id: 'c' }, status: 'pending' },
  { serviceId: 'd', status: 'declined' }, // declined: may apply again, so it stays
]);
assert.deepEqual(
  visibleSimilarJobs(server, { viewerId: 'me', appliedJobIds: applied }).map((j) => j._id),
  ['b', 'd']
);

// Signed out: nothing to drop. A bare owner id works too.
assert.deepEqual(
  visibleSimilarJobs([job('a', 'me'), { _id: 'e', userId: 'me' }], {}).map((j) => j._id),
  ['a', 'e']
);
assert.deepEqual(visibleSimilarJobs([{ _id: 'e', userId: 'me' }], { viewerId: 'me' }), []);

// A request someone else sent to the viewer's job is not the viewer's application.
assert.deepEqual(
  [
    ...appliedJobIdsOf(
      [
        { serviceId: 'mine', customerId: { _id: 'someone' }, status: 'pending' },
        { serviceId: 'theirs', customerId: 'me', status: 'accepted' },
      ],
      'me'
    ),
  ],
  ['theirs']
);

// No cap: every job of every loaded page shows (pagination loads more), each one once.
const many = Array.from({ length: 30 }, (_, i) => job(String(i), 'x'));
assert.equal(visibleSimilarJobs(many, {}).length, 30);
assert.deepEqual(
  visibleSimilarJobs([job('a', 'x'), job('b', 'x'), job('a', 'x')], {}).map((j) => j._id),
  ['a', 'b']
);
// No list at all is an empty list.
assert.deepEqual(visibleSimilarJobs(undefined, {}), []);
assert.equal(appliedJobIdsOf(undefined).size, 0);

console.log('similarJobs: ok');
