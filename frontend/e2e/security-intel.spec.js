import { test } from '@playwright/test';
import { expect, mockApi, shot, watchErrors } from './helpers/app.js';

/**
 * Security Intelligence pages on a mocked API: the example installation (Pakistan, then two VPN
 * exits, three accounts), its findings, a false-positive decision, an escalation, and a
 * threshold change. Shows that nothing claims more than the data says.
 */
test.describe.configure({ timeout: 90_000 });

const KEY = 'c'.repeat(32);
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const net = (cls, cc) => ({
  class: cls,
  countryCode: cc,
  asn: 'AS9009',
  isp: 'M247',
  confidence: 'medium',
  sources: ['ip-api'],
  checkedAt: ago(1),
});
const alert = (over) => ({
  _id: '64c0000000000000000000a1',
  ruleId: 'B_VPN_TRANSITION',
  title: 'Moved to a VPN or proxy network',
  summary:
    'Seen on residential (39.45.120.10), then on 2 masked network(s). A VPN alone is not fraud.',
  severity: 'low',
  confidence: 'likely',
  status: 'open',
  deviceKey: KEY,
  device: 'DEV-CCCC',
  userIds: ['64c000000000000000000001', '64c000000000000000000002', '64c000000000000000000003'],
  ips: ['39.45.120.10', '185.220.101.20', '146.70.120.40'],
  count: 1,
  firstSeen: ago(50),
  lastSeen: ago(5),
  ...over,
});
const vpn = alert();
const multi = alert({
  _id: '64c0000000000000000000a2',
  ruleId: 'C_MULTI_ACCOUNT',
  title: 'Several accounts on one installation',
  summary: '3 accounts in 30 days (threshold 3). Could be a shared computer.',
  severity: 'medium',
});
const users = Object.fromEntries(
  ['1', '2', '3'].map((n) => [
    `64c00000000000000000000${n}`,
    {
      _id: `64c00000000000000000000${n}`,
      name: `Kari ${n}`,
      email: 'k***@example.no',
      role: 'user',
    },
  ])
);
const observations = [
  {
    ip: '146.70.120.40',
    ipPrefix: '146.70.120.0/24',
    userId: '64c000000000000000000003',
    firstSeen: ago(10),
    lastSeen: ago(5),
    hits: 3,
    events: { login: 1 },
    network: net('vpn_proxy', 'NL'),
  },
  {
    ip: '185.220.101.20',
    ipPrefix: '185.220.101.0/24',
    userId: '64c000000000000000000002',
    firstSeen: ago(20),
    lastSeen: ago(15),
    hits: 2,
    events: {},
    network: net('vpn_proxy', 'DE'),
  },
  {
    ip: '39.45.120.10',
    ipPrefix: '39.45.120.0/24',
    userId: '64c000000000000000000001',
    firstSeen: ago(50),
    lastSeen: ago(40),
    hits: 9,
    events: { login: 2 },
    network: net('residential', 'PK'),
  },
];
const pagination = (total) => ({
  page: 1,
  limit: 25,
  total,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
});
const ok = (data, pag) => ({ success: true, data, pagination: pag || null });

async function mockSecurity(page) {
  const writes = [];
  let config = {
    multiIp: { windowMin: 60, minNetworks: 4 },
    bands: { medium: 25, high: 50, critical: 75 },
  };
  const { calls } = await mockApi(page, {
    as: 'developer',
    routes: {
      'GET /api/developer/security-intel/overview': () =>
        ok({
          range: { from: ago(1440), to: ago(0), bucketMs: 3600000 },
          totals: {
            openAlerts: 2,
            bySeverity: { medium: 1, low: 1 },
            activeDevices: 14,
            riskyDevices: 0,
            maskedObservations: 2,
            multiIpDevices: 0,
            multiAccountDevices: 1,
            newIpEvents: 2,
          },
          byRule: { B_VPN_TRANSITION: 1, C_MULTI_ACCOUNT: 1 },
          trend: [{ t: ago(60), low: 1, medium: 1, high: 0, critical: 0 }],
          recentAlerts: [multi, vpn],
          riskyDevices: [],
        }),
      'GET /api/developer/security-intel/devices': () =>
        ok(
          {
            rows: [
              {
                deviceKey: KEY,
                device: 'DEV-CCCC',
                platform: 'web',
                uaFamily: 'Chrome 131 · Windows 10',
                accounts: 3,
                ips: 3,
                maskedIps: 2,
                countries: ['PK', 'DE', 'NL'],
                riskScore: 38,
                riskBand: 'medium',
                firstSeen: ago(50),
                lastSeen: ago(5),
              },
            ],
          },
          pagination(1)
        ),
      [`GET /api/developer/security-intel/devices/${KEY}`]: () =>
        ok({
          device: {
            deviceKey: KEY,
            device: 'DEV-CCCC',
            platform: 'web',
            uaFamily: 'Chrome 131 · Windows 10',
            firstSeen: ago(50),
            lastSeen: ago(5),
            riskScore: 38,
            riskBand: 'medium',
            identity:
              'Browser installation (signed cookie). Cleared cookies or another browser = another installation.',
          },
          score: {
            score: 38,
            band: 'medium',
            rules: 2,
            reasons: [
              'C_MULTI_ACCOUNT: +20 (medium, likely)',
              'B_VPN_TRANSITION: +8 (low, likely)',
              'corroboration: +10 (2 rules)',
            ],
            recommendation: 'Review the evidence when convenient.',
          },
          accounts: Object.values(users),
          observations,
          alerts: [multi, vpn],
          events: [
            {
              _id: 'e1',
              at: ago(15),
              type: 'device_new_ip',
              ip: '185.220.101.20',
              userId: '64c000000000000000000002',
            },
          ],
          sessions: [],
          users,
        }),
      'GET /api/developer/security-intel/alerts': () =>
        ok({ rules: [], statuses: [], rows: [multi, vpn] }, pagination(2)),
      [`GET /api/developer/security-intel/alerts/${vpn._id}`]: () =>
        ok({
          alert: {
            ...vpn,
            weight: 10,
            closedAt: null,
            notes: [],
            evidence: observations.map((o) => ({
              label: `${o.ip} · ${o.network.class} · ${o.network.countryCode}`,
              at: o.lastSeen,
              ref: { type: 'ip', id: o.ip },
            })),
          },
          device: {
            deviceKey: KEY,
            device: 'DEV-CCCC',
            platform: 'web',
            uaFamily: 'Chrome 131',
            riskScore: 38,
            riskBand: 'medium',
          },
          recommendation: 'Review the evidence when convenient.',
          siblings: [multi],
          fraudCases: [],
          users,
        }),
      [`~PATCH ^/api/developer/security-intel/alerts/${vpn._id}$`]: ({ body }) => {
        writes.push(['PATCH', body]);
        return ok({ ...vpn, status: body.status });
      },
      'GET /api/developer/security-intel/events': () =>
        ok(
          {
            types: ['login_failed', 'device_new_ip'],
            byType: { device_new_ip: 2 },
            rows: [
              {
                _id: 'e1',
                at: ago(15),
                type: 'device_new_ip',
                ip: '185.220.101.20',
                deviceKey: KEY,
                device: 'DEV-CCCC',
              },
            ],
          },
          pagination(1)
        ),
      'GET /api/developer/security-intel/analytics': () =>
        ok({
          range: { from: ago(43200), to: ago(0), bucketMs: 86400000 },
          alerts: [{ t: ago(60), low: 1, medium: 1, high: 0, critical: 0 }],
          events: [
            {
              t: ago(60),
              login_failed: 3,
              rate_limited: 0,
              otp_failed: 0,
              device_new_ip: 2,
              device_new_account: 2,
            },
          ],
          masked: [{ t: ago(60), vpn_proxy: 2, tor: 0 }],
          byRule: [{ ruleId: 'B_VPN_TRANSITION', n: 1, falsePositive: 0 }],
          resolution: { closed: 0, falsePositive: 0, medianHours: null },
        }),
      'GET /api/developer/security-intel/config': () =>
        ok({
          config,
          defaults: {
            multiIp: { windowMin: 60, minNetworks: 4 },
            bands: { medium: 25, high: 50, critical: 75 },
          },
        }),
      'PUT /api/developer/security-intel/config': ({ body }) => {
        writes.push(['PUT', body]);
        config = body;
        return ok({ config });
      },
    },
  });
  return { calls, writes };
}

test('overview → device → its findings: the example installation, explained', async ({ page }) => {
  const errors = watchErrors(page);
  await mockSecurity(page);
  await page.goto('/developer/security-intel');
  await expect(page.getByRole('heading', { name: 'Security Overview' })).toBeVisible();
  await expect(page.getByText('A VPN alone is not fraud', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Several accounts on one installation').first()).toBeVisible();
  await shot(page, 'security-overview');

  await page.goto('/developer/security-intel/devices');
  await expect(page.getByText('2 masked')).toBeVisible();
  await page.getByRole('link', { name: 'DEV-CCCC' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/security-intel/devices/${KEY}$`));
  await expect(page.getByText('38 · medium')).toBeVisible();
  await expect(page.getByText('corroboration: +10', { exact: false })).toBeVisible();
  await expect(
    page.getByText('another browser = another installation', { exact: false })
  ).toBeVisible();
  // IP history with its classification, three networks in three countries.
  for (const ip of ['39.45.120.10', '185.220.101.20', '146.70.120.40'])
    await expect(page.getByRole('link', { name: ip }).first()).toBeVisible();
  await expect(page.getByText('VPN / proxy').first()).toBeVisible();
  await shot(page, 'security-device');
  expect(errors).toEqual([]);
});

test('investigations: closing needs a note, the decision is sent, escalation needs accounts', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const { writes } = await mockSecurity(page);
  await page.goto('/developer/security-intel/alerts');
  await expect(page.getByRole('heading', { name: 'Investigations' })).toBeVisible();
  await page.getByText('Moved to a VPN or proxy network').click();
  await expect(page.getByText('Evidence', { exact: true })).toBeVisible();
  const fp = page.getByRole('button', { name: 'False positive' });
  await expect(fp).toBeDisabled(); // a reason first
  await page
    .getByLabel('Note (needed to close or escalate)')
    .fill('Known corporate VPN of the customer.');
  await expect(fp).toBeEnabled();
  await shot(page, 'security-investigation');
  await fp.click();
  await expect
    .poll(() => writes.find((w) => w[0] === 'PATCH')?.[1])
    .toEqual({
      status: 'false_positive',
      note: 'Known corporate VPN of the customer.',
    });
  expect(errors).toEqual([]);
});

test('analytics shows stored history, and a threshold change is saved', async ({ page }) => {
  const errors = watchErrors(page);
  const { writes } = await mockSecurity(page);
  await page.goto('/developer/security-intel/analytics');
  await expect(page.getByRole('heading', { name: 'Security Analytics' })).toBeVisible();
  const field = page.getByLabel('multiIp minNetworks');
  await field.fill('6');
  await expect(page.getByText('(default 4)')).toBeVisible();
  await page.getByRole('button', { name: 'Save thresholds' }).click();
  await expect.poll(() => writes.find((w) => w[0] === 'PUT')?.[1]?.multiIp?.minNetworks).toBe(6);
  await shot(page, 'security-analytics');

  await page.goto('/developer/security-intel/events');
  await expect(page.getByRole('heading', { name: 'Security Events' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'device_new_ip' }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('the nav has a Security Intelligence section with the moved pages', async ({ page }) => {
  await mockSecurity(page);
  await page.goto('/developer/security-intel');
  for (const name of [
    'Security Overview',
    'Device Explorer',
    'Investigations',
    'Security Events',
    'Security Analytics',
    'IP Management',
    'Fraud & Abuse',
    'Security Center',
  ])
    await expect(page.getByRole('link', { name, exact: true }).first()).toBeVisible();
});
