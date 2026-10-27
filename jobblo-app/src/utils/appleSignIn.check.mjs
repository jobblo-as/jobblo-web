// Check for Sign in with Apple: nonce hashing and the sign-in hand-off. Run: node src/utils/appleSignIn.check.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { registerHooks } from 'node:module';

const stubs = {
  'expo-apple-authentication':
    'export const AppleAuthenticationScope = { FULL_NAME: 0, EMAIL: 1 }; export const signInAsync = async (o) => { globalThis.__appleReq = o; if (globalThis.__appleError) throw globalThis.__appleError; return { identityToken: "apple.id.token", fullName: { givenName: "Kari", familyName: null } }; };',
  '@/api/client':
    'export default { post: async (url, body, cfg) => { globalThis.__post = { url, body, cfg }; if (globalThis.__postError) throw globalThis.__postError; return { data: { accessToken: "h.p.s" } }; } };',
  '@/store/authStore':
    'const s = { isAuthenticated: false, login: async (t, u) => { s.isAuthenticated = true; globalThis.__login = { t, u }; } }; export const useAuthStore = { getState: () => s };',
  '@/services/auth.service':
    'export const isUsableAuthToken = (t) => typeof t === "string" && t.split(".").length === 3; export const fetchProfileWithToken = async (t) => ({ _id: "u1", token: t });',
};
const here = new URL('.', import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier in stubs) return { url: `stub:${specifier}`, shortCircuit: true };
    if (specifier === '@/utils/pkce')
      return { url: new URL('./pkce.ts', here).href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('stub:'))
      return { format: 'module', source: stubs[url.slice(5)], shortCircuit: true };
    return next(url, context);
  },
});
globalThis.crypto ??= crypto.webcrypto;

const { appleNonceHash, createAppleNonce, signInWithApple } = await import('./appleSignIn.ts');
const nodeHex = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Hashing matches node:crypto (which is what the backend compares against).
for (const s of ['', 'abc', 'a'.repeat(55), 'a'.repeat(64), 'x'.repeat(200)])
  assert.equal(appleNonceHash(s), nodeHex(s), `len ${s.length}`);
const n1 = createAppleNonce();
const n2 = createAppleNonce();
assert.ok(n1.raw.length >= 43 && /^[A-Za-z0-9_-]+$/.test(n1.raw), 'raw nonce is long and URL-safe');
assert.notEqual(n1.raw, n2.raw, 'fresh nonce each attempt');
assert.equal(n1.hashed, nodeHex(n1.raw));

// Apple gets the hash, the backend gets the raw value; then the normal login path runs.
let r = await signInWithApple();
assert.deepEqual(r, { status: 'signed-in' });
assert.deepEqual(globalThis.__appleReq.requestedScopes, [0, 1]);
assert.equal(globalThis.__post.url, '/auth/apple/native');
assert.equal(
  globalThis.__appleReq.nonce,
  nodeHex(globalThis.__post.body.rawNonce),
  'Apple nonce = sha256(raw sent to backend)'
);
assert.notEqual(globalThis.__appleReq.nonce, globalThis.__post.body.rawNonce);
assert.equal(globalThis.__post.body.identityToken, 'apple.id.token');
assert.deepEqual(globalThis.__post.body.fullName, { givenName: 'Kari', familyName: undefined });
assert.equal(globalThis.__post.cfg._callerSuppliedAuth, true);
assert.equal(globalThis.__login.u._id, 'u1');

// Never over an existing session.
globalThis.__login = null;
r = await signInWithApple();
assert.equal(r.status, 'failed');
assert.equal(globalThis.__login, null);

const { useAuthStore } = await import('@/store/authStore');
useAuthStore.getState().isAuthenticated = false;
globalThis.__appleError = Object.assign(new Error('x'), { code: 'ERR_REQUEST_CANCELED' });
assert.deepEqual(await signInWithApple(), { status: 'cancelled' });
globalThis.__appleError = null;

globalThis.__postError = { response: { data: { message: 'Det finnes allerede en konto' } } };
assert.deepEqual(await signInWithApple(), {
  status: 'failed',
  message: 'Det finnes allerede en konto',
});
assert.equal(useAuthStore.getState().isAuthenticated, false);

console.log('appleSignIn: all checks passed');
