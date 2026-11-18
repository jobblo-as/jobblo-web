/**
 * The full-screen photo viewer closes on a drag far or fast enough: up or down always, and
 * sideways only when there is a single photo (with several, sideways moves to the next one).
 */
const FAR = 120;
const FAST = 900;

export function shouldClose(
  e: { translationX: number; translationY: number; velocityX: number; velocityY: number },
  single: boolean
): boolean {
  const far = (d: number) => Math.abs(d) > FAR;
  const fast = (v: number) => Math.abs(v) > FAST;
  if (far(e.translationY) || fast(e.velocityY)) return true;
  return single && (far(e.translationX) || fast(e.velocityX));
}
