import { Platform } from 'react-native';

/**
 * Membership / subscription screens (plans bought through Stripe).
 *
 * Off by default: App Store guideline 3.1.1 requires digital subscriptions sold inside an
 * iOS app to use In-App Purchase, so a store build must not show or link to the Stripe plan
 * checkout. Set EXPO_PUBLIC_MEMBERSHIP_ENABLED=true to bring the screens back (e.g. local dev).
 * Never on iOS, whatever the env says: there it would have to be In-App Purchase.
 */
export const MEMBERSHIP_ENABLED = process.env.EXPO_PUBLIC_MEMBERSHIP_ENABLED === 'true' && Platform.OS !== 'ios';
