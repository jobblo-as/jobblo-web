// The demo seed (seeds/users, jobs, activity, reference .seed.js) as the brief asks for it, and nothing in it that must
// not be in the repo.
const fs = require('fs');
const path = require('path');
const { EJSON } = require('mongoose').mongo.BSON;
const { shiftDates } = require('../seeds/load');

const DATA = path.join(__dirname, '..', 'seeds', 'data');
const load = (name) => EJSON.parse(fs.readFileSync(path.join(DATA, `${name}.json`), 'utf8'));
const ids = (docs) => new Set(docs.map((d) => String(d._id)));

const users = load('users');
const services = load('services');

test('20 users: 8 customers, 8 helpers, 4 businesses, on @jobblo.no', () => {
  expect(users).toHaveLength(20);
  const by = (re) => users.filter((u) => re.test(u.email)).length;
  expect(by(/^customer\d@jobblo\.no$/)).toBe(8);
  expect(by(/^helper\d@jobblo\.no$/)).toBe(8);
  expect(users.filter((u) => u.role === 'company')).toHaveLength(4);
});

test('50 jobs over the 9 categories, most in Oslo, by seeded users', () => {
  expect(services).toHaveLength(50);
  const cats = new Set(load('categories').map((c) => c.name));
  expect(cats.size).toBe(9);
  for (const s of services) expect(cats.has(s.categories[0])).toBe(true);
  const oslo = services.filter((s) => s.location.city === 'Oslo').length;
  expect(oslo).toBeGreaterThan(services.length / 2);
  const userIds = ids(users);
  for (const s of services) expect(userIds.has(String(s.userId))).toBe(true);
});

test('orders, reviews and applications point at seeded jobs and users', () => {
  const serviceIds = ids(services);
  const userIds = ids(users);
  for (const o of load('orders')) expect(serviceIds.has(String(o.serviceId))).toBe(true);
  for (const r of load('reviews')) expect(userIds.has(String(r.revieweeId))).toBe(true);
  for (const j of load('jobrequests')) expect(serviceIds.has(String(j.serviceId))).toBe(true);
  expect(load('orders').filter((o) => o.status === 'completed')).toHaveLength(5);
});

test('no secrets: no MFA secrets, reset tokens or Stripe keys', () => {
  const text = fs
    .readdirSync(DATA)
    .map((f) => fs.readFileSync(path.join(DATA, f), 'utf8'))
    .join();
  for (const bad of ['mfaSecret', 'passwordResetToken', 'sk_live_', 'sk_test_', 'whsec_'])
    expect(text).not.toContain(bad);
});

test('dates move forward by the given time, ids do not', () => {
  const doc = { _id: services[0]._id, at: new Date('2026-11-04T00:00:00Z'), list: [new Date(0)] };
  shiftDates(doc, 1000);
  expect(doc.at.toISOString()).toBe('2026-11-04T00:00:01.000Z');
  expect(doc.list[0].getTime()).toBe(1000);
  expect(String(doc._id)).toBe(String(services[0]._id));
});

test('the 9 categories from the brief, each with an icon and its own place in the order', () => {
  const cats = load('categories');
  expect(cats.map((c) => c.name).sort()).toEqual(
    [
      'Bil & Pleie',
      'Flytting',
      'Hagearbeid',
      'Maling',
      'Oppussing',
      'Rengjøring',
      'Rørlegger',
      'Småjobber',
      'Transport',
    ].sort()
  );
  for (const c of cats) expect(c.icon).toBeTruthy();
  expect(new Set(cats.map((c) => c.sortOrder)).size).toBe(cats.length);
});

test('one super admin, apart from the 20 test users, with a bcrypt password', () => {
  const [admin, ...rest] = load('admin');
  expect(rest).toHaveLength(0);
  expect(admin).toMatchObject({ email: 'admin@jobblo.no', role: 'superAdmin' });
  expect(admin.password).toMatch(/^\$2[aby]\$12\$/);
  expect(users.some((u) => u.email === admin.email || String(u._id) === String(admin._id))).toBe(
    false
  );
});
