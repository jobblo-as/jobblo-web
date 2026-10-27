const {
  plan,
  workerEnv,
  dropSingletons,
  backoffMs,
  SINGLETON_STARTERS,
  PER_WORKER_STARTERS,
} = require('../cluster');
const { STARTERS } = require('../bootstrap/background');

describe('cluster plan (WEB_CONCURRENCY)', () => {
  const redis = { REDIS_URL: 'redis://x' };
  test('unset / 1 / junk → one process', () => {
    expect(plan({}, 8)).toEqual({ workers: 1, warning: null });
    expect(plan({ WEB_CONCURRENCY: '1', ...redis }, 8).workers).toBe(1);
    expect(plan({ WEB_CONCURRENCY: 'lots', ...redis }, 8)).toMatchObject({
      workers: 1,
      warning: expect.stringMatching(/positive integer/),
    });
    expect(plan({ WEB_CONCURRENCY: '0', ...redis }, 8).workers).toBe(1);
  });
  test('N or auto with Redis', () => {
    expect(plan({ WEB_CONCURRENCY: '4', ...redis }, 8)).toEqual({ workers: 4, warning: null });
    expect(plan({ WEB_CONCURRENCY: 'auto', ...redis }, 8).workers).toBe(8);
  });
  test('refuses a cluster without Redis', () => {
    expect(plan({ WEB_CONCURRENCY: '4' }, 8)).toMatchObject({
      workers: 1,
      warning: expect.stringMatching(/needs REDIS_URL/),
    });
  });
});

describe('singleton background work', () => {
  test('every bootstrap starter is classified exactly once', () => {
    const names = STARTERS.map(([n]) => n).sort();
    expect([...SINGLETON_STARTERS, ...PER_WORKER_STARTERS].sort()).toEqual(names);
  });
  test('slot 1 keeps operator flags, other slots turn the scheduler and probes off', () => {
    expect(workerEnv(1)).toEqual({ WORKER_SLOT: '1' });
    expect(workerEnv(3)).toEqual({
      WORKER_SLOT: '3',
      ENABLE_SCHEDULER: 'false',
      ENABLE_SYNTHETIC: 'false',
    });
  });
  test('dropSingletons removes only singletons, in place', () => {
    const copy = STARTERS.slice();
    expect(dropSingletons(copy)).toBe(copy);
    expect(copy.map(([n]) => n).sort()).toEqual([...PER_WORKER_STARTERS].sort());
  });
  test('restart backoff doubles and caps', () => {
    expect([1, 2, 3, 6, 99].map(backoffMs)).toEqual([1000, 2000, 4000, 30000, 30000]);
  });
});

describe('slotFrom (our workers and pm2 cluster mode)', () => {
  const { slotFrom } = require('../cluster');
  test("our primary's WORKER_SLOT wins", () => {
    expect(slotFrom({ WORKER_SLOT: '3', NODE_APP_INSTANCE: '0' }, true)).toBe('3');
  });
  test('pm2 -i: instance 0 is slot 1, the rest drop the singletons', () => {
    expect(slotFrom({ NODE_APP_INSTANCE: '0' }, true)).toBe('1');
    expect(slotFrom({ NODE_APP_INSTANCE: '2' }, true)).toBe('3');
  });
  test('not a cluster worker (plain node, pm2 fork mode, our primary): no slot', () => {
    expect(slotFrom({ NODE_APP_INSTANCE: '0' }, false)).toBeNull();
    expect(slotFrom({}, false)).toBeNull();
    expect(slotFrom({}, true)).toBeNull();
    expect(slotFrom({ NODE_APP_INSTANCE: 'x' }, true)).toBeNull();
  });
});

// S10: pm2 -i N forks around plan(), so without Redis each worker had its own socket rooms
// and a logout on one worker left the user's sockets on the others connected.
describe('workerRefusal (clustered worker without REDIS_URL)', () => {
  const { workerRefusal } = require('../cluster');
  test('slots 2..N refuse to start without REDIS_URL', () => {
    expect(workerRefusal('2', {})).toMatch(/REDIS_URL/);
  });
  test('slot 1, a non-worker and any slot with REDIS_URL start', () => {
    expect(workerRefusal('1', {})).toBeNull();
    expect(workerRefusal(null, {})).toBeNull();
    expect(workerRefusal('3', { REDIS_URL: 'redis://x' })).toBeNull();
  });
});
