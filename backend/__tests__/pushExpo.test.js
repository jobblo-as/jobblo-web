/**
 * iOS push goes through Expo's push service (Expo push tokens), Android through FCM. One user can
 * have both; a dead iOS token is deactivated; the queue retries only when nothing got through.
 */
jest.mock('../models/PushToken', () => ({ find: jest.fn(), updateMany: jest.fn() }));
jest.mock('../services/firebaseAdmin', () => ({ getFirebaseMessaging: jest.fn() }));
jest.mock('../services/monitoring/deliveryLog', () => ({ logDelivery: jest.fn() }));
jest.mock('../services/monitoring/faults', () => ({ assertNoFault: jest.fn() }));

const PushToken = require('../models/PushToken');
const { getFirebaseMessaging } = require('../services/firebaseAdmin');
const { logDelivery } = require('../services/monitoring/deliveryLog');
const { deliverPush } = require('../services/pushNotifications');
const { providerOf } = require('../controllers/pushTokenController');

const IOS = 'ExponentPushToken[abcdefghij123456]';
const IOS_DEAD = 'ExponentPushToken[deaddeaddead0000]';
const ANDROID = 'fcm-token-'.padEnd(40, 'x');
const tokens = (...list) => ({ select: () => ({ lean: async () => list }) });
const message = { title: 'Ny melding', body: 'Hei', data: { type: 'chat', chatId: 'c1' } };

let sendEachForMulticast;
beforeEach(() => {
  jest.clearAllMocks();
  sendEachForMulticast = jest.fn(async ({ tokens: t }) => ({ successCount: t.length, failureCount: 0, responses: t.map(() => ({})) }));
  getFirebaseMessaging.mockReturnValue({ sendEachForMulticast });
  global.fetch = jest.fn(async (_url, { body }) => ({
    ok: true,
    json: async () => ({
      data: JSON.parse(body).map(({ to }) => (to === IOS_DEAD ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 't' })),
    }),
  }));
});

test('the token decides the provider; anything else is refused', () => {
  expect(providerOf(IOS)).toBe('expo');
  expect(providerOf('ExpoPushToken[abcdefghij123456]')).toBe('expo');
  expect(providerOf(ANDROID)).toBe('fcm');
  for (const bad of ['ExponentPushToken[]', 'ExponentPushToken[a b]', 'short', 42, null]) expect(providerOf(bad)).toBeNull();
});

test('Android goes to FCM and iOS to Expo, with the same title, body and data', async () => {
  PushToken.find.mockReturnValue(tokens({ token: ANDROID, provider: 'fcm' }, { token: IOS, provider: 'expo' }));
  await deliverPush('u1', message);

  expect(sendEachForMulticast.mock.calls[0][0].tokens).toEqual([ANDROID]);
  const [url, init] = global.fetch.mock.calls[0];
  expect(url).toBe('https://exp.host/--/api/v2/push/send');
  expect(JSON.parse(init.body)).toEqual([
    expect.objectContaining({ to: IOS, title: 'Ny melding', body: 'Hei', data: { type: 'chat', chatId: 'c1' }, sound: 'default' }),
  ]);
  expect(logDelivery).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'sent', accepted: 2, rejected: 0 }));
});

test('an iOS device Apple no longer knows is switched off', async () => {
  PushToken.find.mockReturnValue(tokens({ token: IOS, provider: 'expo' }, { token: IOS_DEAD, provider: 'expo' }));
  await deliverPush('u1', message);
  expect(PushToken.updateMany).toHaveBeenCalledWith({ token: { $in: [IOS_DEAD] } }, { $set: { active: false } });
  expect(logDelivery).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'partial', accepted: 1, rejected: 1 }));
});

test('Expo down with only iOS devices: throws, so the queue retries', async () => {
  PushToken.find.mockReturnValue(tokens({ token: IOS, provider: 'expo' }));
  global.fetch.mockResolvedValueOnce({ ok: false, status: 503 });
  await expect(deliverPush('u1', message)).rejects.toThrow('Expo push HTTP 503');
});

test('Expo down but Android delivered: no retry (it would push Android twice)', async () => {
  PushToken.find.mockReturnValue(tokens({ token: ANDROID, provider: 'fcm' }, { token: IOS, provider: 'expo' }));
  global.fetch.mockResolvedValueOnce({ ok: false, status: 503 });
  await expect(deliverPush('u1', message)).resolves.toBeUndefined();
  expect(logDelivery).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'partial', accepted: 1 }));
});
