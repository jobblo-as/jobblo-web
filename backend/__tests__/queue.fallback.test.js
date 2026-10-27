/**
 * The queue must never lose work or fail a request because Redis is missing or down:
 * without REDIS_URL jobs run in-process; with REDIS_URL pointing at a dead server the
 * enqueue times out and the job runs in-process instead.
 */
jest.mock('../services/pushNotifications', () => ({
  deliverPush: jest.fn().mockResolvedValue(undefined),
}));

const until = async (fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
};

afterEach(async () => {
  await require('../config/redis').closeRedis();
  delete process.env.REDIS_URL;
  delete process.env.REDIS_IN_TESTS;
  jest.resetModules();
});

it('without Redis: runs the handler in-process, after the caller returns', async () => {
  delete process.env.REDIS_URL;
  const { enqueue } = require('../services/queue');
  const { deliverPush } = require('../services/pushNotifications');
  const r = await enqueue('push', 'send', { userId: 'u1', message: { title: 'x' } });
  expect(r).toEqual({ id: null, inline: true });
  await until(() => deliverPush.mock.calls.length === 1);
});

it('Redis configured but down: falls back to in-process within the enqueue timeout', async () => {
  process.env.REDIS_URL = 'redis://127.0.0.1:1'; // nothing listens on port 1
  process.env.REDIS_IN_TESTS = 'true';
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const { enqueue } = require('../services/queue');
  const { deliverPush } = require('../services/pushNotifications');
  // Load BullMQ before timing: its first require can take seconds while the whole suite runs
  // in parallel, which made this test flaky. What is measured is the 3 s enqueue fallback.
  require('bullmq');
  const started = Date.now();
  const r = await enqueue('push', 'send', { userId: 'u2', message: {} });
  expect(r.inline).toBe(true);
  expect(Date.now() - started).toBeLessThan(5000);
  await until(() => deliverPush.mock.calls.length === 1);
}, 20000); // total wait, incl. the in-process run, under a loaded full-suite run

it('an unknown job is a programming error and throws', async () => {
  const { enqueue } = require('../services/queue');
  await expect(enqueue('push', 'nope', {})).rejects.toThrow(/No handler/);
  await expect(enqueue('nope', 'send', {})).rejects.toThrow(/No handler/);
});

it('OTP codes never sit in a job payload in clear text', async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  const { sealOtp } = require('../services/queue/handlers');
  const sealed = sealOtp('123456');
  expect(sealed).not.toContain('123456');
  expect(require('../utils/secretBox').createBox('queued-otp').open(sealed).toString()).toBe(
    '123456'
  );
  // Sealed for the queue ≠ readable as an authenticator secret.
  expect(() => require('../utils/secretBox').createBox('totp-secret').open(sealed)).toThrow();
});

it('the console sees job data redacted: no codes, masked emails, push text reduced to its title', () => {
  const { redactJobData } = require('../services/queue/admin');
  expect(redactJobData({ to: 'kari.nord@example.no', name: 'Kari', otpSealed: 'v1:abc' })).toEqual({
    to: expect.not.stringContaining('kari.nord'),
    name: 'Kari',
    otpSealed: '[hidden]',
  });
  expect(
    redactJobData({
      userId: 'u1',
      message: { title: 'Ny melding', body: 'Hei, ring meg på 91234567', data: {} },
    })
  ).toEqual({ userId: 'u1', message: { title: 'Ny melding', fields: ['title', 'body', 'data'] } });
  expect(redactJobData({ job: 'reconcileMoneyState' })).toEqual({ job: 'reconcileMoneyState' });
});

it('Redis slow, not down: a job that lands after the fallback is withdrawn, so it runs once', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  let land;
  const remove = jest.fn().mockResolvedValue(undefined);
  jest.doMock('bullmq', () => ({
    Queue: jest.fn(() => ({
      on: () => {},
      add: () =>
        new Promise((r) => {
          land = r;
        }),
    })),
  }));
  jest.doMock('../config/redis', () => ({
    enabled: () => true,
    bullConnection: () => ({}),
    PREFIX: 't',
    closeRedis: async () => {},
  }));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const { enqueue } = require('../services/queue');
    const { deliverPush } = require('../services/pushNotifications');
    const pending = enqueue('push', 'send', { userId: 'u3', message: {} });
    await jest.advanceTimersByTimeAsync(3000);
    expect((await pending).inline).toBe(true);
    land({ id: 'late', remove });
    await Promise.resolve();
    await Promise.resolve();
    expect(remove).toHaveBeenCalled();
    jest.useRealTimers();
    await until(() => deliverPush.mock.calls.length === 1);
  } finally {
    jest.useRealTimers();
    jest.dontMock('bullmq');
    jest.dontMock('../config/redis');
  }
});

it('Redis down: queue errors are logged once per 30 s, not once per reconnect attempt', () => {
  const listeners = {};
  jest.doMock('bullmq', () => ({
    Queue: jest.fn(() => ({ on: (ev, fn) => (listeners[ev] = fn) })),
  }));
  jest.doMock('../config/redis', () => ({
    enabled: () => true,
    bullConnection: () => ({}),
    PREFIX: 't',
    closeRedis: async () => {},
  }));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    require('../services/queue').getQueue('email');
    for (let i = 0; i < 5; i++) listeners.error(new Error('connect ECONNREFUSED 127.0.0.1:6379'));
    expect(log.mock.calls.filter(([m]) => String(m).includes('queue email'))).toHaveLength(1);
  } finally {
    jest.dontMock('bullmq');
    jest.dontMock('../config/redis');
  }
});
