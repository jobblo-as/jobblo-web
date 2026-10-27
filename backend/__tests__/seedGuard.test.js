/**
 * H5: seed scripts wipe collections, so they must never run with NODE_ENV=production and
 * must be confirmed by naming the database. The child-process cases run real seed entry
 * points against an unroutable address: if the guard were missing they would try to connect.
 */
const path = require('path');
const { spawnSync } = require('child_process');
const { assertSafeToSeed, describeTarget } = require('../seeds/guard');

const URI = 'mongodb://seeduser:hunter2@10.255.255.1:27017/jobblo-dev?authSource=admin';

describe('assertSafeToSeed', () => {
  it('describes the target without credentials', () => {
    expect(describeTarget(URI)).toEqual({ host: '10.255.255.1:27017', db: 'jobblo-dev' });
    expect(describeTarget('mongodb+srv://u:p@cluster0.example.net/prod')).toEqual({
      host: 'cluster0.example.net',
      db: 'prod',
    });
  });

  it('refuses production, even with the confirmation flag', () => {
    expect(() =>
      assertSafeToSeed({
        uri: URI,
        env: { NODE_ENV: 'production' },
        argv: ['--yes-wipe=jobblo-dev'],
      })
    ).toThrow(/NODE_ENV=production/);
  });

  it('refuses without confirmation or with the wrong database name', () => {
    expect(() => assertSafeToSeed({ uri: URI, env: {}, argv: [] })).toThrow(
      /--yes-wipe=jobblo-dev/
    );
    expect(() => assertSafeToSeed({ uri: URI, env: {}, argv: ['--yes-wipe=other'] })).toThrow(
      /--yes-wipe=jobblo-dev/
    );
  });

  it('allows a confirmed non-production run and never echoes the password', () => {
    const target = assertSafeToSeed({
      uri: URI,
      env: { NODE_ENV: 'development' },
      argv: ['--yes-wipe=jobblo-dev'],
    });
    expect(target).toBe('10.255.255.1:27017/jobblo-dev');
    expect(target).not.toMatch(/hunter2|seeduser/);
  });

  it('refuses a missing or invalid MONGO_URI', () => {
    expect(() => assertSafeToSeed({ uri: '', env: {}, argv: [] })).toThrow(/MONGO_URI/);
  });
});

describe('seed entry points stop before connecting', () => {
  const run = (script, env, args = []) =>
    spawnSync(process.execPath, [path.join(__dirname, '..', script), ...args], {
      env: { ...process.env, MONGO_URI: URI, ...env },
      encoding: 'utf8',
      timeout: 15000,
    });

  it.each(['seeds/index.js', 'seeds/run-plan.js'])('%s refuses on production', (script) => {
    const r = run(script, { NODE_ENV: 'production' }, ['--yes-wipe=jobblo-dev']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NODE_ENV=production/);
    expect(r.stdout + r.stderr).not.toMatch(/hunter2/);
  });

  it('refuses without --yes-wipe outside production', () => {
    const r = run('seeds/run-plan.js', { NODE_ENV: 'development' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--yes-wipe=jobblo-dev/);
  });
});
