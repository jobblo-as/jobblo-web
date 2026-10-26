/**
 * pm2 (developer console → PM2): the processes pm2 manages on this host, from `pm2 jlist`.
 * jlist includes every process's full environment (all secrets from .env), so only the fields
 * below are kept — never pass `pm2_env` through. Error-log tails are redacted.
 * PM2_BIN overrides the binary; pm2 must run as the same user (same PM2_HOME) as the API.
 */
const fs = require('fs');
const { execFile } = require('child_process');
const { redactText } = require('../../utils/sanitizer');

const LOG_TAIL_BYTES = 16 * 1024;
const LOG_LINES = 40;
const bin = () => process.env.PM2_BIN || (process.platform === 'win32' ? 'pm2.cmd' : 'pm2');

/** Pure: a log line safe to show — redactText (emails, numbers) plus tokens, keys and URL secrets. */
const scrub = (line) =>
  redactText(line)
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[JWT]')
    .replace(/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/\b(sk|rk|pk|whsec)_(live|test)_\w+/g, '$1_$2_[REDACTED]')
    .replace(/(\w+:\/\/)[^\s/@:]+:[^\s/@]+@/g, '$1[REDACTED]@')
    .replace(/\b(password|passwd|secret|token|apikey|api_key|authorization)(["'\s:=]+)[^\s"',}]+/gi, '$1$2[REDACTED]');

/** Pure: the safe view of one `pm2 jlist` entry. */
function pm2Process(p, now = Date.now()) {
  const e = p.pm2_env || {};
  return {
    id: p.pm_id,
    name: p.name,
    pid: p.pid || null,
    status: e.status || 'unknown',
    mode: e.exec_mode === 'cluster_mode' ? 'cluster' : 'fork',
    instances: e.instances ?? 1,
    restarts: e.restart_time ?? 0,
    unstableRestarts: e.unstable_restarts ?? 0,
    uptimeSec: e.status === 'online' && e.pm_uptime ? Math.round((now - e.pm_uptime) / 1000) : 0,
    cpuPercent: p.monit?.cpu ?? null,
    memoryBytes: p.monit?.memory ?? null,
    node: e.node_version || null,
    appVersion: e.version || null,
    killTimeoutMs: e.kill_timeout ?? null,
    webConcurrency: e.env?.WEB_CONCURRENCY ?? e.WEB_CONCURRENCY ?? null,
    nodeEnv: e.env?.NODE_ENV ?? e.NODE_ENV ?? null,
    createdAt: e.created_at ? new Date(e.created_at) : null,
    errLog: e.pm_err_log_path || null,
  };
}

async function tail(file) {
  if (!file) return [];
  try {
    const { size } = await fs.promises.stat(file);
    const fh = await fs.promises.open(file, 'r');
    const start = Math.max(0, size - LOG_TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    await fh.close();
    return buf.toString('utf8').split(/\r?\n/).filter(Boolean).slice(-LOG_LINES).map((l) => scrub(l).slice(0, 400));
  } catch {
    return [];
  }
}

async function pm2Overview() {
  // pm2 on Windows is a .cmd shim, which only cmd.exe can run; the arguments are fixed.
  const [file, args] = process.platform === 'win32' ? ['cmd.exe', ['/d', '/c', bin(), 'jlist']] : [bin(), ['jlist']];
  const { err, out } = await new Promise((resolve) =>
    execFile(file, args, { timeout: 5000, windowsHide: true, maxBuffer: 20 * 1024 * 1024 }, (e, stdout) => resolve({ err: e, out: stdout }))
  );
  if (err) return { available: false, reason: err.code === 'ENOENT' || /not recognized|not found/i.test(err.message) ? 'pm2 is not installed on this host (or not on PATH for the API user).' : `pm2 jlist failed: ${err.message.slice(0, 200)}` };
  let list;
  try {
    list = JSON.parse(out.slice(out.indexOf('[')));
  } catch {
    return { available: false, reason: 'pm2 jlist returned no JSON (run `pm2 jlist` as the API user to check).' };
  }
  const processes = list.map((p) => pm2Process(p));
  const self = processes.find((p) => p.pid === process.pid || p.pid === process.ppid) || null;
  const withLogs = await Promise.all(processes.map(async (p) => ({ ...p, errLogTail: await tail(p.errLog), errLog: undefined })));
  return { available: true, processes: withLogs, self: self ? self.name : null };
}

module.exports = { pm2Overview, pm2Process, scrub };
