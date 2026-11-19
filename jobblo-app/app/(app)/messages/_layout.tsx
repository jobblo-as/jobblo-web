import { Stack } from 'expo-router';

/**
 * A chat opened straight from a link (a push notification, often a cold start) still gets
 * the conversation list underneath it, so back lands on Meldinger instead of nowhere.
 */
export const unstable_settings = { anchor: 'index' };

/**
 * Stack navigator for the messages section.
 * messages/index and messages/[chatId] push onto this stack.
 * headerShown: false — each screen renders its own header.
 */
export default function MessagesLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
