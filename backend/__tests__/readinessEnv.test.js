/**
 * The readiness page's environment list (Developer Tools): every name on it is one the code
 * really reads — it used to report EMAIL_HOST / EMAIL_USER / FIREBASE_SERVICE_ACCOUNT as missing
 * while email uses SMTP_* and Firebase uses GOOGLE_APPLICATION_CREDENTIALS.
 */
const fs = require('fs');
const path = require('path');
const { ENV_KEYS, envStatus } = require('../controllers/developer/toolsController');

const ROOT = path.join(__dirname, '..');
function sources(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '__tests__', 'coverage'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (p.endsWith('.js') && !p.endsWith('toolsController.js'))
      out.push(fs.readFileSync(p, 'utf8'));
  }
  return out;
}
const code = sources(ROOT).join('\n');

test('every variable on the readiness list is read somewhere in the backend', () => {
  const names = ENV_KEYS.flatMap((e) => (typeof e === 'string' ? [e] : e.anyOf || [e.name]));
  const unread = names.filter((n) => !new RegExp(`\\b${n}\\b`).test(code));
  expect(unread).toEqual([]);
  expect(names).not.toContain('EMAIL_HOST');
  expect(names).not.toContain('FIREBASE_SERVICE_ACCOUNT');
});

test('required, optional and either-of are reported as such', () => {
  expect(envStatus('MONGO_URI', {})).toEqual({
    name: 'MONGO_URI',
    present: false,
    optional: false,
    note: null,
  });
  expect(envStatus({ name: 'REDIS_URL', optional: true }, {})).toMatchObject({
    present: false,
    optional: true,
  });
  const firebase = ENV_KEYS.find((e) => e.anyOf);
  expect(envStatus(firebase, { FIREBASE_CONFIG: 'x' }).present).toBe(true);
  expect(envStatus(firebase, { GOOGLE_APPLICATION_CREDENTIALS: '/k.json' }).present).toBe(true);
  expect(envStatus(firebase, {}).present).toBe(false);
});

test('values never leave the server: only presence is reported', () => {
  const r = envStatus({ name: 'SMTP_PASS' }, { SMTP_PASS: 'hunter2' });
  expect(JSON.stringify(r)).not.toContain('hunter2');
});
