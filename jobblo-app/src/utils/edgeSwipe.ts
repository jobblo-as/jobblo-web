/**
 * Pages where a swipe from the left edge must be added by the app.
 *
 * Screens pushed inside a section's own stack (profile settings, a chat from Meldinger, a
 * favourites list) already get the native iOS swipe-back, and Android's own back gesture works
 * everywhere it is turned on. These pages do not: they are tab routes without a tab button, or
 * the first (only) screen of their section's stack, so the native stack has nothing to pop and
 * the swipe did nothing. The tab roots (Hjem, Legg ut, Meldinger, Varsler, Profil) are left out:
 * there is nowhere "back" to go, and Legg ut has its own step-back swipe.
 */
const SINGLE_PAGES = [
  '/explore',
  '/recommended-taskers',
  '/my-applications',
  '/my-jobs',
  '/favorites',
];
const SECTIONS = ['/jobs/', '/users/', '/job-applicants/', '/provider/', '/safepay/', '/disputes/'];

export function edgeSwipeEnabled(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (SINGLE_PAGES.includes(path)) return true;
  return SECTIONS.some((prefix) => path.startsWith(prefix) && path.length > prefix.length);
}

/** A rightward drag from the edge, far or fast enough, means "back". */
export function isBackSwipe(e: { translationX: number; velocityX: number }): boolean {
  return e.translationX > 70 || (e.translationX > 25 && e.velocityX > 600);
}
