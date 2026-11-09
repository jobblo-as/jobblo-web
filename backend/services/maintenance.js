/**
 * Maintenance mode: the whole site, or one area at a time (payments, a sign-in method, BankID,
 * posting jobs, …), while the rest keeps working.
 *
 * Stored in GlobalConfig `maintenance_mode`:
 *   { enabled, message, areas: { <areaKey>: { enabled, message } } }
 * Set from the admin dashboard (/dashboard/maintenance), read here with a 10 s cache.
 *
 * An area answers its own requests 503 { code: 'MAINTENANCE', area, message }. The whole site
 * answers every API request 503 except staff (superAdmin / developer, signed in), sign-in, the
 * admin and developer APIs and the public status. Stripe webhooks are mounted before this guard
 * and are never blocked — a payment that completes during maintenance is still recorded.
 */
const CONFIG_KEY = 'maintenance_mode';
const CACHE_MS = 10_000;
const STAFF = ['superAdmin', 'developer'];
const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The areas a Super Admin can switch off one by one. `writesOnly`: reading stays open. */
const AREAS = [
  {
    key: 'payments',
    label: 'Betalinger (Stripe)',
    description: 'Abonnement, Hast, SafePay-betaling og godkjenning. Visning fungerer.',
    writesOnly: true,
    match: (p) =>
      /^\/api\/stripe\/(v2\/)?(create-checkout-session|subscription|create-urgent-payment)/.test(
        p
      ) || /^\/api\/safepay-checkout\/(create-session|approve)/.test(p),
  },
  {
    key: 'payouts',
    label: 'Utbetalinger (Stripe Connect)',
    description: 'Opprette og koble bankkonto for utbetaling.',
    writesOnly: true,
    match: (p) => /^\/api\/connect\//.test(p),
  },
  {
    key: 'login_password',
    label: 'Innlogging med e-post og passord',
    description: 'Innlogging, glemt passord og engangskoder.',
    match: (p) => /^\/api\/auth\/(login|forgot-password|verify-otp|reset-password)$/.test(p),
  },
  {
    key: 'registration',
    label: 'Registrering',
    description: 'Nye kontoer og e-postbekreftelse.',
    match: (p) =>
      /^\/api\/auth\/(register|email\/send-code|email\/verify|verify-email|resend-verification)$/.test(
        p
      ),
  },
  {
    key: 'login_google',
    label: 'Google-innlogging',
    match: (p) => /^\/api\/auth\/((web|mobile)\/)?google(\/callback)?$/.test(p),
  },
  {
    key: 'login_apple',
    label: 'Apple-innlogging',
    match: (p) => /^\/api\/auth\/((web|mobile)\/apple|apple\/native)$/.test(p),
  },
  {
    key: 'login_vipps',
    label: 'Vipps-innlogging',
    match: (p) => /^\/api\/auth\/((web|mobile)\/)?vipps(\/callback)?$/.test(p),
  },
  {
    key: 'bankid',
    label: 'BankID-verifisering',
    description: 'Identitetsbekreftelse med BankID (Idura).',
    match: (p) => /^\/api\/auth\/idura(\/callback)?$/.test(p),
  },
  {
    key: 'job_posting',
    label: 'Legge ut og endre oppdrag',
    description: 'Nye oppdrag, endringer og utkast. Søk og visning fungerer.',
    writesOnly: true,
    match: (p) => /^\/api\/(services|job-drafts)(\/|$)/.test(p),
  },
  {
    key: 'messaging',
    label: 'Meldinger',
    description: 'Sende meldinger. Lese gamle meldinger fungerer.',
    writesOnly: true,
    match: (p) => /^\/api\/(messages|chats)(\/|$)/.test(p),
  },
  {
    key: 'ai',
    label: 'AI-hjelp',
    description: 'AI-utfylling av oppdrag og forslag.',
    match: (p) => /^\/api\/ai(\/|$)/.test(p),
  },
];

/** Always reachable, even with the whole site off: staff tools, sign-in, the status itself. */
const ALWAYS_OPEN =
  /^\/api\/(admin|developer|maintenance|errors|rum|docs)(\/|$)|^\/api\/auth\/(login|logout|refresh-token|profile|mfa(\/.*)?)$/;

const DEFAULT_MESSAGE = 'Vi utfører vedlikehold. Prøv igjen om litt.';

/** Pure: whatever is stored → a clean state (unknown areas dropped, messages capped). */
function normalize(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const areas = {};
  for (const a of AREAS) {
    const r = v.areas?.[a.key];
    if (r && typeof r === 'object')
      areas[a.key] = {
        enabled: r.enabled === true,
        message: typeof r.message === 'string' ? r.message.slice(0, 300) : '',
      };
  }
  return {
    enabled: v.enabled === true,
    message: typeof v.message === 'string' ? v.message.slice(0, 500) : '',
    areas,
  };
}

let cached = null;
let cachedAt = 0;
async function getState({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cachedAt < CACHE_MS) return cached;
  // Not connected: Mongoose would buffer the query for 10 s on every request (seen in CI and
  // before the DB is up). Keep the last known state, or "open", and never wait for the DB.
  if (!module.exports.dbReady()) return cached || normalize(null);
  try {
    const doc = await require('../models/GlobalConfig').findOne({ key: CONFIG_KEY }).lean();
    cached = normalize(doc?.value);
  } catch {
    cached = cached || normalize(null); // DB trouble: keep the last state, never block on it
  }
  cachedAt = Date.now();
  return cached;
}
const invalidate = () => {
  cached = null;
};

/** Pure: which switched-off area this request falls in, if any. */
function blockedArea(state, method, path) {
  for (const a of AREAS) {
    if (!state.areas[a.key]?.enabled) continue;
    if (a.writesOnly && !WRITE.has(method)) continue;
    if (a.match(path)) return a;
  }
  return null;
}

/** Staff pass the whole-site switch (cached per user for a minute; runs only while it is on). */
const roles = new Map();
async function isStaff(req) {
  const header = req.headers?.authorization || '';
  const token =
    (header.startsWith('Bearer ') && header.slice(7).trim()) ||
    req.cookies?.accessToken ||
    req.cookies?.token;
  if (!token) return false;
  try {
    const { id } = require('../utils/tokenUtils').verifyToken(token, 'access');
    const hit = roles.get(id);
    if (hit && Date.now() - hit.at < 60_000) return STAFF.includes(hit.role);
    const user = await require('../models/User').findById(id).select('role').lean();
    if (roles.size > 5000) roles.clear();
    roles.set(id, { role: user?.role, at: Date.now() });
    return STAFF.includes(user?.role);
  } catch {
    return false;
  }
}

const refuse = (res, area, message) =>
  res.status(503).json({
    success: false,
    code: 'MAINTENANCE',
    area,
    message: message || DEFAULT_MESSAGE,
  });

async function maintenanceGuard(req, res, next) {
  const path = String(req.originalUrl || req.url || '').split('?')[0];
  if (!path.startsWith('/api/') || /^\/api\/(admin|developer|maintenance)(\/|$)/.test(path))
    return next();
  try {
    const state = await getState();
    const area = blockedArea(state, req.method, path);
    if (area) return refuse(res, area.key, state.areas[area.key].message);
    if (state.enabled && !ALWAYS_OPEN.test(path) && !(await isStaff(req)))
      return refuse(res, 'site', state.message);
  } catch {
    /* never block on an error of our own */
  }
  return next();
}

/** For the public status endpoint: what is off, with its message (no internals). */
async function publicStatus() {
  const s = await getState();
  return {
    enabled: s.enabled,
    message: s.enabled ? s.message || DEFAULT_MESSAGE : '',
    areas: AREAS.filter((a) => s.areas[a.key]?.enabled).map((a) => ({
      key: a.key,
      label: a.label,
      message: s.areas[a.key].message || DEFAULT_MESSAGE,
    })),
  };
}

module.exports = {
  CONFIG_KEY,
  AREAS,
  DEFAULT_MESSAGE,
  normalize,
  blockedArea,
  getState,
  invalidate,
  maintenanceGuard,
  publicStatus,
  /** Mongoose connected? (a function so tests can stub it) */
  dbReady: () => require('mongoose').connection.readyState === 1,
  _clear: () => {
    invalidate();
    roles.clear();
  },
};
