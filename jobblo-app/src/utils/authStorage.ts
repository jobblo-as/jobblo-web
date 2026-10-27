/**
 * The one place the persisted session lives.
 *
 * `src/store/authStore.ts` and `src/api/client.ts` each used to carry their own copy of
 * this shim, and both copies had the same defect: a hard AsyncStorage failure was caught
 * and silently replaced with a no-op stub. On a device that means nothing is ever written
 * and every read returns `null` — which does not present as an error, it presents as
 * "logged out again after every reload". The failure was invisible exactly where it
 * mattered, so this module probes a backend before trusting it and says so loudly when
 * none of them work.
 */

type StorageBackend = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const PROBE_KEY = '__jobblo_storage_probe__';

/**
 * A present module is not a working module. async-storage v3 resolves to an object whose
 * `getItem` IS a function but throws `Native module is null` on first call when the running
 * app does not ship the matching native module — so shape checks pass and every read still
 * fails. Only `worksAtRuntime` below can tell the difference.
 */
function resolveNativeStorage(): StorageBackend | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-async-storage/async-storage');
    const candidate = mod?.default ?? mod ?? null;
    return typeof candidate?.getItem === 'function' ? (candidate as StorageBackend) : null;
  } catch {
    return null;
  }
}

function resolveWebStorage(): StorageBackend | null {
  // `window` exists in React Native; `window.localStorage` does not. Both checks are needed.
  if (typeof window === 'undefined' || !window.localStorage) return null;
  const local = window.localStorage;
  return {
    getItem: async (key) => local.getItem(key),
    setItem: async (key, value) => {
      local.setItem(key, value);
    },
    removeItem: async (key) => {
      local.removeItem(key);
    },
  };
}

/**
 * Last resort. Keeps the session coherent for the rest of the JS context so the app does not
 * behave erratically mid-session, but it does NOT survive a reload — hence the loud log in
 * `selectBackend`.
 */
const memoryStore = new Map<string, string>();
const memoryStorage: StorageBackend = {
  getItem: async (key) => memoryStore.get(key) ?? null,
  setItem: async (key, value) => {
    memoryStore.set(key, value);
  },
  removeItem: async (key) => {
    memoryStore.delete(key);
  },
};

/** Real write → read → delete round trip. The only honest test of a storage backend. */
async function worksAtRuntime(candidate: StorageBackend): Promise<boolean> {
  try {
    await candidate.setItem(PROBE_KEY, '1');
    const echoed = await candidate.getItem(PROBE_KEY);
    await candidate.removeItem(PROBE_KEY);
    return echoed === '1';
  } catch {
    return false;
  }
}

async function selectBackend(): Promise<StorageBackend> {
  const native = resolveNativeStorage();
  if (native && (await worksAtRuntime(native))) return native;

  const web = resolveWebStorage();
  if (web && (await worksAtRuntime(web))) return web;

  console.error(
    '[jobblo] No working persistent storage backend — the session will NOT survive a reload. ' +
      'On a device this almost always means the @react-native-async-storage/async-storage ' +
      'native module in the running app does not match the installed JS package. ' +
      'Run `npx expo install --check`.'
  );
  return memoryStorage;
}

/** Selected once per JS context; every caller awaits the same selection. */
let selection: Promise<StorageBackend> | null = null;

function backend(): Promise<StorageBackend> {
  if (!selection) selection = selectBackend();
  return selection;
}

/**
 * Credentials go to the Keychain / Android Keystore (expo-secure-store), not AsyncStorage,
 * which is a plain file on disk and was included in Android backups (security review M9).
 * Everything else (the cached profile, monitoring ids) stays on the plain backend: SecureStore
 * is slow and size-limited, and none of that authenticates anybody.
 */
const SECURE_KEYS = new Set(['token']);

function resolveSecureStore(): StorageBackend | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const store = require('expo-secure-store');
    if (typeof store?.getItemAsync !== 'function') return null;
    return {
      getItem: (key) => store.getItemAsync(key),
      // Readable after the first unlock so a refresh or a push handled while the phone is
      // locked still has the token; THIS_DEVICE_ONLY keeps it out of backups and device moves.
      setItem: (key, value) =>
        store.setItemAsync(key, value, {
          keychainAccessible: store.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        }),
      removeItem: (key) => store.deleteItemAsync(key),
    };
  } catch {
    return null;
  }
}

/**
 * Builds before this one kept the token on the plain backend. Copy it across once, then delete
 * the plain copy, so an upgrade neither signs the user out nor leaves the old copy behind.
 * Copy before delete: a failure in between leaves two copies, never none.
 */
async function migrateLegacyKeys(secure: StorageBackend) {
  const plain = await backend();
  for (const key of SECURE_KEYS) {
    const legacy = await plain.getItem(key);
    if (legacy === null) continue;
    if ((await secure.getItem(key)) === null) await secure.setItem(key, legacy);
    await plain.removeItem(key);
  }
}

/** `null` = no working SecureStore (web, or a build without the native module): plain backend. */
let secureSelection: Promise<StorageBackend | null> | null = null;

function secureBackend(): Promise<StorageBackend | null> {
  if (!secureSelection) {
    secureSelection = (async () => {
      const secure = resolveSecureStore();
      if (!secure || !(await worksAtRuntime(secure))) return null;
      await migrateLegacyKeys(secure).catch((error) =>
        console.error('[jobblo] Token migration to SecureStore failed.', error)
      );
      return secure;
    })();
  }
  return secureSelection;
}

async function backendFor(key: string): Promise<StorageBackend> {
  return (SECURE_KEYS.has(key) && (await secureBackend())) || backend();
}

/**
 * A backend that passed the probe can still fail later (storage full, database evicted).
 * Degrading to memory keeps the current session usable instead of throwing into
 * `hydrate()`'s catch block, which would sign the user out.
 */
async function withFallback<T>(
  key: string,
  op: (target: StorageBackend) => Promise<T>
): Promise<T> {
  const target = await backendFor(key);
  try {
    return await op(target);
  } catch (error) {
    console.error('[jobblo] Storage operation failed; degrading to in-memory session.', error);
    return op(memoryStorage);
  }
}

export const authStorage = {
  getItem: (key: string) => withFallback(key, (target) => target.getItem(key)),
  setItem: (key: string, value: string) =>
    withFallback(key, (target) => target.setItem(key, value)),
  removeItem: (key: string) => withFallback(key, (target) => target.removeItem(key)),
};

/** `false` means logins cannot survive a reload on this build. Useful for a dev-only banner. */
export async function isSessionPersistent(): Promise<boolean> {
  return (await backend()) !== memoryStorage;
}
