/**
 * Tor exit nodes, from the Tor Project's public bulk list (no key, no personal data sent: the
 * list is downloaded, and lookups happen here). Refreshed at most hourly; a failed download keeps
 * the last good list. Answers null (unknown) until a list has loaded once.
 */
const axios = require('axios');

const URL = 'https://check.torproject.org/torbulkexitlist';
const REFRESH_MS = 60 * 60 * 1000;

let list = null;
let fetchedAt = 0;
let loading = null;

async function refresh({ get = axios.get } = {}) {
  if (loading) return loading;
  loading = (async () => {
    try {
      const { data } = await get(URL, { timeout: 5000, responseType: 'text' });
      const ips = String(data)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
      if (ips.length) list = new Set(ips);
    } catch (err) {
      console.error('[ip-intel] Tor exit list download failed:', err.code || err.message);
    } finally {
      fetchedAt = Date.now(); // also after a failure: do not hammer the server
      loading = null;
    }
  })();
  return loading;
}

module.exports = {
  name: 'tor-exit-list',
  /** { tor: true|false } or null when no list is available. */
  async lookup(ip, opts = {}) {
    if (Date.now() - fetchedAt > REFRESH_MS) await refresh(opts);
    if (!list) return null;
    return { tor: list.has(ip) };
  },
  _reset() {
    list = null;
    fetchedAt = 0;
    loading = null;
  },
};
