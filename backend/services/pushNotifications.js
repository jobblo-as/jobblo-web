const PushToken = require('../models/PushToken');
const { getFirebaseMessaging } = require('./firebaseAdmin');
const { logDelivery } = require('./monitoring/deliveryLog');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function stringData(data) {
  return Object.fromEntries(Object.entries(data || {}).map(([key, value]) => [key, String(value)]));
}

/** Android: native FCM tokens through Firebase Admin. */
async function sendFcm(tokens, message) {
  const response = await getFirebaseMessaging().sendEachForMulticast({
    tokens,
    notification: {
      title: String(message.title || ''),
      body: String(message.body || ''),
    },
    data: stringData(message.data),
    android: {
      priority: message.priority === 'normal' ? 'normal' : 'high',
      notification: {
        sound: 'default',
        channelId: message.channelId || 'messages',
      },
    },
  });
  const invalid = response.responses
    .map((result, index) => {
      const code = result.error?.code;
      return code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token'
        ? tokens[index]
        : null;
    })
    .filter(Boolean);
  return {
    accepted: response.successCount,
    rejected: response.failureCount,
    errorCode: response.responses.find((r) => r.error)?.error?.code || null,
    invalid,
  };
}

/**
 * iOS: Expo push tokens through Expo's push service, which delivers to APNs with the key EAS
 * stored for the app. EXPO_ACCESS_TOKEN is only needed when "enhanced push security" is on.
 * ponytail: one request (Expo takes 100 messages per call) and no receipt polling, so a token
 * Apple drops later is only noticed by Expo's next ticket error; poll /getReceipts if that matters.
 */
async function sendExpo(tokens, message) {
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
    },
    body: JSON.stringify(
      tokens.slice(0, 100).map((to) => ({
        to,
        title: String(message.title || ''),
        body: String(message.body || ''),
        data: stringData(message.data),
        sound: 'default',
        priority: message.priority === 'normal' ? 'normal' : 'high',
      }))
    ),
  });
  if (!res.ok) {
    const error = new Error(`Expo push HTTP ${res.status}`);
    error.code = `expo/http-${res.status}`;
    throw error;
  }
  const tickets = (await res.json())?.data || [];
  const failed = tickets.filter((t) => t?.status !== 'ok');
  return {
    accepted: tickets.length - failed.length,
    rejected: failed.length,
    errorCode: failed[0]?.details?.error || null,
    invalid: tickets.map((t, i) => (t?.details?.error === 'DeviceNotRegistered' ? tokens[i] : null)).filter(Boolean),
  };
}

/**
 * Deliver now (queue handler). Throws only when every provider call failed, so the queue
 * retries it; when one provider got through, a retry would send those devices a duplicate.
 */
async function deliverPush(userId, message) {
  const tokens = await PushToken.find({ userId, active: true }).select('token provider').lean();
  const started = Date.now();
  const log = (fields) =>
    logDelivery({ channel: 'push', template: String(message?.title || '').slice(0, 200), userId, latencyMs: Date.now() - started, ...fields });
  if (!tokens.length) {
    log({ status: 'skipped', error: 'no active push tokens' });
    return;
  }

  const byProvider = { fcm: [], expo: [] };
  for (const { token, provider } of tokens) (byProvider[provider === 'expo' ? 'expo' : 'fcm']).push(token);

  const results = [];
  const errors = [];
  try {
    require('./monitoring/faults').assertNoFault('push'); // staging failure simulator only
    for (const [provider, send] of [['fcm', sendFcm], ['expo', sendExpo]]) {
      if (!byProvider[provider].length) continue;
      try {
        results.push(await send(byProvider[provider], message));
      } catch (error) {
        errors.push(error);
        console.error(`${provider.toUpperCase()} push delivery failed:`, error.message);
      }
    }
  } catch (error) {
    errors.push(error);
  }

  const invalid = results.flatMap((r) => r.invalid);
  if (invalid.length) await PushToken.updateMany({ token: { $in: invalid } }, { $set: { active: false } });

  const accepted = results.reduce((n, r) => n + r.accepted, 0);
  const rejected = results.reduce((n, r) => n + r.rejected, 0);
  if (!results.length) {
    const error = errors[0];
    log({ status: 'failed', error: String(error?.message).slice(0, 300), errorCode: error?.code || null });
    throw error;
  }
  log({
    status: !rejected && !errors.length ? 'sent' : accepted ? 'partial' : 'failed',
    accepted,
    rejected,
    errorCode: results.find((r) => r.errorCode)?.errorCode || errors[0]?.code || null,
  });
  if (rejected) console.error('Push delivery had %d failures (%d accepted)', rejected, accepted);
}

/**
 * Push to every active device of a user, through the push queue (services/queue): returns
 * once queued; a failed provider call is retried with backoff instead of being dropped.
 */
async function sendPushToUser(userId, message) {
  return require('./queue').enqueue('push', 'send', { userId: String(userId), message });
}

module.exports = { sendPushToUser, deliverPush };
