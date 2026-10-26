/**
 * Throughput benchmark for the hot read paths (autocannon). LOCAL ONLY: refuses non-loopback URLs.
 *
 *   npm i --no-save autocannon@8            (or: NODE_PATH=<dir with autocannon> node ...)
 *   node scripts/loadtest/run.js --url http://127.0.0.1:5101 --seconds 10 --connections 100
 *   node scripts/loadtest/run.js --only services,detail --json out.json
 *
 * Each request carries a random X-Forwarded-For from a 10.77.0.0/16 pool (trusted from loopback,
 * see app.js `trust proxy`), so the per-IP api limiter sees many clients like real traffic
 * instead of 429-ing one. The authenticated case mints a short-lived Session for an ordinary
 * local user (dev DB only) and deletes it afterwards; rate-limit keys for the pool are deleted too.
 *
 * Prints one row per endpoint: rps, p50/p99 latency (ms), non-2xx and socket errors.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), quiet: true });
const autocannon = require('autocannon');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : acc), [])
);
const BASE = (args.url || 'http://127.0.0.1:5101').replace(/\/$/, '');
const SECONDS = Number(args.seconds || 10);
const CONNECTIONS = Number(args.connections || 100);
const ONLY = args.only ? args.only.split(',') : null;

if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(BASE).hostname)) {
  console.error('Refusing to load-test a non-local host:', BASE);
  process.exit(2);
}

const randomIp = () => `10.77.${(Math.random() * 256) | 0}.${(Math.random() * 256) | 0}`;

async function mintSession() {
  const mongoose = require('mongoose');
  const uri = process.env.MONGO_URI || '';
  if (process.env.NODE_ENV === 'production' || !/127\.0\.0\.1|localhost/.test(uri)) throw new Error('token minting needs a local dev MONGO_URI');
  await mongoose.connect(uri);
  const User = require('../../models/User');
  const Session = require('../../models/Session');
  const { generateTokens } = require('../../utils/tokenUtils');
  const user = await User.findOne({ role: 'user', isDeleted: { $ne: true }, accountStatus: { $nin: ['inactive', 'deactivated'] } }).select('_id').lean();
  if (!user) throw new Error('no ordinary user in the local DB');
  const s = await Session.create({ userId: user._id, refreshToken: 'loadtest', ip: '127.0.0.1', userAgent: 'loadtest', device: 'loadtest', deviceName: 'loadtest', browser: 'loadtest', os: 'loadtest', location: 'local', expiresAt: new Date(Date.now() + 30 * 60 * 1000) });
  const { accessToken } = generateTokens(String(user._id), String(s._id));
  return { token: accessToken, cleanup: async () => (await Session.deleteOne({ _id: s._id, deviceName: 'loadtest' }), mongoose.disconnect()) };
}

async function cleanupRateLimitKeys() {
  if (!process.env.REDIS_URL) return 0;
  const Redis = require('ioredis');
  const r = new Redis(process.env.REDIS_URL);
  let n = 0;
  for await (const keys of r.scanStream({ match: `${process.env.REDIS_PREFIX || 'jobblo'}:rl:*10.77.*`, count: 1000 })) if (keys.length) n += await r.unlink(...keys);
  r.disconnect();
  return n;
}

function bench(name, path, headers = {}) {
  return new Promise((resolve, reject) => {
    autocannon(
      {
        url: BASE,
        connections: CONNECTIONS,
        duration: SECONDS,
        requests: [{ method: 'GET', path, setupRequest: (req) => ({ ...req, headers: { ...req.headers, ...headers, 'x-forwarded-for': randomIp() } }) }],
      },
      (err, r) => (err ? reject(err) : resolve({ name, path, rps: Math.round(r.requests.average), p50: r.latency.p50, p99: r.latency.p99, non2xx: r.non2xx, errors: r.errors + r.timeouts, kbPerReq: r.requests.total ? Math.round(r.throughput.total / r.requests.total / 102.4) / 10 : 0 }))
    );
  });
}

(async () => {
  const get = (p) => fetch(BASE + p, { headers: { 'x-forwarded-for': randomIp() } }).then((r) => r.json());
  const list = await get('/api/services?limit=1');
  const listingId = list.data?.[0]?._id;
  const cats = await get('/api/categories');
  const catName = Array.isArray(cats) && cats[0]?.name;
  const auth = !ONLY || ONLY.includes('usersTop') ? await mintSession() : null;

  const cases = [
    ['services', '/api/services?page=1&limit=25'],
    ['servicesCat', `/api/services?category=${encodeURIComponent(catName || 'x')}&page=1&limit=25`],
    ['categories', '/api/categories'],
    ['filterOptions', '/api/filter/options'],
    ['detail', `/api/services/${listingId}`],
    ['usersTop', '/api/users/top?limit=10', auth && { authorization: `Bearer ${auth.token}` }],
  ].filter(([n]) => !ONLY || ONLY.includes(n));

  const rows = [];
  try {
    for (const [name, path, headers] of cases) rows.push(await bench(name, path, headers || {}));
  } finally {
    if (auth) await auth.cleanup();
    console.error(`cleaned ${await cleanupRateLimitKeys()} rate-limit keys`);
  }
  console.table(rows.map(({ path, ...r }) => r));
  if (args.json) require('fs').writeFileSync(args.json, JSON.stringify(rows, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
