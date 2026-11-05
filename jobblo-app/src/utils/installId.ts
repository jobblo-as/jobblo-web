import { authStorage as storage } from './authStorage';

/**
 * This installation's random id, sent as X-Install-Id so the backend can tell "the same app
 * install from another network" (security monitoring). Made once, kept in storage, never tied
 * to the hardware: a reinstall is a new installation. The server stores only a keyed hash.
 */
const KEY = 'jobblo.installId';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RandomSources = {
  crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
  /** expo-modules-core: Java UUID.randomUUID() / iOS UUID() — CSPRNG-backed. */
  expo?: { uuidv4?: () => string };
};

/** A v4 UUID from a secure source, or null when there is none (then no header is sent). */
export function newInstallId(g: RandomSources = globalThis as unknown as RandomSources) {
  const fromExpo = g.expo?.uuidv4?.();
  if (fromExpo && UUID.test(fromExpo)) return fromExpo.toLowerCase();
  if (!g.crypto?.getRandomValues) return null;
  const b = g.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let pending: Promise<string | null> | null = null;

/** The stored id, made on first use. Never throws. */
export function getInstallId(): Promise<string | null> {
  if (!pending)
    pending = (async () => {
      try {
        const stored = await storage.getItem(KEY);
        if (stored && UUID.test(stored)) return stored;
        const id = newInstallId();
        if (id) await storage.setItem(KEY, id);
        return id;
      } catch {
        return null;
      }
    })();
  return pending;
}
