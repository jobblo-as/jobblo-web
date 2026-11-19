import { Stack } from 'expo-router';

/**
 * A link that opens a profile page directly (the Stripe Connect return to settings/payout,
 * which often cold-starts the app) still gets Min Jobblo underneath it. Without this the stack
 * held only the linked page: back had nowhere to go and the Profil tab could not reach
 * Min Jobblo.
 */
export const unstable_settings = { anchor: 'index' };

/**
 * Stack navigator for the profile section.
 * All profile/* and profile/settings/* screens push onto this stack.
 * The tab bar remains visible (managed by the parent Tabs layout).
 * headerShown: false — each screen renders its own header.
 */
export default function ProfileLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
