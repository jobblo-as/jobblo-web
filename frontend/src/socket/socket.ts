import type { Socket } from 'socket.io-client';
import { API_BASE_URL } from '../config/env.ts';

/** socket.io's own listener type for user events. */
type Handler = NonNullable<Parameters<Socket['off']>[1]>;

/**
 * The shared socket, loaded on first use.
 *
 * socket.io-client (~15 KB gzipped) used to be in the first download of every page, although
 * only signed-in users open a socket. `initSocket()` still returns synchronously: calls made
 * before the library arrives are queued and replayed on the real socket, and socket.io itself
 * buffers emits until it is connected.
 *
 * ponytail: only the surface the app uses (on/off/emit/connect/connected) is forwarded; add a
 * method here if a caller needs more of the Socket API.
 */
let real: Socket | null = null;
let loading = false;
const listeners: Array<[string, Handler]> = [];
const pendingEmits: unknown[][] = [];
const AUTH_RETRY_MS = 5000;
let authRetry: ReturnType<typeof setTimeout> | null = null;

/**
 * socket.io treats a refused handshake as final (`active` false) and never retries — almost
 * always the 1-hour access cookie had expired (the server also closes sockets at that expiry).
 * Any authenticated call refreshes the cookie through the axios 401 handler; then reconnect.
 * If the session is gone, that handler logs out, which calls disconnectSocket and ends this.
 */
function retryAfterAuth() {
  if (!real || real.active || authRetry) return;
  authRetry = setTimeout(async () => {
    authRetry = null;
    try {
      await (await import('../api/mainURLs.ts')).default.get('/api/auth/profile');
    } catch {
      // Offline or signed out; the next connect_error schedules another attempt.
    }
    real?.connect();
  }, AUTH_RETRY_MS);
}

const facade = {
  on(event: string, fn: Handler) {
    if (real) real.on(event, fn);
    else listeners.push([event, fn]);
    return facade;
  },
  off(event: string, fn?: Handler) {
    if (real) real.off(event, fn);
    else {
      for (let i = listeners.length - 1; i >= 0; i--) {
        if (listeners[i][0] === event && (!fn || listeners[i][1] === fn)) listeners.splice(i, 1);
      }
    }
    return facade;
  },
  emit(...args: unknown[]) {
    if (real) (real.emit as (...a: unknown[]) => void)(...args);
    else pendingEmits.push(args);
    return facade;
  },
  connect() {
    real?.connect();
    return facade;
  },
  get connected() {
    return real?.connected ?? false;
  },
};

export type AppSocket = typeof facade;

export const initSocket = (): AppSocket => {
  if (!real && !loading) {
    loading = true;
    void import('socket.io-client')
      .then(({ io }) => {
        if (!loading) return; // signed out while it was loading
        real = io(API_BASE_URL, {
          // 'websocket' only meant corporate proxies and networks that block the
          // upgrade got no real-time features at all. Polling is the fallback the
          // transport list exists for.
          transports: ['websocket', 'polling'],
          withCredentials: true,
          autoConnect: true,
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 10000,
        });
        real.on('connect_error', (err) => {
          console.error('Socket connection error:', err.message);
          retryAfterAuth();
        });
        for (const [event, fn] of listeners.splice(0)) real.on(event, fn);
        for (const args of pendingEmits.splice(0))
          (real.emit as (...a: unknown[]) => void)(...args);
      })
      .catch((err) => {
        loading = false;
        console.error('Socket library failed to load:', err);
      });
  }
  return facade;
};

export const disconnectSocket = () => {
  loading = false;
  if (authRetry) clearTimeout(authRetry);
  authRetry = null;
  listeners.length = 0;
  pendingEmits.length = 0;
  if (real) {
    real.disconnect();
    real = null;
  }
};
