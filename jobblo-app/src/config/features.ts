import { Platform } from 'react-native';

/**
 * Membership / subscription screens (plans bought through Stripe).
 *
 * Off by default: App Store guideline 3.1.1 requires digital subscriptions sold inside an
 * iOS app to use In-App Purchase, so a store build must not show or link to the Stripe plan
 * checkout. Set EXPO_PUBLIC_MEMBERSHIP_ENABLED=true to bring the screens back (e.g. local dev).
 * Never on iOS, whatever the env says: there it would have to be In-App Purchase.
 */
export const MEMBERSHIP_ENABLED =
  process.env.EXPO_PUBLIC_MEMBERSHIP_ENABLED === 'true' && Platform.OS !== 'ios';

/**
 * Which Sign in with Apple this build shows: the native sheet on iOS; on Android Apple's web
 * flow (no native SDK there), only when the build sets EXPO_PUBLIC_APPLE_WEB_SIGNIN=true,
 * because the backend answers 503 until APPLE_SERVICES_ID / APPLE_REDIRECT_URI are set.
 */
export function appleSignInMode(os: string, webFlag: string | undefined): 'native' | 'web' | null {
  if (os === 'ios') return 'native';
  return os === 'android' && webFlag === 'true' ? 'web' : null;
}
export const APPLE_SIGNIN_MODE = appleSignInMode(
  Platform.OS,
  process.env.EXPO_PUBLIC_APPLE_WEB_SIGNIN
);
