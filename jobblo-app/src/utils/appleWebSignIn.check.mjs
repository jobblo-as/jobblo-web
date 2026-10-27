// Check for Sign in with Apple on Android (Apple's web flow) and which Apple button shows where.
// Run: node src/utils/appleWebSignIn.check.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { registerHooks } from 'node:module';

const stubs = {
  'react-native':
    'export const Platform = { OS: "android" }; export const AppState = { addEventListener: () => ({ remove() {} }) }; export const Linking = { addEventListener: () => ({ remove() {} }) };',
  'expo-web-browser':
    'export const openAuthSessionAsync = async (url) => { globalThis.__startUrl = url; return { type: "cancel" }; }; export const dismissAuthSession = () => {};',
  'expo-linking': 'export const createURL = (p) => "jobblo://" + p;',
  '@react-native-async-storage/async-storage':
    'const m = new Map(); export default { getItem: async (k) => m.get(k) ?? null, multiSet: async (kv) => kv.forEach(([k, v]) => m.set(k, v)), multiRemove: async (ks) => ks.forEach((k) => m.delete(k)) };',
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

const { appleSignInMode } = await import('../config/features.ts');
assert.equal(appleSignInMode('ios', undefined), 'native', 'iOS always gets the native button');
assert.equal(appleSignInMode('ios', 'true'), 'native');
assert.equal(appleSignInMode('android', undefined), null, 'Android: hidden by default');
assert.equal(appleSignInMode('android', 'false'), null);
assert.equal(
  appleSignInMode('android', 'true'),
  'web',
  'Android: web flow when the build enables it'
);
assert.equal(appleSignInMode('web', 'true'), null);

const { oauthStartUrl, runOAuthSession, getOAuthVerifier } = await import('./oauthAuthSession.ts');
assert.equal(
  oauthStartUrl('apple', 'https://jobblo.no/api/', 'c'.repeat(43)),
  `https://jobblo.no/api/auth/mobile/apple?code_challenge=${'c'.repeat(43)}&code_challenge_method=S256`
);

// The real flow: the start URL carries the S256 challenge of the verifier kept for the exchange.
let verifier = '';
const run = runOAuthSession('apple', 'https://jobblo.no/api');
await new Promise((r) => setTimeout(r, 0));
verifier = await getOAuthVerifier();
const start = new URL(globalThis.__startUrl);
assert.equal(start.pathname, '/api/auth/mobile/apple');
assert.equal(start.searchParams.get('code_challenge_method'), 'S256');
assert.equal(
  start.searchParams.get('code_challenge'),
  crypto.createHash('sha256').update(verifier).digest('base64url')
);
assert.equal((await run).outcome, 'dismissed');

console.log('appleWebSignIn: all checks passed');
