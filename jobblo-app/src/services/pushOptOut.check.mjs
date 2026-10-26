// Check for pushNotifications.service.ts: opt-out survives a cold start, and the local token
// is only forgotten once the server deactivated it. Run: node src/services/pushOptOut.check.mjs
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const stubs = {
  'react-native': 'export const Platform = { OS: "android" };',
  'expo-constants': 'export default { appOwnership: "standalone", deviceId: "d1" };',
  '@react-native-async-storage/async-storage': 'export default globalThis.__storage;',
  '../api/client': 'export default globalThis.__api;',
};
registerHooks({
  resolve: (specifier, context, next) => (specifier in stubs ? { url: `stub:${specifier}`, shortCircuit: true } : next(specifier, context)),
  load: (url, context, next) => (url.startsWith('stub:') ? { format: 'module', source: stubs[url.slice(5)], shortCircuit: true } : next(url, context)),
});

const data = new Map();
globalThis.__storage = { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v), removeItem: async (k) => void data.delete(k) };
let deleteFails = false;
let tokenRequests = 0;
globalThis.__api = { post: async () => ({}), delete: async () => { if (deleteFails) throw new Error('offline'); return {}; } };
let nativePresent = true; // false = a native build older than the JS (Expo SDK 58)
globalThis.require = (name) => name === 'expo-modules-core'
  ? { requireOptionalNativeModule: () => (nativePresent ? {} : null) }
  : ({
  setNotificationHandler() {}, setNotificationChannelAsync: async () => {},
  getPermissionsAsync: async () => ({ status: 'granted' }),
  getDevicePushTokenAsync: async () => { tokenRequests += 1; return { data: 'fcm-token-123' }; },
  addPushTokenListener: () => ({ remove() {} }),
  });
const push = await import('./pushNotifications.service.ts');

assert.equal((await push.registerPushNotifications({ automatic: true })).registered, true, 'auto-registers by default');
assert.equal(await push.getRegisteredPushToken(), 'fcm-token-123');

// Server refused / offline: the key stays so a later logout or tap can retry.
deleteFails = true;
await assert.rejects(push.deactivateRegisteredPushToken());
assert.equal(await push.getRegisteredPushToken(), 'fcm-token-123', 'key kept when the DELETE failed');

// Opt-out in settings, then a cold start: no re-registration.
deleteFails = false;
await push.deactivateRegisteredPushToken({ optOut: true });
assert.equal(await push.getRegisteredPushToken(), null, 'key removed once the server confirmed');
const before = tokenRequests;
assert.equal((await push.registerPushNotifications({ automatic: true })).registered, false, 'cold start respects opt-out');
assert.equal(tokenRequests, before);

// Tapping "Aktiver" clears the opt-out.
assert.equal((await push.registerPushNotifications()).registered, true);
assert.equal((await push.registerPushNotifications({ automatic: true })).registered, true, 'opt-out cleared by enabling');
// A native build older than the JS: push switches off without throwing (it was a red error).
nativePresent = false;
const warnings = [];
const origWarn = console.warn;
console.warn = (...a) => warnings.push(a.join(' '));
const r = await push.registerPushNotifications({ automatic: true });
console.warn = origWarn;
assert.equal(r.registered, false, 'no registration on a stale native build');
assert.ok(warnings.some((w) => w.includes('Rebuild')), 'one clear rebuild warning');

delete globalThis.require;
console.log('pushOptOut: all checks passed');
