const PushToken = require('../models/PushToken');

// An Expo push token (the iOS app): ExponentPushToken[...] / ExpoPushToken[...].
const EXPO_TOKEN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/;

/** 'fcm' | 'expo', or null for anything that is neither. */
function providerOf(token) {
  if (typeof token !== 'string') return null;
  const value = token.trim();
  if (EXPO_TOKEN.test(value)) return 'expo';
  // FCM registration tokens are opaque strings: a bounded, printable format check.
  return value.length >= 20 && value.length <= 4096 && /^[A-Za-z0-9:_-]+$/.test(value)
    ? 'fcm'
    : null;
}
const validToken = (token) => providerOf(token) !== null;

const PUSH_GROUP_KEYS = ['messages', 'applications', 'orders', 'reviews', 'jobs'];
const preferencesOf = (user) =>
  Object.fromEntries(PUSH_GROUP_KEYS.map((k) => [k, user?.pushPreferences?.[k] !== false]));

// GET /api/push-tokens/preferences — which push groups this user wants (missing = on).
exports.getPreferences = async (req, res) => {
  try {
    const user = await require('../models/User')
      .findById(req.userId)
      .select('pushPreferences')
      .lean();
    if (!user) return res.status(404).json({ error: 'Bruker ikke funnet' });
    res.json({ preferences: preferencesOf(user) });
  } catch {
    res.status(500).json({ error: 'Kunne ikke hente varslingsinnstillinger' });
  }
};

// PUT /api/push-tokens/preferences — { messages?: boolean, … }; only the known groups, booleans.
exports.updatePreferences = async (req, res) => {
  const body = req.body || {};
  const $set = {};
  for (const key of PUSH_GROUP_KEYS) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== 'boolean')
      return res.status(400).json({ error: `Ugyldig verdi for ${key}` });
    $set[`pushPreferences.${key}`] = body[key];
  }
  if (!Object.keys($set).length) return res.status(400).json({ error: 'Ingen endringer' });
  try {
    const user = await require('../models/User')
      .findByIdAndUpdate(req.userId, { $set }, { new: true })
      .select('pushPreferences')
      .lean();
    if (!user) return res.status(404).json({ error: 'Bruker ikke funnet' });
    res.json({ preferences: preferencesOf(user) });
  } catch {
    res.status(500).json({ error: 'Kunne ikke lagre varslingsinnstillinger' });
  }
};

exports.register = async (req, res) => {
  const { token, platform, deviceId } = req.body || {};
  if (!validToken(token) || !['ios', 'android'].includes(platform)) {
    return res.status(400).json({ error: 'Ugyldig push-token eller plattform' });
  }

  try {
    const pushToken = await PushToken.findOneAndUpdate(
      { token: token.trim() },
      {
        provider: providerOf(token),
        userId: req.userId,
        platform,
        deviceId: typeof deviceId === 'string' ? deviceId : undefined,
        sessionId: req.sessionId,
        active: true,
        lastSeenAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(200).json({ registered: Boolean(pushToken) });
  } catch (error) {
    console.error('Push token registration failed:', error.message);
    return res.status(500).json({ error: 'Kunne ikke registrere push-varsler' });
  }
};

exports.providerOf = providerOf;

exports.deactivateCurrent = async (req, res) => {
  const token = req.body?.token;
  if (!validToken(token)) return res.status(400).json({ error: 'Ugyldig push-token' });

  try {
    await PushToken.updateOne(
      { token: token.trim(), userId: req.userId },
      { $set: { active: false } }
    );
    return res.json({ deactivated: true });
  } catch (error) {
    console.error('Push token deactivation failed:', error.message);
    return res.status(500).json({ error: 'Kunne ikke deaktivere push-varsler' });
  }
};
