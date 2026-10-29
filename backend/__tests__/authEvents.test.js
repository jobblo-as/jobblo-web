/**
 * Sign-in and password-reset activity per IP (models/AuthEvent): every outcome is named, the
 * email is masked, and nothing of it lands in SecurityEvent (alerts and risk count that).
 */
const securityEvents = require('../services/monitoring/securityEvents');

const { classifyAuth } = securityEvents;

test.each([
  ['/api/auth/login', 200, 'login'],
  ['/api/auth/login', 401, 'login_failed'],
  ['/api/auth/login', 403, 'login_failed'],
  ['/api/auth/login', 429, null], // rate limited: a SecurityEvent, not an attempt
  ['/api/auth/forgot-password', 200, 'password_reset_requested'],
  ['/api/auth/reset-password', 200, 'password_reset'],
  ['/api/auth/reset-password', 400, 'password_reset_failed'],
  ['/api/services', 200, null],
])('%s %i → %s', (path, status, type) => {
  expect(classifyAuth({ path, status })).toBe(type);
});

test('a successful login is stored with a masked email, and never as a security event', async () => {
  const AuthEvent = require('../models/AuthEvent');
  const SecurityEvent = require('../models/SecurityEvent');
  const authInsert = jest.spyOn(AuthEvent, 'insertMany').mockResolvedValue([]);
  const secInsert = jest.spyOn(SecurityEvent, 'insertMany').mockResolvedValue([]);
  const req = {
    originalUrl: '/api/auth/login',
    method: 'POST',
    ip: '::ffff:84.210.1.2',
    body: { email: 'Kari.Nordmann@example.no', password: 'secret' },
    get: () => 'Mozilla/5.0',
  };
  securityEvents.record(req, { statusCode: 200, locals: {} });
  await securityEvents.flush();
  expect(authInsert).toHaveBeenCalledTimes(1);
  const [row] = authInsert.mock.calls[0][0];
  expect(row).toMatchObject({ type: 'login', ip: '84.210.1.2', email: 'k***@example.no' });
  expect(JSON.stringify(row)).not.toContain('secret');
  expect(secInsert).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});
