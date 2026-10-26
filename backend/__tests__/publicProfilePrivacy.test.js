/**
 * C3: what one user may see of another. The public projection is its own allow-list, search
 * never matches or returns email, and search text is matched literally.
 */
const { PUBLIC_FIELDS, PUBLIC_USER_SELECT, sanitizeUserPublic, sanitizeUserOwner } = require('../utils/userProjections');

const PRIVATE = ['email', 'phone', 'address', 'addresses', 'postNumber', 'birthDate', 'gender', 'earnings', 'totalEarned', 'totalSpent', 'coins', 'lastLogin', 'googleId', 'stripeConnectAccountId', 'settings', 'notificationPreferences', 'accountStatus', 'subscriptionStatus', 'monthlyContactUsage', 'password', 'iban', 'bankAccountNumber'];

const fullUser = () => ({
  _id: 'u1',
  name: 'Kari',
  bio: 'Maler',
  postSted: 'Oslo',
  identityVerification: { provider: 'idura', subject: 'sub-1', verifiedAt: new Date('2026-01-01') },
  ...Object.fromEntries(PRIVATE.map((k) => [k, `secret-${k}`])),
});

describe('public user projection', () => {
  it('selects no private field from the database', () => {
    for (const k of PRIVATE) expect(PUBLIC_USER_SELECT.split(' ')).not.toContain(k);
  });

  it('strips every private field from a response, even if a query selected it', () => {
    const out = sanitizeUserPublic(fullUser());
    for (const k of PRIVATE) expect(out).not.toHaveProperty(k);
    expect(out).toMatchObject({ _id: 'u1', name: 'Kari', bio: 'Maler', postSted: 'Oslo', identityVerified: true });
    expect(out).not.toHaveProperty('identityVerification');
  });

  it('keeps per-response stats the profile page shows', () => {
    const out = sanitizeUserPublic({ ...fullUser(), averageResponseTimeMinutes: 12, totalJobRequests: 3, reviews: [] });
    expect(out).toMatchObject({ averageResponseTimeMinutes: 12, totalJobRequests: 3, reviews: [] });
  });

  it('every public field is a deliberate choice (update this list on purpose)', () => {
    expect(PUBLIC_FIELDS).toMatchSnapshot();
  });

  it('the owner still sees their own email, phone and address', () => {
    const out = sanitizeUserOwner(fullUser());
    expect(out).toMatchObject({ email: 'secret-email', phone: 'secret-phone', address: 'secret-address' });
    expect(out).not.toHaveProperty('password');
  });
});

describe('user search', () => {
  jest.resetModules();
  const filters = [];
  const chain = { select: () => chain, limit: () => Promise.resolve([{ _id: 'u2', name: 'Ola', email: 'ola@example.test', address: 'Gate 1' }]) };
  jest.doMock('../models/User', () => ({ find: (f) => (filters.push(f), chain) }));
  const { searchUsers } = require('../controllers/users/searchController');
  const run = async (q) => {
    const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await searchUsers({ query: { q }, userId: 'me' }, res);
    return res;
  };

  it('never matches on email and never returns it', async () => {
    const res = await run('ola@example');
    const fields = filters.at(-1).$or.map((c) => Object.keys(c)[0]);
    expect(fields).not.toContain('email');
    expect(res.body[0]).not.toHaveProperty('email');
    expect(res.body[0]).not.toHaveProperty('address');
  });

  it('treats regex characters literally (no ReDoS, no 500 on "(")', async () => {
    expect((await run('(a+)+$')).code).toBe(200);
    expect(filters.at(-1).$or[0].name.$regex).toBe('\\(a\\+\\)\\+\\$');
    expect((await run('(')).code).toBe(200);
  });

  it('ignores non-string input (?q[]=a&q[]=b)', async () => {
    const res = await run(['ab', 'cd']);
    expect(res.body).toEqual([]);
  });
});
