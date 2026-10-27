/**
 * The post-job flow's language. Every text keeps Norwegian and English side by side; set
 * LANG = 'en' to show the flow in English (it was English while it was being tested).
 */
export const LANG = 'no' as 'no' | 'en';

export const t = (no: string, en: string) => (LANG === 'en' ? en : no);

/** Locale for dates in the flow. */
export const DATE_LOCALE = LANG === 'en' ? 'en-GB' : 'nb-NO';
