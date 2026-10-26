/**
 * Every action/targetModel passed to logActivity must be allowed by the AdminActivity schema.
 * logActivity swallows validation errors, so a missing enum value silently dropped the audit
 * entry (dispute resolutions, chargeback recoveries, shop changes were never recorded).
 */
const fs = require('fs');
const path = require('path');
const AdminActivity = require('../models/AdminActivity');

it('every logActivity action and targetModel used in the code is in the schema enums', () => {
  const actions = new Set(AdminActivity.schema.path('action').enumValues);
  const targets = new Set(AdminActivity.schema.path('targetModel').enumValues);
  const missing = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    if (!p.endsWith('.js')) return;
    const src = fs.readFileSync(p, 'utf8');
    if (!/logActivity\(/.test(src)) return;
    for (const m of src.matchAll(/action:\s*'([a-zA-Z0-9_.-]+)'/g)) if (!actions.has(m[1])) missing.push(`${p}: action ${m[1]}`);
    for (const m of src.matchAll(/targetModel:\s*'([A-Za-z]+)'/g)) if (!targets.has(m[1])) missing.push(`${p}: targetModel ${m[1]}`);
  });
  for (const d of ['controllers', 'services', 'routes', 'middleware']) walk(path.join(__dirname, '..', d));
  expect(missing).toEqual([]);
});
