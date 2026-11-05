/**
 * Device risk engine, Phase 4: rules A–F (each with the false positives it must not raise),
 * the explainable score, and alert dedupe / reopen / false-positive handling. Pure contexts and
 * in-memory models; no DB.
 */
const RULES = require('../services/security/risk/rules');
const { DEFAULTS, mergeConfig } = require('../services/security/risk/config');
const { scoreAlerts } = require('../services/security/risk/score');
const engine = require('../services/security/risk/engine');

const NOW = new Date('2026-11-06T12:00:00Z').getTime();
const MIN = 60 * 1000;
const ago = (ms) => new Date(NOW - ms);
const rule = (id) => RULES.find((r) => r.id === id);
const run = (id, ctx, cfg) =>
  rule(id).evaluate(
    { now: NOW, device: { platform: 'web' }, observations: [], securityEvents: [], ...ctx },
    cfg || DEFAULTS[rule(id).config]
  );

const obs = (
  ip,
  {
    cls = 'residential',
    asn = null,
    cc = 'NO',
    first = 5 * MIN,
    last = MIN,
    userId = 'u1',
    events = {},
    confidence = 'medium',
  } = {}
) => ({
  ip,
  ipPrefix: ip.split('.').slice(0, 3).join('.') + '.0/24',
  userId,
  firstSeen: ago(first),
  lastSeen: ago(last),
  events,
  network: { class: cls, asn, countryCode: cc, confidence },
});

describe('A — many networks', () => {
  test('four networks within the hour → medium; eight → high', () => {
    const four = ['39.45.120.10', '185.220.101.20', '146.70.120.40', '84.210.1.2'].map((ip) =>
      obs(ip)
    );
    expect(run('A_MULTI_IP', { observations: four })[0]).toMatchObject({
      severity: 'medium',
      confidence: 'likely',
    });
    const eight = [...four, '1.1.1.1', '8.8.8.8', '9.9.9.9', '62.1.1.1'].map((o) =>
      typeof o === 'string' ? obs(o) : o
    );
    expect(run('A_MULTI_IP', { observations: eight })[0].severity).toBe('high');
  });

  test('not raised: a phone moving through one mobile network, one /24, private IPs, old rows', () => {
    const phone = ['77.16.1.1', '77.17.2.2', '77.18.3.3', '77.19.4.4'].map((ip) =>
      obs(ip, { cls: 'mobile', asn: 'AS2119' })
    );
    expect(run('A_MULTI_IP', { observations: phone })).toEqual([]);
    const sameNet = ['84.210.1.2', '84.210.1.3', '84.210.1.4', '84.210.1.5'].map((ip) => obs(ip));
    expect(run('A_MULTI_IP', { observations: sameNet })).toEqual([]);
    const lan = ['192.168.1.2', '10.0.0.3', '172.16.0.4', '127.0.0.1'].map((ip) => obs(ip));
    expect(run('A_MULTI_IP', { observations: lan })).toEqual([]);
    const old = ['39.45.120.10', '185.220.101.20', '146.70.120.40', '84.210.1.2'].map((ip) =>
      obs(ip, { last: 3 * 60 * MIN })
    );
    expect(run('A_MULTI_IP', { observations: old })).toEqual([]);
  });

  test('an app id is only "possible"', () => {
    const four = ['39.45.120.10', '185.220.101.20', '146.70.120.40', '84.210.1.2'].map((ip) =>
      obs(ip)
    );
    expect(
      run('A_MULTI_IP', { observations: four, device: { platform: 'app' } })[0].confidence
    ).toBe('possible');
  });
});

describe('B — VPN transition (context, not fraud)', () => {
  test('the example: Pakistan residential, then a VPN exit → low; Tor → medium', () => {
    const rows = [
      obs('39.45.120.10', { cc: 'PK', first: 50 * MIN }),
      obs('146.70.120.40', { cls: 'vpn_proxy', cc: 'NL', first: 10 * MIN }),
    ];
    expect(run('B_VPN_TRANSITION', { observations: rows })[0]).toMatchObject({
      severity: 'low',
      weight: 10,
      confidence: 'likely',
    });
    rows.push(obs('185.220.101.20', { cls: 'tor', cc: 'DE', first: 5 * MIN, confidence: 'high' }));
    expect(run('B_VPN_TRANSITION', { observations: rows })[0]).toMatchObject({
      severity: 'medium',
      confidence: 'confirmed',
    });
  });

  test('not raised: only ever on a VPN (a corporate VPN user), or the VPN came first', () => {
    expect(
      run('B_VPN_TRANSITION', { observations: [obs('146.70.120.40', { cls: 'vpn_proxy' })] })
    ).toEqual([]);
    const vpnFirst = [
      obs('146.70.120.40', { cls: 'vpn_proxy', first: 50 * MIN }),
      obs('39.45.120.10', { first: 10 * MIN }),
    ];
    expect(run('B_VPN_TRANSITION', { observations: vpnFirst })).toEqual([]);
    // Unknown classification says nothing.
    expect(
      run('B_VPN_TRANSITION', {
        observations: [obs('39.45.120.10'), obs('146.70.120.40', { cls: 'unknown' })],
      })
    ).toEqual([]);
  });
});

describe('C — several accounts', () => {
  test('three accounts → medium (could be a shared computer); two → nothing; six → high', () => {
    const accounts = (n) =>
      Array.from({ length: n }, (_, i) => obs('84.210.1.2', { userId: `u${i}` }));
    expect(run('C_MULTI_ACCOUNT', { observations: accounts(2) })).toEqual([]);
    expect(run('C_MULTI_ACCOUNT', { observations: accounts(3) })[0]).toMatchObject({
      severity: 'medium',
      userIds: ['u0', 'u1', 'u2'],
    });
    expect(run('C_MULTI_ACCOUNT', { observations: accounts(6) })[0].severity).toBe('high');
  });
});

describe('D — failed sign-ins', () => {
  const fails = (n, ips) =>
    Array.from({ length: n }, (_, i) => ({
      type: 'login_failed',
      at: ago(MIN),
      ip: ips[i % ips.length],
      emailHash: `h${i % 2}`,
    }));

  test('five failures across networks → high; ten from one place → medium; five from one place → nothing', () => {
    const observations = [obs('39.45.120.10'), obs('146.70.120.40', { cc: 'NL' })];
    expect(
      run('D_LOGIN_ABUSE', {
        observations,
        securityEvents: fails(5, ['39.45.120.10', '146.70.120.40']),
      })[0]
    ).toMatchObject({ severity: 'high' });
    expect(
      run('D_LOGIN_ABUSE', { observations, securityEvents: fails(10, ['39.45.120.10']) })[0]
        .severity
    ).toBe('medium');
    expect(
      run('D_LOGIN_ABUSE', { observations, securityEvents: fails(5, ['39.45.120.10']) })
    ).toEqual([]);
  });

  test('old failures outside the window do not count', () => {
    const stale = Array.from({ length: 20 }, () => ({
      type: 'login_failed',
      at: ago(60 * MIN),
      ip: '39.45.120.10',
    }));
    expect(run('D_LOGIN_ABUSE', { securityEvents: stale })).toEqual([]);
  });
});

describe('E — request bursts', () => {
  const limited = (n) =>
    Array.from({ length: n }, () => ({
      type: 'rate_limited',
      at: ago(MIN),
      ip: '1.2.3.4',
      route: '/api/auth/login',
    }));
  test('20 refused requests → medium, 60 → high, 19 → nothing', () => {
    expect(run('E_REQUEST_ABUSE', { securityEvents: limited(19) })).toEqual([]);
    expect(run('E_REQUEST_ABUSE', { securityEvents: limited(20) })[0]).toMatchObject({
      severity: 'medium',
      evidence: [{ label: '20 × /api/auth/login' }],
    });
    expect(run('E_REQUEST_ABUSE', { securityEvents: limited(60) })[0].severity).toBe('high');
  });
});

describe('F — sensitive changes', () => {
  test('from a fresh pair → medium; fresh and on a VPN → high; an old, ordinary pair → nothing', () => {
    expect(
      run('F_SENSITIVE_OPS', {
        observations: [obs('84.210.1.2', { first: 60 * MIN, events: { sensitive: 1 } })],
      })[0].severity
    ).toBe('medium');
    expect(
      run('F_SENSITIVE_OPS', {
        observations: [
          obs('146.70.120.40', { cls: 'vpn_proxy', first: 60 * MIN, events: { sensitive: 1 } }),
        ],
      })[0].severity
    ).toBe('high');
    expect(
      run('F_SENSITIVE_OPS', {
        observations: [obs('84.210.1.2', { first: 90 * 24 * 60 * MIN, events: { sensitive: 2 } })],
      })
    ).toEqual([]);
    expect(
      run('F_SENSITIVE_OPS', { observations: [obs('84.210.1.2', { first: 60 * MIN })] })
    ).toEqual([]);
  });
});

describe('score', () => {
  const bands = DEFAULTS.bands;
  const alert = (ruleId, weight, confidence = 'likely', status = 'open', severity = 'medium') => ({
    ruleId,
    weight,
    confidence,
    status,
    severity,
  });

  test('each rule counts once, scaled by confidence; agreeing rules add a bonus', () => {
    expect(scoreAlerts([alert('B', 10)], bands)).toMatchObject({ score: 8, band: 'low' });
    expect(scoreAlerts([alert('A', 20), alert('A', 30)], bands).score).toBe(24); // A once, its best
    const three = scoreAlerts([alert('A', 30), alert('C', 40), alert('D', 30)], bands);
    expect(three).toMatchObject({ score: 100, band: 'critical' }); // 24+32+24+20 → capped
    expect(three.reasons.at(-1)).toMatch(/corroboration/);
  });

  test('false positives and resolved alerts do not count', () => {
    expect(
      scoreAlerts(
        [alert('C', 40, 'likely', 'false_positive'), alert('A', 30, 'likely', 'resolved')],
        bands
      ).score
    ).toBe(0);
  });
});

test('config overrides merge per rule; bad values are ignored', () => {
  const c = mergeConfig({
    multiIp: { minNetworks: 6, windowMin: 'x' },
    bogus: { a: 1 },
    bands: { high: -5 },
  });
  expect(c.multiIp).toEqual({ windowMin: 60, minNetworks: 6 });
  expect(c.bands).toEqual(DEFAULTS.bands);
  expect(c.bogus).toBeUndefined();
});

/** In-memory models for the engine. */
function store({ observations = [], events = [], platform = 'web' } = {}) {
  const alerts = new Map();
  const device = { deviceKey: 'k1', platform, userIds: [] };
  const q = (rows) => ({ sort: () => ({ limit: () => ({ lean: async () => rows }) }) });
  const apply = (doc, u) => {
    Object.assign(doc, u.$set);
    if (u.$inc) for (const [k, v] of Object.entries(u.$inc)) doc[k] = (doc[k] || 0) + v;
    if (u.$push) doc.notes = [...(doc.notes || []), u.$push.notes];
  };
  return {
    alerts,
    device,
    deps: {
      now: NOW,
      config: DEFAULTS,
      DeviceInstallation: {
        findOne: () => ({ lean: async () => device }),
        updateOne: async (_q, u) => Object.assign(device, u.$set),
      },
      DeviceObservation: { find: () => q(observations) },
      SecurityEvent: { find: () => q(events) },
      SecurityAlert: {
        findOne: ({ dedupeKey }) => ({
          lean: async () => (alerts.has(dedupeKey) ? { ...alerts.get(dedupeKey) } : null),
        }),
        updateOne: async ({ dedupeKey }, u) => {
          const doc = alerts.get(dedupeKey) || { ...u.$setOnInsert };
          apply(doc, u);
          alerts.set(dedupeKey, doc);
        },
        find: () => ({ select: () => ({ lean: async () => [...alerts.values()] }) }),
      },
    },
  };
}

describe('engine', () => {
  const vpnStory = () => [
    obs('39.45.120.10', { cc: 'PK', first: 50 * MIN, last: 40 * MIN }),
    obs('185.220.101.20', { cls: 'vpn_proxy', cc: 'DE', first: 20 * MIN, last: 15 * MIN }),
    obs('146.70.120.40', { cls: 'vpn_proxy', cc: 'NL', first: 10 * MIN, last: 5 * MIN }),
  ];

  test('the example end to end: three observations → one VPN-transition alert, low risk', async () => {
    const s = store({ observations: vpnStory() });
    const r = await engine.evaluateDevice('k1', s.deps);
    expect(Object.keys(r.outcomes)).toEqual(['B_VPN_TRANSITION']); // 3 networks < 4: no rule A
    expect(s.alerts.get('B_VPN_TRANSITION|k1')).toMatchObject({
      status: 'open',
      count: 1,
      ips: ['39.45.120.10', '185.220.101.20', '146.70.120.40'],
    });
    expect(s.device).toMatchObject({ riskScore: 8, riskBand: 'low' });
  });

  test('evaluating the same data again does not duplicate or recount', async () => {
    const s = store({ observations: vpnStory() });
    await engine.evaluateDevice('k1', s.deps);
    const r = await engine.evaluateDevice('k1', s.deps);
    expect(s.alerts.size).toBe(1);
    expect(r.outcomes.B_VPN_TRANSITION).toBe('unchanged');
    expect(s.alerts.get('B_VPN_TRANSITION|k1').count).toBe(1);
  });

  test('newer evidence counts up; resolved reopens; a false positive stays closed', async () => {
    const rows = vpnStory();
    const s = store({ observations: rows });
    await engine.evaluateDevice('k1', s.deps);
    rows[2].lastSeen = ago(MIN);
    expect((await engine.evaluateDevice('k1', s.deps)).outcomes.B_VPN_TRANSITION).toBe('updated');
    expect(s.alerts.get('B_VPN_TRANSITION|k1').count).toBe(2);

    s.alerts.get('B_VPN_TRANSITION|k1').status = 'resolved';
    rows[2].lastSeen = ago(MIN / 2);
    expect((await engine.evaluateDevice('k1', s.deps)).outcomes.B_VPN_TRANSITION).toBe('reopened');
    expect(s.alerts.get('B_VPN_TRANSITION|k1')).toMatchObject({ status: 'open', closedAt: null });
    expect(s.alerts.get('B_VPN_TRANSITION|k1').notes.at(-1).text).toMatch(/Seen again/);

    s.alerts.get('B_VPN_TRANSITION|k1').status = 'false_positive';
    rows[2].lastSeen = ago(MIN / 4);
    expect((await engine.evaluateDevice('k1', s.deps)).outcomes.B_VPN_TRANSITION).toBe(
      'suppressed'
    );
    expect(s.alerts.get('B_VPN_TRANSITION|k1').status).toBe('false_positive');
    expect(s.device.riskScore).toBe(0);
  });

  test('a rule that throws does not stop the others', () => {
    const broken = {
      id: 'X',
      config: 'multiIp',
      evaluate: () => {
        throw new Error('boom');
      },
    };
    RULES.unshift(broken);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const hits = engine.runRules(
        { now: NOW, device: { platform: 'web' }, observations: vpnStory(), securityEvents: [] },
        DEFAULTS
      );
      expect(hits.map((h) => h.ruleId)).toEqual(['B_VPN_TRANSITION']);
    } finally {
      RULES.shift();
    }
  });

  test('two evaluations racing: the loser of the insert retries as an update, one alert', async () => {
    const s = store({ observations: vpnStory() });
    const real = s.deps.SecurityAlert.updateOne;
    let raced = false;
    s.deps.SecurityAlert.updateOne = async (q, u) => {
      if (!raced && u.$setOnInsert) {
        raced = true;
        await real(q, u); // the other worker's insert lands first…
        throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
      }
      return real(q, u);
    };
    await engine.evaluateDevice('k1', s.deps);
    expect(s.alerts.size).toBe(1);
    expect(s.alerts.get('B_VPN_TRANSITION|k1').count).toBe(1);
  });

  test('an unknown installation is skipped', async () => {
    const s = store();
    s.deps.DeviceInstallation.findOne = () => ({ lean: async () => null });
    expect(await engine.evaluateDevice('nope', s.deps)).toEqual({ skipped: 'unknown device' });
  });
});
