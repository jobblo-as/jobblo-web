import React, { useCallback, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { Lock, MapPin, Navigation, Settings } from 'lucide-react-native';
import { BottomSheet } from './ui/BottomSheet';
import { Button } from './ui/Button';
import { TC } from '../theme/colors';
import { locationPermissionStep } from '../utils/locationPermissionStep';

/** Why the location is wanted where it was asked for; sets the headline and the first point. */
export type LocationPurpose = 'nearby' | 'place';

const COPY: Record<LocationPurpose, { title: string; point: string }> = {
  nearby: {
    title: 'Se oppdrag i nærheten',
    point: 'Vi viser oppdragene som ligger nærmest deg først.',
  },
  place: {
    title: 'Finn adressen med ett trykk',
    point: 'Vi setter nålen på kartet og fyller ut adressen for deg.',
  },
};

function Point({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View className="flex-row items-start gap-3">
      <View className="h-9 w-9 items-center justify-center rounded-full bg-tint">{icon}</View>
      <Text className="flex-1 pt-1.5 text-[0.9375rem] leading-6 text-ink-2">{text}</Text>
    </View>
  );
}

/**
 * Explains why Jobblo wants the location before the phone's own prompt, and the way out when it
 * was turned off for good (Settings). The button before the system prompt says "Fortsett", not
 * "Tillat": the real choice is made in the system dialog (App Store 5.1.1).
 */
function LocationPermissionSheet({
  step,
  purpose,
  onContinue,
  onClose,
}: {
  step: 'ask' | 'settings' | null;
  purpose: LocationPurpose;
  onContinue: () => void;
  onClose: () => void;
}) {
  const settings = step === 'settings';
  const copy = COPY[purpose];
  return (
    <BottomSheet visible={step !== null} onClose={onClose} title="Posisjon">
      <View testID="location-permission-sheet" className="items-center pb-1">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-tint">
          {settings ? (
            <Settings size={28} color={TC.brandText} />
          ) : (
            <MapPin size={28} color={TC.brandText} />
          )}
        </View>
        <Text className="mt-4 text-center text-[1.25rem] font-bold tracking-[-0.01em] text-ink">
          {settings ? 'Posisjon er slått av for Jobblo' : copy.title}
        </Text>
        <Text className="mt-2 text-center text-[0.9375rem] leading-6 text-muted">
          {settings
            ? 'Slå på posisjon for Jobblo i Innstillinger, så kan du bruke denne funksjonen.'
            : 'Jobblo kan bruke posisjonen din mens du bruker appen.'}
        </Text>
      </View>

      {settings ? null : (
        <View className="mt-5 gap-3.5">
          <Point icon={<Navigation size={17} color={TC.brandText} />} text={copy.point} />
          <Point
            icon={<Lock size={17} color={TC.brandText} />}
            text="Bare mens appen er åpen, aldri i bakgrunnen. Du kan slå det av i Innstillinger."
          />
        </View>
      )}

      <View className="mt-6 gap-3">
        <Button
          label={settings ? 'Åpne innstillinger' : 'Fortsett'}
          fullWidth
          onPress={onContinue}
        />
        <Button label="Ikke nå" variant="secondary" fullWidth onPress={onClose} />
      </View>
    </BottomSheet>
  );
}

/**
 * `ask()` resolves true once the app may read the location. Already allowed: at once, no sheet.
 * Otherwise the sheet explains first; "Fortsett" opens the system prompt, "Ikke nå" resolves
 * false. Render `sheet` once in the screen that calls `ask()`.
 */
export function useLocationPermission(purpose: LocationPurpose) {
  const [step, setStep] = useState<'ask' | 'settings' | null>(null);
  const pending = useRef<((granted: boolean) => void) | null>(null);

  const settle = (granted: boolean) => {
    setStep(null);
    pending.current?.(granted);
    pending.current = null;
  };

  const ask = useCallback(async () => {
    let current: Location.LocationPermissionResponse | null = null;
    try {
      current = await Location.getForegroundPermissionsAsync();
    } catch {
      // Unknown: the explainer, then the system prompt decides.
    }
    const next = locationPermissionStep(current);
    if (next === 'granted') return true;
    // A second tap while the sheet is open answers the first one with "no".
    pending.current?.(false);
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setStep(next);
    });
  }, []);

  const onContinue = async () => {
    if (step === 'settings') {
      void Linking.openSettings();
      settle(false);
      return;
    }
    setStep(null);
    try {
      const answer = await Location.requestForegroundPermissionsAsync();
      settle(answer.granted);
    } catch {
      settle(false);
    }
  };

  const sheet = (
    <LocationPermissionSheet
      step={step}
      purpose={purpose}
      onContinue={() => void onContinue()}
      onClose={() => settle(false)}
    />
  );
  return { ask, sheet };
}
