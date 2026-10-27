// Developer console → Nginx / PM2 / Caching: the parsers and the redaction that keep them safe.
const { parseStubStatus, summarizeAccessLog } = require('../services/monitoring/nginx');
const { pm2Process, scrub } = require('../services/monitoring/pm2');
const { namespaceOf } = require('../services/monitoring/caching');

test('stub_status is parsed, dropped = accepts - handled', () => {
  const s = parseStubStatus(
    'Active connections: 7 \nserver accepts handled requests\n 120 118 900 \nReading: 1 Writing: 2 Waiting: 4 \n'
  );
  expect(s).toEqual({
    active: 7,
    accepts: 120,
    handled: 118,
    requests: 900,
    dropped: 2,
    reading: 1,
    writing: 2,
    waiting: 4,
  });
  expect(parseStubStatus('<html>404</html>')).toBeNull();
});

test('access log summary: cache hit rate over cacheable statuses, ids folded, bad lines counted', () => {
  const now = Date.parse('2026-10-26T10:00:30Z');
  const line = (u, c, s = 200, rt = 0.01) =>
    JSON.stringify({
      t: '2026-10-26T10:00:00Z',
      m: 'GET',
      u,
      s,
      b: 10,
      rt,
      ut: c === 'HIT' ? '' : '0.02',
      c,
    });
  const sum = summarizeAccessLog(
    [
      line('/api/services', 'HIT'),
      line('/api/services', 'HIT'),
      line('/api/services', 'MISS'),
      line('/api/services', 'STALE'),
      line('/api/services/6ada49e45851423aa9563b53', 'BYPASS'),
      line('/api/users/me', '', 401),
      line('/assets/a.js', ''),
      'not json',
    ],
    now
  );
  expect(sum.lines).toBe(7);
  expect(sum.unparsed).toBe(1);
  expect(sum.cacheHitRate).toBe(75); // HIT+STALE (3) of HIT+STALE+MISS (4); BYPASS is not cacheable
  expect(sum.statuses).toMatchObject({ '2xx': 6, '4xx': 1 });
  expect(sum.topPaths.map((p) => p.path)).toContain('/api/services/:id');
  expect(sum.rpsLastMin).toBeCloseTo(7 / 60, 1);
});

test('pm2 view keeps only safe fields — never the process environment', () => {
  const p = pm2Process(
    {
      pm_id: 0,
      name: 'jobblo-api',
      pid: 42,
      monit: { cpu: 12, memory: 1000 },
      pm2_env: {
        status: 'online',
        exec_mode: 'fork_mode',
        restart_time: 3,
        pm_uptime: 1_000,
        env: { WEB_CONCURRENCY: 'auto', STRIPE_SECRET_KEY: 'sk_live_x', JWT_SECRET: 'y' },
        STRIPE_SECRET_KEY: 'sk_live_x',
      },
    },
    61_000
  );
  expect(p).toMatchObject({
    name: 'jobblo-api',
    status: 'online',
    mode: 'fork',
    restarts: 3,
    uptimeSec: 60,
    cpuPercent: 12,
    webConcurrency: 'auto',
  });
  expect(JSON.stringify(p)).not.toMatch(/sk_live|JWT_SECRET/);
});

test('log lines are scrubbed of tokens, keys, URL credentials and secrets', () => {
  const line = scrub(
    'auth failed Bearer abc.def.ghi for ola@test.no key sk_live_123abc mongodb://user:pw@host/db password=hunter2 token: "eyJhbGciOi.eyJzdWIi.sig"'
  );
  expect(line).not.toMatch(/abc\.def|ola@test|sk_live_123|user:pw|hunter2|eyJhbGciOi/);
  expect(line).toMatch(/Bearer \[REDACTED\]/);
});

test('cache key namespace', () => {
  expect(namespaceOf('jobblo:cache:services:/api/services?limit=20', 'jobblo')).toBe('services');
  expect(namespaceOf('jobblo-local:cache:services:detail:abc', 'jobblo-local')).toBe('services');
});
