// Check: a silent refresh that comes back as ANOTHER account (the device's leftover refresh
// cookie from an earlier, failed sign-out) is a failed refresh, never an account switch.
// Run: node src/api/client.check.mjs
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const stubs = {
  axios: `
    const instance = async (config) => { globalThis.__retried = config; return { data: 'retried' }; };
    instance.interceptors = {
      request: { use: () => {} },
      response: { use: (ok, fail) => { globalThis.__onError = fail; } },
    };
    export default { create: () => instance, post: async () => ({ data: { accessToken: globalThis.__refreshed } }) };`,
  'expo-device': 'export const modelName = "Pixel"; export const manufacturer = "Google";',
  '../utils/authStorage': 'const m = globalThis.__storage = new Map(); export const authStorage = { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v), removeItem: async (k) => void m.delete(k) };',
  '../monitoring/reporter': 'export const monitorAxios = () => {};',
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier in stubs) return { url: `stub:${specifier}`, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('stub:')) return { format: 'module', source: stubs[url.slice(5)], shortCircuit: true };
    return next(url, context);
  },
});

// The lazy `require('../store/authStore')` in client.ts.
let state;
const useAuthStore = {
  getState: () => ({ ...state, logout: async () => { state.loggedOut = true; } }),
  setState: (patch) => Object.assign(state, patch),
};
globalThis.require = (spec) => {
  assert.equal(spec, '../store/authStore');
  return { useAuthStore };
};

await import('./client.ts');
const jwt = (id) => `h.${Buffer.from(JSON.stringify({ id, typ: 'access' })).toString('base64url')}.sig`;
const expired401 = () => ({ response: { status: 401 }, config: { url: '/jobs', headers: { Authorization: `Bearer ${jwt('userB')}` } } });

async function refreshAs(refreshedId) {
  state = { user: { _id: 'userB' }, token: jwt('userB'), loggedOut: false };
  globalThis.__storage.set('token', jwt('userB'));
  globalThis.__refreshed = jwt(refreshedId);
  globalThis.__retried = null;
  const result = await globalThis.__onError(expired401()).then((r) => r, (e) => e);
  await new Promise((r) => setTimeout(r, 0)); // teardown is fire-and-forget
  return result;
}

// Refresh cookie is still A's: B must NOT become A.
await refreshAs('userA');
assert.equal(globalThis.__retried, null, 'request must not be retried as another account');
assert.equal(globalThis.__storage.get('token'), jwt('userB'), "A's token must not be stored");
assert.equal(state.loggedOut, true, 'mismatch tears the session down');

// Same account: normal silent refresh.
await refreshAs('userB');
assert.equal(state.loggedOut, false);
assert.equal(globalThis.__retried?.headers.Authorization, `Bearer ${jwt('userB')}`);
assert.equal(globalThis.__storage.get('token'), jwt('userB'));

// Unreadable token: failed refresh.
await refreshAs(undefined);
assert.equal(state.loggedOut, true);

console.log('ok: refresh as another account is refused, same account refreshes');
