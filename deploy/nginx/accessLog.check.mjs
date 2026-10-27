// Check: no nginx access log in deploy/nginx writes a query string (bearer tokens from
// /api/auth/mobile-return?token=, OAuth ?code=). Run: node deploy/nginx/accessLog.check.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('.', import.meta.url);
const conf = readdirSync(dir).filter((f) => f.endsWith('.conf'))
  .map((f) => readFileSync(new URL(f, dir), 'utf8').replace(/#.*$/gm, '')).join('\n');

const formats = Object.fromEntries(
  [...conf.matchAll(/log_format\s+(\w+)\s+(?:escape=\w+\s+)?([^;]*);/g)].map((m) => [m[1], m[2]])
);
const used = [...conf.matchAll(/access_log\s+([^\s;]+)(?:[ \t]+(\w+))?[^;]*;/g)]
  .filter((m) => m[1] !== 'off').map((m) => m[2] || 'combined');

assert.ok(used.length > 0, 'expected access_log lines');
for (const name of used) {
  assert.ok(name in formats, `access_log uses "${name}" (built-in combined logs $request with the query string)`);
  assert.doesNotMatch(formats[name], /\$(request\b(?!_(method|time))|request_uri|args|query_string|arg_|http_referer)/,
    `log_format ${name} logs a query string`);
}
console.log(`ok: ${used.length} access_log line(s), formats ${[...new Set(used)].join(', ')} carry no query string`);
