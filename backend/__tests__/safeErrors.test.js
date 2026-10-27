/**
 * M1 / M12: no response carries raw MongoDB/Stripe text, every 500 is findable by its
 * request id, 404s are not logged as server errors, and logs hold no personal data.
 */
jest.mock('../utils/errorLogger', () => ({ logApplicationError: jest.fn().mockResolvedValue(undefined) }));
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { logApplicationError } = require('../utils/errorLogger');
const { serverError, inputOrServerError } = require('../utils/serverError');
const { notFound, errorHandler } = require('../middleware/errorHandlers');
const requestId = require('../middleware/requestId');
const { redactText, redactSensitive } = require('../utils/sanitizer');

const mongoDupKey = Object.assign(new Error('E11000 duplicate key error collection: jobblo.users index: email_1 dup key: { email: "kari@example.no" }'), { name: 'MongoServerError', code: 11000 });

function app(handler) {
  const a = express();
  a.use(requestId);
  a.get('/x', handler);
  a.use(notFound);
  a.use(errorHandler);
  return a;
}

beforeEach(() => jest.clearAllMocks());

it('serverError: generic message + request id, raw text only in the log', async () => {
  const res = await request(app((req, res) => serverError(res, mongoDupKey))).get('/x').set('X-Request-ID', 'abc-123');
  expect(res.status).toBe(500);
  expect(JSON.stringify(res.body)).not.toMatch(/E11000|kari|jobblo\.users/);
  expect(res.body.referenceId).toBe('abc-123');
  expect(logApplicationError).toHaveBeenCalledWith(expect.objectContaining({ error: mongoDupKey, httpStatus: 500, correlationId: 'abc-123' }));
});

it('inputOrServerError: validation is 400 with its message, a cast error says nothing internal, the rest is a safe 500', async () => {
  const validation = Object.assign(new Error('Title is required'), { name: 'ValidationError' });
  const cast = Object.assign(new Error('Cast to ObjectId failed for value "x" at path "_id" for model "Service"'), { name: 'CastError' });
  expect((await request(app((q, r) => inputOrServerError(r, validation))).get('/x')).body).toEqual({ error: 'Title is required' });
  const c = await request(app((q, r) => inputOrServerError(r, cast))).get('/x');
  expect(c.status).toBe(400);
  expect(JSON.stringify(c.body)).not.toMatch(/ObjectId|Service/);
  expect((await request(app((q, r) => inputOrServerError(r, mongoDupKey))).get('/x')).status).toBe(500);
});

it('an unknown URL is a 404 that is not logged as INTERNAL_SERVER_ERROR', async () => {
  const res = await request(app((q, r) => r.end())).get('/nope');
  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe('HTTP_404');
  expect(logApplicationError).not.toHaveBeenCalled();
});

it('a thrown server error still is logged and answered without its text', async () => {
  const res = await request(app(() => { throw mongoDupKey; })).get('/x');
  expect(res.status).toBe(500);
  expect(JSON.stringify(res.body)).not.toMatch(/E11000/);
  expect(logApplicationError).toHaveBeenCalledTimes(1);
});

it('a client request id is only echoed when it is short and plain', async () => {
  const ok = await request(app((q, r) => r.json({}))).get('/x').set('X-Request-ID', 'trace-42');
  expect(ok.headers['x-request-id']).toBe('trace-42');
  const bad = await request(app((q, r) => r.json({}))).get('/x').set('X-Request-ID', '<script>' + 'a'.repeat(200));
  expect(bad.headers['x-request-id']).toMatch(/^REQ-[0-9A-F]+$/);
});

it('log text is redacted: e-mails, dup-key values and phone numbers', () => {
  expect(redactText(mongoDupKey.message)).not.toMatch(/kari/);
  expect(redactText('Ring +47 912 34 567 eller kari.nord@example.no, ordre 42')).toBe('Ring [NUMBER] eller [EMAIL], ordre 42');
  expect(redactSensitive({ email: 'a@b.no', phone: '1', homeAddress: 'x', dateOfBirth: 'y', errorCode: 'E1', postCode: '0150' }))
    .toEqual({ email: '[REDACTED]', phone: '[REDACTED]', homeAddress: '[REDACTED]', dateOfBirth: '[REDACTED]', errorCode: 'E1', postCode: '0150' });
});

it('no controller sends a raw error message with a 500 (regression guard)', () => {
  const offenders = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return walk(p);
    if (!p.endsWith('.js')) return;
    fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      if (/status\(500\)\.json\([^)]*\b(err|error|e)\.message/.test(line) || /status\((err|error|e)\.status \|\| 500\)\.json\(\{ error: \1\.message/.test(line)) offenders.push(`${p}:${i + 1}`);
    });
  });
  walk(path.join(__dirname, '..', 'controllers'));
  expect(offenders).toEqual([]);
});

it('server console output is redacted, Error objects included', () => {
  const lines = [];
  const fake = { log: (s) => lines.push(s), info: (s) => lines.push(s), warn: (s) => lines.push(s), error: (s) => lines.push(s) };
  require('../utils/consoleRedaction').installConsoleRedaction(fake);
  fake.error('[Orders] application creation failed:', mongoDupKey);
  fake.log('user', { email: 'kari@example.no', phone: '+47 912 34 567' });
  expect(lines.join('\n')).not.toMatch(/kari|912 34 567/);
  expect(lines[0]).toMatch(/application creation failed: .*MongoServerError.*E11000/);
});

it('final review I1: redactText is linear (no ReDoS) and catches dashed/dotted numbers and %40 e-mails', () => {
  const N = 60000;
  let t = Date.now();
  redactText('a'.repeat(N) + '@' + 'a.'.repeat(N));
  redactText('b'.repeat(15000) + '@' + 'b.'.repeat(2000)); // under the 20 000 cap: the regex itself must be fast
  expect(Date.now() - t).toBeLessThan(500);
  expect(redactText('+47 412-34-567 / 412.34.567 / kari%40example.no')).toBe('[NUMBER] / [NUMBER] / [EMAIL]');
  expect(redactText('at 2026-10-26 for ordre 42')).toBe('at 2026-10-26 for ordre 42');
});

it('Redis and connection-string passwords never reach the logs', () => {
  const util = require('util');
  const PW = '3fa03943c659b5df05bdf8d291cb6272f03d0fc9c30627f24aa316f48a8879ea';
  // What PM2's error log showed: an ioredis ReplyError printed whole, with its command.
  const err = Object.assign(new Error('WRONGPASS invalid username-password pair or user is disabled.'), {
    command: { name: 'hello', args: ['3', 'AUTH', 'default', PW] },
  });
  const line = redactText(util.format(err));
  expect(line).not.toContain(PW);
  expect(line).toMatch(/WRONGPASS/); // the reason stays readable
  expect(redactText(util.format({ args: ['AUTH', PW] }))).not.toContain(PW); // no username form
  for (const url of [`redis://default:${PW}@127.0.0.1:6379`, `redis://:${PW}@127.0.0.1:6379`, `mongodb+srv://jobblo:${PW}@cluster0.x.mongodb.net/db`]) {
    expect(redactText(`connect ${url} failed`)).not.toContain(PW);
  }
  expect(redactText('redis://127.0.0.1:6379')).toBe('redis://127.0.0.1:6379'); // nothing secret, unchanged
  expect(redactText('AUTH failed: WRONGPASS')).toBe('AUTH failed: WRONGPASS');
  const t = Date.now();
  redactText(`'AUTH', '${'x'.repeat(19000)}`);
  redactText(`a://${'b'.repeat(19000)}:`);
  expect(Date.now() - t).toBeLessThan(500);
});

it('a full password-hash queue is a 503 with Retry-After, not a 500 (serverError and asyncHandler)', async () => {
  const busy = Object.assign(new Error('busy'), { code: 'PASSWORD_HASH_BUSY' });
  const a = await request(app((q, r) => serverError(r, busy))).get('/x');
  expect(a.status).toBe(503);
  expect(a.headers['retry-after']).toBe('5');
  const { asyncHandler } = require('../utils/apiResponse');
  const b = await request(app(asyncHandler(async () => { throw busy; }))).get('/x');
  expect(b.status).toBe(503);
});
