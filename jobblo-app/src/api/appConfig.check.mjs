// Check for app.config.js: non-development EAS profiles need an https:// API URL.
// Run: node src/api/appConfig.check.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const load = (env) => {
  try {
    execFileSync(process.execPath, ['-e', "require('./app.config.js')"], { cwd: root, env: { PATH: process.env.PATH, ...env }, stdio: 'pipe' });
    return 'ok';
  } catch (error) {
    return String(error.stderr);
  }
};
assert.match(load({ EAS_BUILD_PROFILE: 'preview' }), /must be an https:\/\/ URL/, 'preview without URL refused');
assert.match(load({ EAS_BUILD_PROFILE: 'preview', EXPO_PUBLIC_API_URL: 'http://10.0.0.5:5001' }), /must be an https:\/\/ URL/, 'plain http refused');
assert.equal(load({ EAS_BUILD_PROFILE: 'preview', EXPO_PUBLIC_API_URL: 'https://staging.jobblo.no' }), 'ok');
assert.equal(load({ EAS_BUILD_PROFILE: 'production', EXPO_PUBLIC_API_URL: 'https://jobblo.no' }), 'ok');
assert.equal(load({ EAS_BUILD_PROFILE: 'development' }), 'ok', 'dev client may use localhost');
assert.equal(load({}), 'ok', 'local expo start unaffected');
console.log('appConfig: all checks passed');
