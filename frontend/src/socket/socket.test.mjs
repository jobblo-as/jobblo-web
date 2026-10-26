// node --experimental-test-module-mocks --test src/socket/socket.test.mjs
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
const fakeSocket = {
  connected: true,
  on: (e, fn) => calls.push(['on', e, fn]),
  off: (e, fn) => calls.push(['off', e, fn]),
  emit: (...a) => calls.push(['emit', ...a]),
  connect: () => calls.push(['connect']),
  disconnect: () => calls.push(['disconnect']),
};
mock.module('socket.io-client', { namedExports: { io: () => fakeSocket } });
mock.module(new URL('../config/env.ts', import.meta.url).href, { namedExports: { API_BASE_URL: 'http://test' } });

const { initSocket, disconnectSocket } = await import('./socket.ts');
// Wait for the lazy import itself, not a fixed delay: on a busy machine it takes longer than 100 ms.
const loaded = async () => {
  for (let i = 0; i < 250 && !initSocket().connected; i++) await new Promise((r) => setTimeout(r, 20));
};

test('calls made before the library loads are replayed on the real socket', async () => {
  const a = () => {};
  const b = () => {};
  const s = initSocket();
  assert.equal(s.connected, false); // nothing loaded yet
  s.on('msg', a).on('msg', b).off('msg', b); // b removed while still queued
  s.emit('join', 'u1');
  await loaded();
  const replayed = calls.filter(([k, e]) => k === 'on' && e === 'msg');
  assert.deepEqual(replayed.map((c) => c[2]), [a]);
  assert.ok(calls.some(([k, e, v]) => k === 'emit' && e === 'join' && v === 'u1'));
  assert.equal(s.connected, true);

  s.emit('join-chat', 'c1'); // after load: forwarded straight away
  assert.deepEqual(calls.at(-1), ['emit', 'join-chat', 'c1']);
});

test('disconnect drops the socket and the next init makes a new one', async () => {
  disconnectSocket();
  assert.deepEqual(calls.at(-1), ['disconnect']);
  assert.equal(initSocket().connected, false);
  await loaded();
  assert.equal(initSocket().connected, true);
});

test('a refused handshake refreshes the session and reconnects (socket.io never retries it)', async () => {
  const profile = [];
  mock.module(new URL('../api/mainURLs.ts', import.meta.url).href, { defaultExport: { get: async (u) => profile.push(u) } });
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    fakeSocket.active = false;
    const onError = calls.filter(([k, e]) => k === 'on' && e === 'connect_error').at(-1)[2];
    onError(new Error('Socket auth failed'));
    onError(new Error('Socket auth failed')); // one retry pending at a time
    mock.timers.tick(5000);
    mock.timers.reset();
    // The retry imports mainURLs lazily; wait for its reconnect rather than a fixed delay.
    for (let i = 0; i < 250 && calls.at(-1)?.[0] !== 'connect'; i++) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(profile, ['/api/auth/profile']);
    assert.deepEqual(calls.at(-1), ['connect']);
  } finally {
    mock.timers.reset();
  }
});
