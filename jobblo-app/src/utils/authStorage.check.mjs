// Check for authStorage.ts (security review M9: token out of AsyncStorage).
// Run: node src/utils/authStorage.check.mjs
import assert from 'node:assert/strict';

const fakeStore = (initial = {}, { broken = false } = {}) => {
  const data = new Map(Object.entries(initial));
  const op =
    (fn) =>
    async (...args) => {
      if (broken) throw new Error('Native module is null');
      return fn(...args);
    };
  return {
    data,
    plain: {
      getItem: op((k) => data.get(k) ?? null),
      setItem: op((k, v) => void data.set(k, v)),
      removeItem: op((k) => void data.delete(k)),
    },
    secure: {
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
      getItemAsync: op((k) => data.get(k) ?? null),
      setItemAsync: op((k, v) => void data.set(k, v)),
      deleteItemAsync: op((k) => void data.delete(k)),
    },
  };
};

async function load(tag, plain, secure) {
  globalThis.require = (name) => {
    if (name === '@react-native-async-storage/async-storage') return plain.plain;
    if (name === 'expo-secure-store') return secure.secure;
    throw new Error(`unexpected require ${name}`);
  };
  return (await import(`./authStorage.ts?${tag}`)).authStorage;
}

// Upgrade: a token left in AsyncStorage by an older build moves to SecureStore once.
{
  const plain = fakeStore({ token: 'old-token', user: '{"_id":"u1"}' });
  const secure = fakeStore();
  const storage = await load('migrate', plain, secure);
  assert.equal(await storage.getItem('token'), 'old-token', 'upgrade keeps the user signed in');
  assert.equal(secure.data.get('token'), 'old-token', 'token now in SecureStore');
  assert.equal(plain.data.has('token'), false, 'plain copy deleted');
  assert.equal(plain.data.get('user'), '{"_id":"u1"}', 'profile stays on the plain backend');
  await storage.setItem('token', 'new-token');
  assert.equal(secure.data.get('token'), 'new-token');
  assert.equal(plain.data.has('token'), false, 'new token never written to AsyncStorage');
  await storage.removeItem('token');
  assert.equal(secure.data.has('token'), false);
}

// No working SecureStore (web / build without the native module): plain backend as before.
{
  const plain = fakeStore();
  const storage = await load('nosecure', plain, fakeStore({}, { broken: true }));
  await storage.setItem('token', 't');
  assert.equal(plain.data.get('token'), 't');
}

delete globalThis.require;
console.log('authStorage: all checks passed');
