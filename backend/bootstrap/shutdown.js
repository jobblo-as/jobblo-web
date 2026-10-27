/**
 * Graceful shutdown on SIGTERM / SIGINT (deploys, Ctrl+C, nodemon restarts): stop taking new
 * connections, let in-flight requests and running queue jobs finish, then close Redis and
 * MongoDB. A deadline forces the exit so a stuck request cannot block a deploy forever.
 */
const DEADLINE_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10_000;

function registerShutdown({ server, io, extra = [] }) {
  let closing = false;
  const close = async (signal) => {
    if (closing) return;
    closing = true;
    console.log(`[shutdown] ${signal}: closing (max ${DEADLINE_MS / 1000}s)…`);
    const timer = setTimeout(() => {
      console.error('[shutdown] deadline reached — forcing exit');
      process.exit(1);
    }, DEADLINE_MS);
    timer.unref();
    const step = async (name, fn) => {
      try {
        await fn();
      } catch (err) {
        console.error(`[shutdown] ${name}:`, err.message);
      }
    };
    // `extra` (the scheduler's stop) first: no new timer-mode job may start while we drain.
    for (const [name, fn] of extra) await step(name, fn);
    // then socket.io: open WebSockets kept server.close() pending, so every restart with a
    // chat user online hit the deadline and exit(1) before queues, Redis and Mongo closed.
    if (io) await step('socket.io', () => new Promise((resolve) => io.close(() => resolve())));
    await step(
      'http',
      () => new Promise((resolve) => (server.listening ? server.close(() => resolve()) : resolve()))
    );
    await step('queue workers', () => require('../services/queue').stopWorkers());
    await step('redis', () => require('../config/redis').closeRedis());
    await step('mongodb', () => require('mongoose').disconnect());
    console.log('[shutdown] done');
    // Done in time: the deadline must not fire later (with exit mocked in a test it did, and
    // its exit(1) killed the whole Jest run).
    clearTimeout(timer);
    process.exit(0);
  };
  // Last line of defence: a stray rejected promise (e.g. in a socket handler) used to
  // exit the whole process. Log it and keep serving.
  process.on('unhandledRejection', (reason) => {
    console.error(
      '[process] unhandled rejection:',
      reason instanceof Error ? reason.stack : reason
    );
  });
  process.once('SIGTERM', () => close('SIGTERM'));
  process.once('SIGINT', () => close('SIGINT'));
  return close;
}

module.exports = { registerShutdown };
