/**
 * What to show before using the phone's location, from expo-location's permission response:
 * - 'granted': go straight on, no sheet.
 * - 'ask': our explainer first, then the system prompt (never asked, or denied but askable).
 * - 'settings': denied for good (the system will not ask again), so only Settings can turn it on.
 */
export type LocationPermissionStep = 'granted' | 'ask' | 'settings';

export function locationPermissionStep(
  permission: { granted?: boolean; canAskAgain?: boolean } | null | undefined
): LocationPermissionStep {
  if (permission?.granted) return 'granted';
  // Unknown or askable: the explainer, then the system prompt decides.
  if (!permission || permission.canAskAgain !== false) return 'ask';
  return 'settings';
}
