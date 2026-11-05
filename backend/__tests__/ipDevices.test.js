// Developer IP sheet: which devices and accounts an IP is used by, and its network
// (ISP, mobile / proxy / hosting), from open sessions and sign-in events.
const { devicesAndAccounts } = require('../controllers/developer/apiMonitoringController');
const { networkFor } = require('../services/monitoring/ipGeo');

jest.spyOn(console, 'error').mockImplementation(() => {});

const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

test('devices: one row per browser/OS/model, with accounts, count and last seen', () => {
  const user = { _id: 'u1', name: 'Kari', lastName: 'N', email: 'kari@example.test', role: 'user' };
  const sessions = [
    {
      userId: user,
      device: 'iOS Mobile',
      deviceName: 'iPhone 15 Pro',
      browser: 'Jobblo app',
      os: 'iOS',
      lastUsed: '2026-11-05T10:00:00Z',
    },
    {
      userId: user,
      device: 'Windows Desktop',
      browser: 'Chrome',
      os: 'Windows 10',
      lastUsed: '2026-11-04T10:00:00Z',
    },
  ];
  const auth = [
    {
      type: 'login',
      email: 'o***@example.test',
      at: '2026-11-05T11:00:00Z',
      userAgent: CHROME_WIN,
    },
    {
      type: 'login_failed',
      email: 'o***@example.test',
      at: '2026-11-05T09:00:00Z',
      userAgent: CHROME_WIN,
    },
  ];
  const { devices, accounts } = devicesAndAccounts(sessions, auth);

  const phone = devices.find((d) => d.model === 'iPhone 15 Pro');
  expect(phone).toMatchObject({ kind: 'mobile', os: 'iOS', seen: 1, sources: ['session'] });
  const signIns = devices.filter((d) => d.sources.includes('sign-in'));
  expect(signIns).toHaveLength(1); // two events, one Chrome on Windows
  expect(signIns[0]).toMatchObject({ browser: 'Chrome', kind: 'desktop', seen: 2 });
  expect(signIns[0].accounts).toEqual(['o***@example.test']);
  expect(devices[0].lastSeen).toBe('2026-11-05T11:00:00Z'); // newest first

  expect(accounts).toHaveLength(1);
  expect(accounts[0]).toMatchObject({ _id: 'u1', name: 'Kari N', role: 'user', sessions: 2 });
  expect(accounts[0].email).not.toBe('kari@example.test'); // masked
});

test('network: ISP and mobile/proxy/hosting flags, cached; local and failures stay quiet', async () => {
  const get = jest.fn().mockResolvedValue({
    data: {
      status: 'success',
      country: 'Norway',
      countryCode: 'NO',
      city: 'Oslo',
      isp: 'Telia Norge',
      org: 'Telia',
      as: 'AS12929 Telia Norge AS',
      mobile: true,
      proxy: false,
      hosting: false,
    },
  });
  const net = await networkFor('84.210.9.9', { get });
  expect(net).toMatchObject({ isp: 'Telia Norge', mobile: true, proxy: false, hosting: false });
  await networkFor('84.210.9.9', { get });
  expect(get).toHaveBeenCalledTimes(1); // cached

  expect((await networkFor('192.168.1.2', { get })).country).toBe('Local network');
  const down = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
  expect((await networkFor('203.0.113.77', { get: down })).isp).toBeNull();
});

test('an Expo Go / app session is a phone, and "unknown" is never shown', () => {
  const { devices } = devicesAndAccounts(
    [
      {
        userId: { _id: 'u2', name: 'Adr', lastName: 'Test', email: 'adr@gmail.com', role: 'user' },
        device: 'unknown Desktop',
        deviceName: 'Motorola moto g54',
        browser: 'ExpoGo',
        os: 'unknown',
        userAgent: 'ExpoGo/1017699 CFNetwork/1568.100.1 Darwin/24.0.0',
        lastUsed: '2026-11-05T10:00:00Z',
      },
    ],
    []
  );
  expect(devices[0]).toMatchObject({
    browser: 'Expo Go',
    os: null,
    kind: 'mobile',
    model: 'Motorola moto g54',
  });
});
