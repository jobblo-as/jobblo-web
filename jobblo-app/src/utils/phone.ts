/**
 * Norwegian phone numbers, as on the web (frontend/src/utils/norwegianFormat.ts): state holds
 * the eight digits, the field shows them grouped. Check: node src/utils/phone.check.mjs
 */

/** The national digits of `value`, at most eight; a +47 / 0047 prefix is dropped. */
export function phoneDigits(value: string | undefined | null): string {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('0047')) digits = digits.slice(4);
  else if (digits.startsWith('47') && digits.length > 8) digits = digits.slice(2);
  return digits.slice(0, 8);
}

/**
 * The eight-digit Norwegian number in `value`, or null when it is not one. Same rule as the
 * server (backend controllers/services/serviceHelpers.js norwegianPhone).
 */
export function norwegianPhone(value: string | undefined | null): string | null {
  const digits = phoneDigits(value);
  return /^[2-9]\d{7}$/.test(digits) ? digits : null;
}

/**
 * Grouped the way it is written in Norway, also while half typed: mobile (4/9…) `412 34 567`,
 * everything else in pairs `22 12 34 56`.
 */
export function formatPhone(value: string | undefined | null): string {
  const d = phoneDigits(value);
  if (/^[49]/.test(d))
    return [d.slice(0, 3), d.slice(3, 5), d.slice(5, 8)].filter(Boolean).join(' ');
  return (d.match(/.{1,2}/g) ?? []).join(' ');
}
