// Check for P6: OAuth deep links carry a one-time code redeemed with a PKCE verifier, never a token.
// Run: node src/utils/pkce.check.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { registerHooks } from 'node:module';

// Stub the React Native / Expo / app modules; the code under test is the real files.
const stubs = {
  'react-native':
    'export const Platform = { OS: "ios" }; export const AppState = { addEventListener: () => ({ remove() {} }) }; export const Linking = { addEventListener: () => ({ remove() {} }) };',
  'expo-web-browser':
    'export const openAuthSessionAsync = async (url) => { globalThis.__startUrl = url; return globalThis.__browserResult; }; export const dismissAuthSession = () => {};',
  'expo-linking': 'export const createURL = (p) => "jobblo://" + p;',
  '@react-native-async-storage/async-storage':
    'const m = new Map(); export default { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v), removeItem: async (k) => void m.delete(k), multiSet: async (kv) => kv.forEach(([k, v]) => m.set(k, v)), multiRemove: async (ks) => ks.forEach((k) => m.delete(k)) };',
  react: 'export const useEffect = () => {}; export const useState = (v) => [v, () => {}];',
  '@tanstack/react-query': 'export const useQueryClient = () => ({});',
  '@/store/authStore':
    'const s = { isAuthenticated: false, login: async (t) => { s.isAuthenticated = true; globalThis.__loggedInWith = t; } }; export const useAuthStore = { getState: () => s };',
  '@/queryKeys': 'export const queryKeys = { auth: {} };',
  '@/services/auth.service':
    'export const fetchProfileWithToken = async () => ({ _id: "u1" }); export const exchangeOAuthCode = async (code, verifier) => { globalThis.__exchanges.push({ code, verifier }); if (globalThis.__exchangeFails) throw new Error("400"); return "h.p.s"; };',
  '@/utils/oauthErrors': 'export const oauthErrorMessage = () => null;',
};
const here = new URL('.', import.meta.url);
const real = {
  '@/utils/oauthPending': new URL('./oauthPending.ts', here).href,
  '@/utils/oauthAuthSession': new URL('./oauthAuthSession.ts', here).href,
  '@/utils/pkce': new URL('./pkce.ts', here).href,
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier in stubs) return { url: `stub:${specifier}`, shortCircuit: true };
    if (specifier in real) return { url: real[specifier], shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('stub:'))
      return { format: 'module', source: stubs[url.slice(5)], shortCircuit: true };
    return next(url, context);
  },
});

const { sha256, codeChallengeFor, createPkcePair } = await import('./pkce.ts');
const session = await import('./oauthAuthSession.ts');
const { completeOAuthSignIn } = await import('../hooks/useOAuthLoginCompletion.ts');

// SHA-256 matches node:crypto across block boundaries; the challenge is base64url(SHA-256), as
// the backend computes it (utils/oauthReturn.js exchangeMobileCode).
for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 1000]) {
  const bytes = crypto.randomBytes(n);
  assert.equal(
    Buffer.from(sha256(bytes)).toString('hex'),
    crypto.createHash('sha256').update(bytes).digest('hex'),
    `sha256 len ${n}`
  );
}
const sample = crypto.randomBytes(32).toString('base64url');
assert.equal(
  codeChallengeFor(sample),
  crypto.createHash('sha256').update(sample).digest('base64url')
);

// Verifier: secure source, valid RFC 7636 shape, unique; the expo uuid fallback too.
const a = createPkcePair();
assert.match(a.verifier, /^[A-Za-z0-9._~-]{43,128}$/);
assert.notEqual(a.verifier, createPkcePair().verifier);
const savedCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
globalThis.expo = { uuidv4: () => crypto.randomUUID() };
assert.match(createPkcePair().verifier, /^[0-9a-f]{64}$/);
delete globalThis.expo;
assert.throws(() => createPkcePair(), /secure random/);
Object.defineProperty(globalThis, 'crypto', savedCrypto);

// The start URL carries the S256 challenge of the verifier the exchange later sends.
const code = crypto.randomBytes(32).toString('base64url');
globalThis.__exchanges = [];
globalThis.__browserResult = { type: 'success', url: `jobblo://oauth-success?code=${code}` };
const returned = await session.runOAuthSession('google', 'https://jobblo.no/api');
const start = new URL(globalThis.__startUrl);
assert.equal(start.pathname, '/api/auth/mobile/google');
assert.equal(start.searchParams.get('code_challenge_method'), 'S256');

// A token link (an attacker's, or an old-backend reply) is refused and closes the window.
assert.equal(
  (await completeOAuthSignIn('jobblo://oauth-success?token=aaaa.bbbb.cccc')).status,
  'failed'
);
assert.equal(await session.getOAuthPendingSince(), 0, 'token link clears pending');
assert.equal(globalThis.__exchanges.length, 0);

// Real flow: code + verifier exchanged once, even with two observers.
globalThis.__exchanges = [];
const again = await session.runOAuthSession('vipps', 'https://jobblo.no/api');
const challenge = new URL(globalThis.__startUrl).searchParams.get('code_challenge');
const [r1, r2] = await Promise.all([
  completeOAuthSignIn(again.url),
  completeOAuthSignIn(again.url),
]);
assert.equal(r1.status, 'signed-in');
assert.equal(r2.status, 'signed-in');
assert.equal(globalThis.__exchanges.length, 1, 'single flight: one exchange');
assert.equal(globalThis.__exchanges[0].code, code);
assert.equal(
  codeChallengeFor(globalThis.__exchanges[0].verifier),
  challenge,
  'verifier matches the challenge sent'
);
assert.equal(globalThis.__loggedInWith, 'h.p.s', 'logged in with the exchanged token');
assert.equal(await session.getOAuthPendingSince(), 0);
assert.equal(await session.getOAuthVerifier(), '', 'verifier cleared with the marker');

// A refused exchange ends the attempt: pending + verifier cleared.
const { useAuthStore } = await import('@/store/authStore');
useAuthStore.getState().isAuthenticated = false;
globalThis.__exchangeFails = true;
globalThis.__browserResult = {
  type: 'success',
  url: `jobblo://oauth-success?code=${crypto.randomBytes(32).toString('base64url')}`,
};
const failing = await session.runOAuthSession('google', 'https://jobblo.no/api');
assert.equal((await completeOAuthSignIn(failing.url)).status, 'failed');
assert.equal(await session.getOAuthPendingSince(), 0, 'failed exchange clears pending');
assert.equal(await session.getOAuthVerifier(), '');

assert.ok(returned.outcome === 'returned');
console.log('pkce: all checks passed');
