/**
 * P3 boot guards: production refuses a public HOST (unless ALLOW_PUBLIC_HOST=true) and
 * refuses to run without its own SESSION_SECRET (dev/test keep the JWT_SECRET fallback).
 */
jest.mock('../db', () => jest.fn());

const { warnIfPublic } = require('../bootstrap');
const { sessionMiddleware } = require('../config/session');

describe('HOST in production', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('refuses a public HOST', () => {
    expect(() => warnIfPublic(5001, '0.0.0.0', { NODE_ENV: 'production' })).toThrow(/Refusing to start/);
    expect(() => warnIfPublic(5001, undefined, { NODE_ENV: 'production' })).toThrow(/Refusing to start/);
  });
  it('allows loopback, an explicit override (with a warning), and any HOST outside production', () => {
    expect(() => warnIfPublic(5001, '127.0.0.1', { NODE_ENV: 'production' })).not.toThrow();
    expect(() => warnIfPublic(5001, '0.0.0.0', { NODE_ENV: 'production', ALLOW_PUBLIC_HOST: 'true' })).not.toThrow();
    expect(console.warn).toHaveBeenCalled();
    expect(() => warnIfPublic(5001, '0.0.0.0', { NODE_ENV: 'development' })).not.toThrow();
  });
});

describe('SESSION_SECRET', () => {
  it('is required in production', () => {
    expect(() => sessionMiddleware({ NODE_ENV: 'production', JWT_SECRET: 'j' })).toThrow(/SESSION_SECRET is required/);
  });
  it('falls back to JWT_SECRET outside production', () => {
    expect(typeof sessionMiddleware({ NODE_ENV: 'test', JWT_SECRET: 'j' })).toBe('function');
  });
});
