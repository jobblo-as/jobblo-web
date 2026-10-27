const redis = require('../config/redis');

/**
 * Listing view counts, buffered: count() is a Redis HINCRBY (or an in-process map when Redis is
 * off or failing), flush() drains the buffer into ONE Service.bulkWrite of $inc's. A popular
 * listing used to cost one MongoDB write per counted view, all queued on that one document.
 *
 * The Redis drain is HGETALL+DEL in one MULTI, so several workers flushing at once split the
 * counts instead of double-counting them; that is why every worker runs the flush (it also
 * drains its own memory fallback). A failed bulkWrite puts the counts back.
 * ponytail: views lag MongoDB by up to FLUSH_MS, and memory-buffered counts are lost if the
 * process dies before its next flush; a bulkWrite that fails after partly applying re-adds
 * every count, so it can over-count once. Use per-op results if that ever matters.
 */
const FLUSH_MS = 15 * 1000;
const KEY = () => `${redis.PREFIX}:views:pending`;
const pending = new Map(); // id → count (memory fallback)

const live = () => {
  const c = redis.getRedis();
  return c && c.status === 'ready' ? c : null;
};

const addLocal = (id, n) => pending.set(id, (pending.get(id) || 0) + n);

async function count(id) {
  id = String(id);
  const client = live();
  if (client) {
    try {
      await client.hincrby(KEY(), id, 1);
      return;
    } catch {
      /* fall back to memory */
    }
  }
  addLocal(id, 1);
}

async function drain() {
  const out = new Map(pending);
  pending.clear();
  const client = live();
  if (client) {
    try {
      const [[, all]] = await client.multi().hgetall(KEY()).del(KEY()).exec();
      for (const [id, n] of Object.entries(all || {})) out.set(id, (out.get(id) || 0) + Number(n));
    } catch {
      /* Redis counts stay in Redis for the next flush */
    }
  }
  return out;
}

async function flush() {
  const counts = await drain();
  if (!counts.size) return 0;
  const Service = require('../models/Service');
  const ops = [...counts].filter(([, n]) => n > 0).map(([id, n]) => ({ updateOne: { filter: { _id: id }, update: { $inc: { views: n } } } }));
  try {
    await Service.bulkWrite(ops, { ordered: false });
    return ops.length;
  } catch (err) {
    console.error('[views] flush failed, kept for the next one:', err.message);
    for (const [id, n] of counts) addLocal(id, n);
    return 0;
  }
}

let timer = null;
function startViewFlush() {
  if (timer || process.env.NODE_ENV === 'test') return;
  timer = setInterval(() => void flush(), FLUSH_MS);
  if (timer.unref) timer.unref();
}

module.exports = { count, flush, startViewFlush, _pending: pending };
