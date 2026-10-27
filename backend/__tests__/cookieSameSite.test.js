/**
 * Auth and session cookies are SameSite=Lax in production too: web app and API are
 * same-site and every OAuth callback is a top-level GET. None only widened CSRF exposure.
 */
const fs = require('fs');
const path = require('path');

it('auth cookie options are Lax (and Secure) in production', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  jest.isolateModules(() => {
    const h = require('../controllers/auth/authHelpers');
    for (const o of [h.accessCookieOptions, h.refreshCookieOptions, h.clearCookieOptions]) {
      expect(o).toMatchObject({ sameSite: 'lax', secure: true, httpOnly: true });
    }
  });
  process.env.NODE_ENV = prev;
});

it('no cookie anywhere in the auth flows is set with SameSite=None', () => {
  const files = [
    'controllers/auth/authHelpers.js',
    'controllers/vippsController.js',
    'routes/webOAuth.js',
    'routes/mobileOAuth.js',
    'config/session.js',
  ];
  for (const f of files) {
    expect(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).not.toMatch(
      /sameSite:[^\n]*'none'/
    );
  }
  expect(fs.existsSync(path.join(__dirname, '..', 'utils', 'setCookie.js'))).toBe(false);
});
