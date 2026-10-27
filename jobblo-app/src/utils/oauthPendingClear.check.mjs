// Check: an OAuth attempt that ends without a sign-in closes the pending window (H1 follow-up).
// Run: node src/utils/oauthPendingClear.check.mjs
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Stub the React Native / Expo / app modules; the code under test is the real files.
const stubs = {
  'react-native':
    'export const Platform = { OS: "ios" }; export const AppState = { addEventListener: () => ({ remove() {} }) }; export const Linking = { addEventListener: () => ({ remove() {} }) };',
  'expo-web-browser':
    'export const openAuthSessionAsync = async () => globalThis.__browserResult; export const dismissAuthSession = () => {};',
  'expo-linking': 'export const createURL = (p) => "jobblo://" + p;',
  '@react-native-async-storage/async-storage':
    'const m = new Map(); export default { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v), removeItem: async (k) => void m.delete(k), multiSet: async (kv) => kv.forEach(([k, v]) => m.set(k, v)), multiRemove: async (ks) => ks.forEach((k) => m.delete(k)) };',
  react: 'export const useEffect = () => {}; export const useState = (v) => [v, () => {}];',
  '@tanstack/react-query': 'export const useQueryClient = () => ({});',
  '@/store/authStore':
    'export const useAuthStore = { getState: () => ({ isAuthenticated: false, login: async () => {} }) };',
  '@/queryKeys': 'export const queryKeys = { auth: {} };',
  '@/services/auth.service':
    'export const isUsableAuthToken = (t) => t.length > 10; export const fetchProfileWithToken = async () => ({ _id: "attacker" }); export const exchangeOAuthCode = async () => "attacker.token.x";',
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

const session = await import('./oauthAuthSession.ts');
const { completeOAuthSignIn } = await import('../hooks/useOAuthLoginCompletion.ts');
const attackerLink = 'jobblo://oauth-success?token=attacker-token-0123456789';

// Browser closed without a return URL → the attacker's link afterwards is refused.
globalThis.__browserResult = { type: 'cancel' };
assert.equal(
  (await session.runOAuthSession('google', 'https://jobblo.no/api')).outcome,
  'dismissed'
);
assert.equal(await session.getOAuthPendingSince(), 0, 'dismissed attempt clears pending');
assert.equal((await completeOAuthSignIn(attackerLink)).status, 'failed');

// Provider returned ?error= → pending cleared.
globalThis.__browserResult = { type: 'success', url: 'jobblo://oauth-success?error=access_denied' };
const returned = await session.runOAuthSession('vipps', 'https://jobblo.no/api');
assert.equal(returned.outcome, 'returned');
assert.ok(
  (await session.getOAuthPendingSince()) > 0,
  'returned URL keeps pending until it is parsed'
);
assert.equal((await completeOAuthSignIn(returned.url)).status, 'failed');
assert.equal(await session.getOAuthPendingSince(), 0, 'error return clears pending');
assert.equal(
  (await completeOAuthSignIn(attackerLink)).status,
  'failed',
  'attacker link refused after error'
);

console.log('oauthPendingClear: all checks passed');
