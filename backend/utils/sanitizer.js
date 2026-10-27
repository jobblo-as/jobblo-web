const SENSITIVE_KEYS = [
  'password',
  'passwordconfirmation',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'secret',
  'apikey',
  'stripesecret',
  'cardnumber',
  'cvv',
  'iban',
  'accountnumber',
  // Personal data (M12): never needed to debug an error, and kept for months in the logs.
  'email',
  'phone',
  'address',
  'birth',
  'personnummer',
  'nationalid',
  'otp',
  'emailcode',
  'backupcode',
];

function redactValue(v) {
  if (typeof v === 'string') return '[REDACTED]';
  if (typeof v === 'object') return '[REDACTED]';
  return null;
}

function redactSensitive(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    const lower = k.toLowerCase();
    if (SENSITIVE_KEYS.some((s) => lower.includes(s))) {
      out[k] = redactValue(v);
      continue;
    }
    if (v && typeof v === 'object') {
      out[k] = redactSensitive(v);
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Free text (error messages, stacks) carries personal data too: a MongoDB duplicate-key
 * error reads `dup key: { email: "kari@example.no" }`. Masks e-mail addresses, the values
 * in a dup-key clause, and runs of 8+ digits (phone and national id numbers).
 */
function redactText(text) {
  if (typeof text !== 'string') return text;
  // Capped, and the e-mail pattern only starts at the beginning of a run (lookbehind): the
  // unanchored version retried at every character, so a 120 KB "aaaa@a.a.a…" value in an
  // error message blocked the event loop for 84 s (final review I1).
  return text
    .slice(0, 20000)
    .replace(/dup key: \{[^}]*\}/g, 'dup key: { [REDACTED] }')
    .replace(/(?<![A-Z0-9._%+-])[A-Z0-9._%+-]+(?:@|%40)[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/(?<![\d+])\+?\d[\d .-]{6,}\d/g, (m) =>
      // ISO dates (2026-10-26, timestamps in messages) are not personal data.
      m.replace(/\D/g, '').length >= 8 && !/^\d{4}-\d{2}-\d{2}$/.test(m) ? '[NUMBER]' : m
    );
}

module.exports = { redactSensitive, redactText };
