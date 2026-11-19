import { requireOptionalNativeModule } from 'expo';

/**
 * The installed build number ("13"), or null where it cannot be read: web, and an app build
 * made before expo-application was added. Importing `expo-application` directly threw
 * "Cannot find native module 'ExpoApplication'" in such a build and took Min Jobblo and
 * Innstillinger down with it; the version line then just shows "1.0.0".
 */
export function nativeBuildVersion(): string | null {
  const application = requireOptionalNativeModule<{ nativeBuildVersion?: string | null }>(
    'ExpoApplication'
  );
  return application?.nativeBuildVersion ?? null;
}
