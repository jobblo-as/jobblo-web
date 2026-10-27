/**
 * nginx (developer console → Nginx). Everything is read-only and optional — each part reports
 * "not available" with the reason instead of failing the page:
 *   - stub_status    NGINX_STATUS_URL (default http://127.0.0.1:8090/nginx_status; the
 *                    loopback-only server in deploy/nginx/jobblo-http.conf)
 *   - access log     NGINX_ACCESS_LOG (default /var/log/nginx/jobblo.json.log), one JSON object
 *                    per line (log_format jobblo_json): cache status, status code, timings, path
 *                    without query string. Only the tail (LOG_TAIL_BYTES) is read.
 *   - processes      master/workers from /proc (Linux) or tasklist (Windows)
 *   - cache folder   NGINX_CACHE_DIR (default /var/cache/nginx/jobblo): files and bytes
 *   - version        `nginx -v` (NGINX_BIN, default "nginx")
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const STATUS_URL = () => process.env.NGINX_STATUS_URL || 'http://127.0.0.1:8090/nginx_status';
const ACCESS_LOG = () => process.env.NGINX_ACCESS_LOG || '/var/log/nginx/jobblo.json.log';
const CACHE_DIR = () => process.env.NGINX_CACHE_DIR || '/var/cache/nginx/jobblo';
const NGINX_BIN = () => process.env.NGINX_BIN || 'nginx';
const LOG_TAIL_BYTES = 4 * 1024 * 1024;
const MAX_CACHE_FILES = 50_000;

const run = (file, args, timeout = 4000) =>
  new Promise((resolve) =>
    execFile(file, args, { timeout, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ err, out: `${stdout}${stderr}` })
    )
  );

/** Pure: parse the stub_status page. */
function parseStubStatus(text) {
  const active = /Active connections:\s*(\d+)/.exec(text);
  const totals = /\n\s*(\d+)\s+(\d+)\s+(\d+)\s*\n/.exec(text);
  const rw = /Reading:\s*(\d+)\s+Writing:\s*(\d+)\s+Waiting:\s*(\d+)/.exec(text);
  if (!active || !totals || !rw) return null;
  return {
    active: Number(active[1]),
    accepts: Number(totals[1]),
    handled: Number(totals[2]),
    requests: Number(totals[3]),
    dropped: Number(totals[1]) - Number(totals[2]),
    reading: Number(rw[1]),
    writing: Number(rw[2]),
    waiting: Number(rw[3]),
  };
}

async function stubStatus() {
  try {
    const res = await fetch(STATUS_URL(), { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { available: false, reason: `${STATUS_URL()} answered HTTP ${res.status}` };
    const parsed = parseStubStatus(await res.text());
    return parsed
      ? { available: true, ...parsed }
      : { available: false, reason: 'Unexpected stub_status format' };
  } catch (e) {
    return {
      available: false,
      reason: `${STATUS_URL()} not reachable (${e.cause?.code || e.message}). Install deploy/nginx/jobblo-http.conf.`,
    };
  }
}

const pct = (part, total) => (total ? Math.round((part / total) * 1000) / 10 : null);
const percentile = (sorted, p) =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
    : null;

/** Pure: summarize jobblo_json log lines (newest last). Unparseable lines are counted, not thrown. */
function summarizeAccessLog(lines, now = Date.now()) {
  const rows = [];
  let bad = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      rows.push({
        t: Date.parse(r.t),
        s: Number(r.s),
        rt: Number(r.rt),
        ut: parseFloat(r.ut),
        c: r.c || '',
        u: String(r.u || ''),
        m: r.m,
      });
    } catch {
      bad += 1;
    }
  }
  const lastMin = rows.filter((r) => r.t >= now - 60_000);
  const api = rows.filter((r) => r.u.startsWith('/api/'));
  const cache = {};
  for (const r of api) cache[r.c || 'none'] = (cache[r.c || 'none'] || 0) + 1;
  const served = (cache.HIT || 0) + (cache.STALE || 0) + (cache.UPDATING || 0);
  const cacheable = served + (cache.MISS || 0) + (cache.EXPIRED || 0);
  const statuses = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
  for (const r of rows) if (r.s >= 200 && r.s < 600) statuses[`${Math.floor(r.s / 100)}xx`] += 1;
  const byPath = new Map();
  for (const r of api) {
    const key = r.u.replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:id');
    const e = byPath.get(key) || { path: key, n: 0, hit: 0, ms: [] };
    e.n += 1;
    if (r.c === 'HIT' || r.c === 'STALE' || r.c === 'UPDATING') e.hit += 1;
    if (Number.isFinite(r.rt)) e.ms.push(r.rt * 1000);
    byPath.set(key, e);
  }
  const upstream = api
    .map((r) => r.ut * 1000)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const total = rows
    .map((r) => r.rt * 1000)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return {
    lines: rows.length,
    unparsed: bad,
    from: rows.length ? new Date(rows[0].t) : null,
    to: rows.length ? new Date(rows.at(-1).t) : null,
    rpsLastMin: Math.round((lastMin.length / 60) * 10) / 10,
    statuses,
    cache,
    cacheHitRate: pct(served, cacheable),
    requestP95Ms: percentile(total, 95),
    upstreamP95Ms: percentile(upstream, 95),
    topPaths: [...byPath.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, 12)
      .map((e) => ({
        path: e.path,
        requests: e.n,
        hitRate: pct(e.hit, e.n),
        p95Ms: percentile(
          e.ms.sort((a, b) => a - b),
          95
        ),
      })),
  };
}

async function accessLog() {
  const file = ACCESS_LOG();
  try {
    const { size } = await fs.promises.stat(file);
    const fh = await fs.promises.open(file, 'r');
    const start = Math.max(0, size - LOG_TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    await fh.close();
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift(); // first line is cut in half
    return { available: true, file, sizeBytes: size, ...summarizeAccessLog(lines) };
  } catch (e) {
    return {
      available: false,
      reason: `${file}: ${e.code || e.message}. Add the jobblo_json access_log from deploy/nginx/jobblo-server.conf and make the file readable by the API user (e.g. group adm).`,
    };
  }
}

/** nginx master/worker processes. */
async function processes() {
  if (process.platform === 'linux') {
    try {
      const list = [];
      for (const pid of await fs.promises.readdir('/proc')) {
        if (!/^\d+$/.test(pid)) continue;
        const status = await fs.promises.readFile(`/proc/${pid}/status`, 'utf8').catch(() => '');
        if (!/^Name:\s*nginx\s*$/m.test(status)) continue;
        const cmd = (await fs.promises.readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => ''))
          .replace(/\0/g, ' ')
          .trim();
        list.push({
          pid: Number(pid),
          ppid: Number(/^PPid:\s*(\d+)/m.exec(status)?.[1]),
          role: /master/.test(cmd)
            ? 'master'
            : /cache manager|cache loader/.test(cmd)
              ? 'cache'
              : 'worker',
          rssBytes: Number(/^VmRSS:\s*(\d+)/m.exec(status)?.[1] || 0) * 1024,
          command: cmd.slice(0, 120),
        });
      }
      return { available: true, list };
    } catch (e) {
      return { available: false, reason: e.message, list: [] };
    }
  }
  if (process.platform === 'win32') {
    const { err, out } = await run(
      'tasklist',
      ['/FI', 'IMAGENAME eq nginx.exe', '/FO', 'CSV', '/NH'],
      20_000
    ); // tasklist is slow
    if (err) return { available: false, reason: err.message, list: [] };
    const list = out
      .split(/\r?\n/)
      .filter((l) => l.startsWith('"nginx.exe"'))
      .map((l) => l.split('","').map((c) => c.replace(/"/g, '')))
      .map((c) => ({
        pid: Number(c[1]),
        ppid: null,
        role: 'process',
        rssBytes: Number(c[4].replace(/[^\d]/g, '')) * 1024,
        command: 'nginx.exe',
      }));
    return { available: true, list };
  }
  return { available: false, reason: `Not supported on ${process.platform}`, list: [] };
}

async function cacheDir() {
  const dir = CACHE_DIR();
  let files = 0;
  let bytes = 0;
  let truncated = false;
  const walk = async (d) => {
    for (const e of await fs.promises.readdir(d, { withFileTypes: true })) {
      if (files >= MAX_CACHE_FILES) return void (truncated = true);
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) {
        files += 1;
        bytes += (await fs.promises.stat(p).catch(() => ({ size: 0 }))).size;
      }
    }
  };
  try {
    await walk(dir);
    return { available: true, dir, files, bytes, truncated };
  } catch (e) {
    return {
      available: false,
      dir,
      reason: `${e.code || e.message} (the API user may not be allowed to read it)`,
    };
  }
}

async function version() {
  const { err, out } = await run(NGINX_BIN(), ['-v']);
  const v = /nginx\/(\S+)/.exec(out);
  return v ? v[1] : err ? null : out.trim() || null;
}

async function nginxOverview() {
  const [status, log, procs, cache, ver] = await Promise.all([
    stubStatus(),
    accessLog(),
    processes(),
    cacheDir(),
    version(),
  ]);
  return {
    version: ver,
    status,
    accessLog: log,
    processes: procs,
    cacheDir: cache,
    config: { statusUrl: STATUS_URL(), accessLog: ACCESS_LOG(), cacheDir: CACHE_DIR() },
  };
}

module.exports = { nginxOverview, accessLog, parseStubStatus, summarizeAccessLog };
