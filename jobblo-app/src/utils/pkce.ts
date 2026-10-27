/**
 * PKCE (RFC 7636, S256) for the mobile Google/Vipps sign-in (security review P6).
 *
 * The backend no longer puts an access token in the jobblo://oauth-success link: any Android
 * app can register that scheme and receive it. The link now carries a one-time code that the
 * server only exchanges together with the verifier generated here, which never leaves this app
 * except in that exchange request. The challenge (SHA-256 of the verifier) is what goes to the
 * browser.
 *
 * The app has no expo-crypto and Hermes has no crypto.subtle, so SHA-256 is computed here;
 * pkce.check.mjs pins it to node:crypto. Pure so that check runs under plain Node.
 */

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const ror = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export function sha256(message: Uint8Array): Uint8Array {
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const total = Math.ceil((message.length + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(message);
  buf[message.length] = 0x80;
  const view = new DataView(buf.buffer);
  const bits = message.length * 8;
  view.setUint32(total - 8, Math.floor(bits / 2 ** 32));
  view.setUint32(total - 4, bits >>> 0);

  const w = new Array<number>(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 =
        (hh + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => (h[i] = (h[i] + v) | 0));
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  h.forEach((v, i) => outView.setUint32(i * 4, v >>> 0));
  return out;
}

export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

type RandomSources = {
  crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
  /** expo-modules-core: Java UUID.randomUUID() (SecureRandom) / iOS UUID() — both CSPRNG-backed. */
  expo?: { uuidv4?: () => string };
};

/** 43+ unreserved characters from a cryptographically secure source, or throw. Never Math.random. */
function randomVerifier(): string {
  const g = globalThis as unknown as RandomSources;
  if (g.crypto?.getRandomValues) return base64url(g.crypto.getRandomValues(new Uint8Array(32)));
  const uuid = g.expo?.uuidv4;
  // Two v4 UUIDs: 244 random bits as 64 hex characters.
  if (typeof uuid === 'function') return `${uuid()}${uuid()}`.replace(/-/g, '');
  throw new Error('No secure random source for PKCE');
}

export function codeChallengeFor(verifier: string): string {
  // The verifier is ASCII by construction, so char codes are its bytes.
  return base64url(sha256(Uint8Array.from(verifier, (ch) => ch.charCodeAt(0))));
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomVerifier();
  return { verifier, challenge: codeChallengeFor(verifier) };
}
