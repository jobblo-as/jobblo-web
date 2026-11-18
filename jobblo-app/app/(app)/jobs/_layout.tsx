import { Stack } from 'expo-router';

/**
 * One job page at a time. The jobs tab keeps this stack when the user leaves it with back, so
 * Hjem → job A → back → job B was pushed on top of job A, and back from B showed A again
 * instead of Hjem. Nothing on a job page opens another job, so the stack never needs two:
 * every [id] shares one singular id and the next job reuses the screen ([id].tsx remounts the
 * page per id).
 */
export default function JobsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="[id]" dangerouslySingular={() => 'job'} />
    </Stack>
  );
}
