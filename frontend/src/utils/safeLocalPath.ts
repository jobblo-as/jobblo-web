/**
 * `path` if it stays on this site, else `fallback`. For redirect targets taken from the URL
 * (`?next=`) or router state.
 *
 * Checking for a leading "/" and no "//" let "/\evil.com" (and "/\t/evil.com") through: the
 * URL parser reads "\" as "/" and drops tabs and newlines, so both mean "//evil.com", and the
 * router fell back to a full-page load on the other host. Resolving the path the way the
 * browser will and comparing origins covers every such spelling.
 */
export const safeLocalPath = (
  path: unknown,
  fallback: string,
  origin = window.location.origin
): string => {
  if (typeof path !== 'string' || !path.startsWith('/')) return fallback;
  try {
    const url = new URL(path, origin);
    return url.origin === origin ? url.pathname + url.search + url.hash : fallback;
  } catch {
    return fallback;
  }
};
