// The committed env templates: placeholders only, and the per-environment files stay in step
// with the full reference (.env.example) that the developer dashboard's config drift reads.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const vars = (f) => Object.fromEntries(read(f).split(/\r?\n/).map((l) => /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
const FILES = ['backend/.env.example', 'backend/.env.development.example', 'backend/.env.production.example', 'frontend/.env.example', 'frontend/.env.development.example', 'frontend/.env.production.example'];
// Shapes of real credentials; the examples may only hold empty values or obvious placeholders.
const SECRET = /sk_(live|test)_[A-Za-z0-9]{8,}|rk_(live|test)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}|AccountKey=[A-Za-z0-9+/]{20,}|mongodb(\+srv)?:\/\/[^\s:@/]+:[^\s@/]+@|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY/;

test.each(FILES)('%s holds no real secret', (f) => {
  expect(read(f)).not.toMatch(SECRET);
});

test.each(['backend/.env.development.example', 'backend/.env.production.example'])('%s only uses variables documented in .env.example', (f) => {
  const documented = vars('backend/.env.example');
  expect(Object.keys(vars(f)).filter((k) => !(k in documented))).toEqual([]);
});

test('production template boots safely', () => {
  const prod = vars('backend/.env.production.example');
  expect(prod.NODE_ENV).toBe('production');
  expect(prod.HOST).toBe('127.0.0.1');
  for (const k of ['ENABLE_API_DOCS', 'ENABLE_FAILURE_SIMULATOR', 'ALLOW_PUBLIC_HOST', 'SAFEPAY_CONNECT_TEST_DEADLINE_MINUTES']) expect(prod[k] || '').toBe('');
  for (const k of ['JWT_SECRET', 'SESSION_SECRET', 'MONGO_URI', 'MOBILE_RETURN_URL']) expect(k in prod).toBe(true);
});

test('backend and frontend agree on the dev API port', () => {
  const port = vars('backend/.env.development.example').PORT;
  expect(vars('frontend/.env.development.example').VITE_MAIN_URL).toBe(`http://localhost:${port}`);
  expect(read('frontend/src/config/env.ts')).toContain(`'http://localhost:${port}'`);
});
