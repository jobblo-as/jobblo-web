// Check: sign-up signs in at once and the e-mail is confirmed from the profile.
// Run: node src/services/emailCode.check.mjs
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const stubs = {
  '@/api/client':
    'export default { post: async (url, body) => { (globalThis.__posts ??= []).push({ url, body }); return { data: globalThis.__reply?.(url) ?? {} }; }, get: async () => ({ data: {} }) };',
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

const auth = await import('./auth.service.ts');

globalThis.__reply = (url) =>
  url === '/auth/register' ? { user: { _id: 'u1', email: 'k@x.no', emailVerified: false }, accessToken: 'a.b.c' }
  : url === '/auth/email/send-code' ? { message: 'Vi har sendt en kode til k@x.no.' }
  : url === '/auth/email/verify' ? { emailVerified: true }
  : {};

const reg = await auth.registerUser({ name: 'K', lastName: 'N', email: 'k@x.no', password: 'Passord123', acceptedTerms: true });
assert.equal(reg.accessToken, 'a.b.c', 'register answers like login (signed in at once)');
assert.equal(reg.user.emailVerified, false);

assert.equal((await auth.sendEmailCode()).message, 'Vi har sendt en kode til k@x.no.');
assert.deepEqual(await auth.confirmEmailCode('123456'), { emailVerified: true });
const [, send, verify] = globalThis.__posts;
assert.equal(send.url, '/auth/email/send-code');
assert.equal(send.body, undefined, 'no address from the client: the server uses the signed-in account');
assert.deepEqual(verify, { url: '/auth/email/verify', body: { code: '123456' } });

// The old "verify before sign-in" helpers are gone from the app.
for (const gone of ['verifyEmail', 'resendVerification', 'isEmailNotVerified']) assert.equal(auth[gone], undefined, gone);

console.log('emailCode: all checks passed');
