// node --test src/features/chat/refreshChats.test.mjs
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { applyIncomingMessage, applyMessagesRead, refreshChats } from './refreshChats.ts';

const fakeClient = (data) => ({
  data,
  get: (key) => data[key.join(':')],
  setQueryData(key, update) {
    const k = key.join(':');
    const next = update(data[k]);
    if (next !== undefined) data[k] = next;
  },
});

test('a socket message goes into the list and the thread once, newest chat first, sender populated', () => {
  const alice = { _id: 'a', name: 'Alice', avatarUrl: 'x.png' };
  const qc = fakeClient({
    chats: [
      { _id: 'c2', messages: [] },
      { _id: 'c1', messages: [{ _id: 'm0', text: 'old' }] },
    ],
    'chat:c1': {
      _id: 'c1',
      clientId: alice,
      providerId: { _id: 'b', name: 'Bob' },
      messages: [{ _id: 'm0', text: 'old' }],
    },
  });
  const msg = {
    _id: 'm1',
    senderId: 'a',
    text: 'hei',
    createdAt: '2026-10-27T10:00:00Z',
    seenBy: ['a'],
  };
  assert.equal(applyIncomingMessage(qc, 'c1', msg), true);
  assert.equal(applyIncomingMessage(qc, 'c1', msg), true); // the echo of our own send
  assert.deepEqual(
    qc.get(['chats']).map((c) => c._id),
    ['c1', 'c2']
  );
  assert.equal(qc.get(['chats'])[0].messages[0].text, 'hei');
  const thread = qc.get(['chat', 'c1']).messages;
  assert.deepEqual(
    thread.map((m) => m._id),
    ['m0', 'm1']
  );
  assert.equal(thread[1].senderId.name, 'Alice');
});

test('a chat the list does not have yet, or a message without an id, asks for a refetch', () => {
  const qc = fakeClient({ chats: [{ _id: 'c1', messages: [] }] });
  assert.equal(applyIncomingMessage(qc, 'new', { _id: 'm1', senderId: 'a', text: 'x' }), false);
  assert.equal(applyIncomingMessage(qc, 'c1', { senderId: 'a', text: 'x' }), false);
});

test('messages-read adds the reader to seenBy in list and thread, once', () => {
  const qc = fakeClient({
    chats: [{ _id: 'c1', messages: [{ _id: 'm1', senderId: 'a', seenBy: ['a'] }] }],
    'chat:c1': { _id: 'c1', messages: [{ _id: 'm1', senderId: 'a', seenBy: [{ _id: 'a' }] }] },
  });
  applyMessagesRead(qc, 'c1', 'b');
  applyMessagesRead(qc, 'c1', 'b');
  assert.deepEqual(qc.get(['chats'])[0].messages[0].seenBy, ['a', 'b']);
  assert.equal(qc.get(['chat', 'c1']).messages[0].seenBy.length, 2);
});

test('a burst of refreshes becomes one refetch per query', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const invalidated = [];
    const qc = { invalidateQueries: ({ queryKey }) => invalidated.push(queryKey.join(':')) };
    refreshChats(qc, 'c1');
    refreshChats(qc, 'c1');
    refreshChats(qc);
    refreshChats(qc, 'c2');
    assert.deepEqual(invalidated, []);
    mock.timers.tick(150);
    assert.deepEqual(invalidated, ['chats', 'chat:c1', 'chat:c2']);
  } finally {
    mock.timers.reset();
  }
});
