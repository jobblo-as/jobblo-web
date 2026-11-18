import { Stack } from 'expo-router';

/**
 * Other people's profiles, one at a time. They used to open inside the Profil tab's stack,
 * next to the user's own Min Jobblo and settings, and that stack outlived each visit:
 * profile A → back → profile B → back showed A again, and with Min Jobblo underneath, back from
 * a job owner's profile landed on Min Jobblo instead of the job. Its own section, with every
 * [userId] sharing one singular id, makes back return to wherever the profile was opened from.
 * Nothing on a profile opens another profile, so the stack never needs two.
 */
export default function UsersLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="[userId]" dangerouslySingular={() => 'user'} />
    </Stack>
  );
}
