import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, Crosshair } from 'lucide-react-native';
import MapView, {
  LatLng,
  MapPressEvent,
  Marker,
  PoiClickEvent,
  MarkerDragStartEndEvent,
  Region,
} from 'react-native-maps';
import * as Location from 'expo-location';
import { MAP_PROVIDER, MAPS_AVAILABLE } from '../../../../src/utils/mapProvider';
import { MapUnavailable } from '../../../../src/components/ui/MapUnavailable';
import { useRouter } from 'expo-router';
import { useProfile, useUpdateProfile } from '../../../../src/hooks/useProfile';
import { useAuthStore } from '../../../../src/store/authStore';
import { ErrorState } from '../../../../src/components/ui/ErrorState';
import { GlassBackButton } from '../../../../src/components/ui/GlassButton';
import { Card, SectionLabel } from '../../../../src/components/ui/Card';
import { FormRow } from '../../../../src/components/ui/FormRow';
import type { CurrentProfile } from '../../../../src/services/profile.service';
import { TC } from '../../../../src/theme/colors';
import { AddressesSkeleton } from '../../../../src/components/skeletons/ScreenSkeletons';
import { AddressSearchField } from '../../../../src/components/create-job/AddressSearchField';
import { findAddress, type AddressHit } from '../../../../src/services/geonorge.service';

/** `country` is never typed: a picked or typed address is Norwegian, a map tap brings its own. */
type Draft = { address: string; postNumber: string; postSted: string; country: string };

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const draftFrom = (profile: CurrentProfile): Draft => ({
  address: text(profile.address),
  postNumber: text(profile.postNumber),
  postSted:
    typeof profile.postSted === 'object' &&
    profile.postSted &&
    typeof profile.postSted.city === 'string'
      ? profile.postSted.city
      : text(profile.postSted),
  country: text((profile as { country?: unknown }).country),
});
const same = (a: Draft, b: Draft) =>
  a.address.trim() === b.address.trim() &&
  a.postNumber === b.postNumber &&
  a.postSted.trim() === b.postSted.trim() &&
  a.country === b.country;

const digitsOnly = (value: string, max?: number): string => {
  const digits = (value || '').replace(/\D/g, '');
  return typeof max === 'number' ? digits.slice(0, max) : digits;
};
const formatPostalCode = (value: string): string => digitsOnly(value, 4);
const isValidPostalCode = (value: string): boolean => /^\d{4}$/.test(digitsOnly(value, 4));

function errorMessage(error: unknown) {
  const response = (error as { response?: { status?: number; data?: { error?: string } } })
    ?.response;
  if (response?.status === 403) return 'Du har ikke tilgang til å endre denne brukeren.';
  if (response?.status === 400) return response.data?.error || 'Kontroller feltene og prøv igjen.';
  if (response?.status === 404) return 'Brukeren finnes ikke lenger.';
  return 'Kunne ikke lagre adressene. Sjekk internettforbindelsen og prøv igjen.';
}

const DEFAULT_REGION: Region = {
  latitude: 59.911491,
  longitude: 10.757933,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};

type PermissionState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'granted' }
  | { status: 'denied' }
  | { status: 'unsupported' };

export default function AddressesSettingsScreen() {
  const router = useRouter();
  const { data: profile, isLoading, isError, refetch } = useProfile();
  const update = useUpdateProfile();
  const userId = useAuthStore((state: { user?: { _id?: unknown } | null }) =>
    typeof state.user?._id === 'string' ? state.user._id : undefined
  );

  const [draft, setDraft] = useState<Draft | null>(null);
  const [original, setOriginal] = useState<Draft | null>(null);

  const mapRef = useRef<MapView | null>(null);
  const watcherRef = useRef<Location.LocationSubscription | null>(null);
  const locatingRef = useRef(false);

  const [permission, setPermission] = useState<PermissionState>({ status: 'idle' });
  const [currentDeviceLocation, setCurrentDeviceLocation] = useState<LatLng | null>(null);
  const [selectedCoordinate, setSelectedCoordinate] = useState<LatLng | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [picked, setPicked] = useState(false);
  /** A pin from the saved address, a suggestion or a tap: GPS no longer moves it. */
  const pinSet = useRef(false);
  // The keyboard covered the search's suggestions and the fields under the map. The screen
  // pads for it (KeyboardAvoidingView); this then scrolls the focused field into the space left.
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const searchY = useRef(0);
  const afterKeyboard = (go: () => void) => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      sub.remove();
      setTimeout(go, 120); // once the padding is laid out
    });
    setTimeout(() => sub.remove(), 1000);
    setTimeout(go, 350); // keyboard already up (moving between fields)
  };
  const showSearch = () =>
    afterKeyboard(() =>
      scrollRef.current?.scrollTo({ y: Math.max(0, searchY.current - 12), animated: true })
    );
  const showFields = () => afterKeyboard(() => scrollRef.current?.scrollToEnd({ animated: true }));

  useEffect(() => {
    if (profile && !draft) {
      const next = draftFrom(profile);
      setDraft(next);
      setOriginal(next);
    }
  }, [profile, draft]);

  useEffect(() => {
    void (async () => {
      setPermission({ status: 'checking' });
      try {
        const existing = await Location.getForegroundPermissionsAsync();
        if (existing.granted) {
          setPermission({ status: 'granted' });
          try {
            const now = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            const coord = { latitude: now.coords.latitude, longitude: now.coords.longitude };
            setCurrentDeviceLocation(coord);
            // Only when no pin is set yet: the saved address (or a tap) wins over the GPS spot.
            if (!pinSet.current) {
              setSelectedCoordinate(coord);
              animateTo(coord);
            }
          } catch {
            // GPS unavailable — fall through, user can still tap the map
          }
          try {
            watcherRef.current?.remove();
            watcherRef.current = await Location.watchPositionAsync(
              {
                accuracy: Location.Accuracy.Balanced,
                distanceInterval: 10,
                timeInterval: 5000,
              },
              (loc) => {
                setCurrentDeviceLocation({
                  latitude: loc.coords.latitude,
                  longitude: loc.coords.longitude,
                });
              }
            );
          } catch {
            // watcher is best-effort; showsUserLocation may still work
          }
        } else if (existing.canAskAgain === false && existing.status !== 'granted') {
          setPermission({ status: 'denied' });
        } else {
          setPermission({ status: 'idle' });
        }
      } catch {
        setPermission({ status: 'unsupported' });
      }
    })();

    return () => {
      watcherRef.current?.remove();
      watcherRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The pin starts on the saved address (looked up once in Kartverket), not on the GPS spot:
  // without it the map showed no pin, or one where the phone was, over a saved address.
  const savedPinned = useRef(false);
  useEffect(() => {
    if (savedPinned.current || !original?.address.trim()) return;
    savedPinned.current = true;
    findAddress(original.address, original.postNumber, original.postSted)
      .then((hit) => {
        if (!hit || pinSet.current) return;
        pinSet.current = true;
        const coord = { latitude: hit.lat, longitude: hit.lng };
        setSelectedCoordinate(coord);
        animateTo(coord);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the profile arrives
  }, [original]);

  const dirty = !!draft && !!original && !same(draft, original);
  const postNumberProvidedButInvalid =
    !!draft && draft.postNumber.length > 0 && !isValidPostalCode(draft.postNumber);
  const validation = postNumberProvidedButInvalid
    ? 'Postnummer må være 4 siffer (f.eks. 0150).'
    : '';
  const canSave = !!userId && dirty && !validation && !update.isPending;

  const permissionMessage = useMemo(() => {
    if (permission.status === 'denied')
      return 'Posisjonstilgang er ikke aktivert. Du kan fortsatt skrive inn adressen manuelt.';
    if (permission.status === 'unsupported')
      return 'Posisjonstjenester er ikke tilgjengelige. Du kan fortsatt skrive inn adressen manuelt.';
    return '';
  }, [permission]);

  const animateTo = (coord: LatLng) => {
    try {
      mapRef.current?.animateToRegion(
        {
          latitude: coord.latitude,
          longitude: coord.longitude,
          latitudeDelta: 0.008,
          longitudeDelta: 0.008,
        },
        600
      );
    } catch {
      // ignore animation failures
    }
  };

  /**
   * A map tap / dragged pin / "Min posisjon" replaces the whole address. Every field is set from
   * the new result, empty where it has none, so a postnummer from the last address never stays
   * behind next to a new place. A tapped place's name leads the street.
   */
  const applyReverseGeocodeResult = async (coord: LatLng, placeName = '') => {
    pinSet.current = true;
    setIsGeocoding(true);
    try {
      const results = await Location.reverseGeocodeAsync(coord);
      const hit = results[0];
      if (hit && draft) {
        const street = (
          hit.street && hit.name ? `${hit.street} ${hit.name}` : hit.street || hit.name || ''
        ).trim();
        const post = formatPostalCode(hit.postalCode || '');
        const city = (hit.subregion || hit.city || hit.region || '').trim();
        const country = (hit.country || '').trim();
        const named =
          placeName && !street.toLowerCase().includes(placeName.toLowerCase())
            ? [placeName, street].filter(Boolean).join(', ')
            : street;
        setDraft((current) =>
          current
            ? {
                ...current,
                address: named,
                postNumber: /^\d{4}$/.test(post) ? post : '',
                postSted: city,
                country,
              }
            : current
        );
        setPicked(true);
      }
    } catch {
      // reverse geocode failure is silent; manual entry still works
    } finally {
      setIsGeocoding(false);
    }
  };

  const locateAndUse = async () => {
    if (locatingRef.current) return;
    locatingRef.current = true;
    setIsLocating(true);
    try {
      if (permission.status !== 'granted') {
        setPermission({ status: 'checking' });
        const asked = await Location.requestForegroundPermissionsAsync();
        if (!asked.granted) {
          setPermission({ status: 'denied' });
          return;
        }
        setPermission({ status: 'granted' });
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const coord = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setCurrentDeviceLocation(coord);
      setSelectedCoordinate(coord);
      animateTo(coord);
      await applyReverseGeocodeResult(coord);
    } catch {
      // GPS off or lookup failed
      Alert.alert(
        'Kunne ikke hente posisjon',
        'Sjekk at posisjonstjenester er slått på på enheten. Du kan fortsatt trykke på kartet eller skrive inn adressen manuelt.'
      );
    } finally {
      setIsLocating(false);
      locatingRef.current = false;
    }
  };

  const handleMapPress = (e: MapPressEvent) => {
    Keyboard.dismiss();
    const coord = e.nativeEvent.coordinate;
    setSelectedCoordinate({ latitude: coord.latitude, longitude: coord.longitude });
    void applyReverseGeocodeResult(coord);
  };

  // A tap on a place's icon (a school, a shop): its name comes with it.
  const handlePoiClick = (e: PoiClickEvent) => {
    Keyboard.dismiss();
    const { coordinate, name } = e.nativeEvent;
    setSelectedCoordinate({ latitude: coordinate.latitude, longitude: coordinate.longitude });
    // Android puts extra lines after the name; the first line is the name.
    void applyReverseGeocodeResult(coordinate, (name || '').split(/\r?\n/)[0].trim());
  };

  const handleMarkerDragEnd = (e: MarkerDragStartEndEvent) => {
    const coord = e.nativeEvent.coordinate;
    setSelectedCoordinate({ latitude: coord.latitude, longitude: coord.longitude });
    void applyReverseGeocodeResult(coord);
  };

  if (isLoading || !draft) {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
        <AddressesSkeleton />
      </SafeAreaView>
    );
  }
  if (isError || !profile) {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
        <ErrorState title="Kunne ikke laste adresser" onAction={() => void refetch()} />
      </SafeAreaView>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  /** A typed street or postnummer is a Norwegian one (the postnummer takes Norway's 4 digits). */
  const setTyped = (key: 'address' | 'postNumber', value: string) =>
    setDraft((current) =>
      current
        ? { ...current, [key]: value, country: current.country || (value ? 'Norge' : '') }
        : current
    );

  // The street is searched in Kartverket, as when posting a job: a suggestion fills gate,
  // postnummer and sted, and moves the pin there. The fields below stay editable.
  const addressConfirmed = !!draft.address && (picked || draft.address === original?.address);
  const pickAddress = (hit: AddressHit) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            address: hit.address,
            postNumber: hit.postalCode,
            postSted: hit.city || hit.municipalityName,
            country: 'Norge', // Kartverket only has Norwegian addresses
          }
        : current
    );
    setPicked(true);
    const coord = { latitude: hit.lat, longitude: hit.lng };
    pinSet.current = true;
    setSelectedCoordinate(coord);
    animateTo(coord);
  };

  const save = () => {
    if (!userId || !original || !canSave) return;
    const changed: Record<string, string> = {};
    const trimmedAddress = draft.address.trim();
    const trimmedPostSted = draft.postSted.trim();
    const normalizedPostNumber = formatPostalCode(draft.postNumber);
    if (trimmedAddress !== original.address.trim()) changed.address = trimmedAddress;
    if (normalizedPostNumber !== original.postNumber) changed.postNumber = normalizedPostNumber;
    if (trimmedPostSted !== original.postSted.trim()) changed.postSted = trimmedPostSted;
    if (draft.country !== original.country) changed.country = draft.country;
    if (Object.keys(changed).length === 0) return;

    update.mutate(
      { userId, data: changed },
      {
        onSuccess: () => {
          const next: Draft = {
            address: trimmedAddress,
            postNumber: normalizedPostNumber,
            postSted: trimmedPostSted,
            country: draft.country,
          };
          setOriginal(next);
          setDraft(next);
          Alert.alert('Adressene er lagret', 'Endringene dine er oppdatert.');
        },
        onError: (error: unknown) => Alert.alert('Kunne ikke lagre', errorMessage(error)),
      }
    );
  };

  const leave = () => {
    if (!dirty) return router.back();
    Alert.alert('Forkast endringer?', 'Endringene dine blir ikke lagret.', [
      { text: 'Fortsett å redigere', style: 'cancel' },
      { text: 'Forkast', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
      {/* Top bar: back arrow (as on the other settings pages) · title · round save button
          (as on Lagrede lister). Both buttons are 40 px, so the title stays centred. */}
      <View className="h-14 flex-row items-center justify-between border-b border-line bg-page px-4">
        <GlassBackButton label="Innstillinger" onPress={leave} />
        <Text className="text-[1.0625rem] font-semibold text-ink">Adresse</Text>
        <Pressable
          onPress={save}
          disabled={!canSave}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Lagre"
          accessibilityState={{ disabled: !canSave, busy: update.isPending }}
          className={`h-10 w-10 items-center justify-center rounded-full ${canSave ? 'bg-brand' : 'bg-line'}`}
        >
          {update.isPending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Check size={18} color={canSave ? '#FFFFFF' : TC.muted} />
          )}
        </Pressable>
      </View>

      <KeyboardAvoidingView className="flex-1" behavior="padding">
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        >
          <Text className="mb-5 px-1 text-[0.875rem] leading-5 text-muted">
            Søk etter adressen, velg på kartet eller skriv den inn. Den lagres på Jobblo-kontoen
            din.
          </Text>

          <View
            className="mb-6"
            onLayout={(e) => {
              searchY.current = e.nativeEvent.layout.y;
            }}
          >
            <AddressSearchField
              onFocus={showSearch}
              // The whole address on one line ("Borggata 8, 0650 Oslo"); Gateadresse below
              // holds only the street.
              value={[draft.address, [draft.postNumber, draft.postSted].filter(Boolean).join(' ')]
                .filter(Boolean)
                .join(', ')}
              confirmed={addressConfirmed}
              offerSaved={false}
              confirmedText="Adressen er funnet"
              idleText="Skriv adressen og velg et forslag, eller trykk i kartet."
              onSelect={pickAddress}
              // A new search leaves the fields below alone until a suggestion is picked.
              onClear={() => setPicked(false)}
            />
          </View>

          {/* Map */}
          <SectionLabel>Velg på kartet</SectionLabel>
          <Card className="mb-6 overflow-hidden">
            <View style={{ height: 260 }} className="w-full bg-surface-2">
              {MAPS_AVAILABLE ? (
                <MapView
                  ref={mapRef}
                  provider={MAP_PROVIDER}
                  style={StyleSheet.absoluteFill}
                  mapType="standard"
                  // Uncontrolled: a `region` prop re-centred the map on every render, so it
                  // snapped back whenever the user panned. animateTo() moves it on purpose.
                  initialRegion={
                    selectedCoordinate
                      ? { ...selectedCoordinate, latitudeDelta: 0.02, longitudeDelta: 0.02 }
                      : DEFAULT_REGION
                  }
                  showsUserLocation={permission.status === 'granted'}
                  showsMyLocationButton={false}
                  showsCompass
                  rotateEnabled={false}
                  pitchEnabled={false}
                  moveOnMarkerPress={false}
                  onPress={handleMapPress}
                  onPoiClick={handlePoiClick}
                >
                  {selectedCoordinate ? (
                    // The platform's own pin, as on the job map: a custom view with
                    // tracksViewChanges={false} was snapshotted before it laid out on Android
                    // and showed nothing.
                    <Marker
                      coordinate={selectedCoordinate}
                      draggable
                      onDragEnd={handleMarkerDragEnd}
                      pinColor={TC.brandText}
                    />
                  ) : null}
                </MapView>
              ) : (
                <MapUnavailable />
              )}

              {isGeocoding ? (
                <View
                  className="absolute left-3 top-3 flex-row items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5"
                  pointerEvents="none"
                >
                  <ActivityIndicator size="small" color={TC.brandText} />
                  <Text className="text-[0.8125rem] font-medium text-ink-2">Finner adresse…</Text>
                </View>
              ) : null}
            </View>

            <View className="flex-row items-center gap-3 border-t border-line-soft px-4 py-3">
              <Text className="flex-1 text-[0.8125rem] leading-5 text-muted">
                {permissionMessage || 'Trykk på kartet, eller dra merket til riktig sted.'}
              </Text>
              <Pressable
                onPress={() => void locateAndUse()}
                disabled={isLocating}
                accessibilityRole="button"
                accessibilityLabel="Bruk min posisjon"
                className="flex-row items-center gap-1.5 rounded-full bg-tint px-3.5 py-2"
              >
                {isLocating ? (
                  <ActivityIndicator size="small" color={TC.brandText} />
                ) : (
                  <Crosshair size={15} color={TC.brandText} />
                )}
                <Text className="text-[0.8125rem] font-semibold text-brand-text">
                  {isLocating ? 'Henter…' : 'Min posisjon'}
                </Text>
              </Pressable>
            </View>
          </Card>

          {/* Fields */}
          <SectionLabel>Adresse</SectionLabel>
          <Card className="overflow-hidden">
            <FormRow
              onFocus={showFields}
              label="Gateadresse"
              value={draft.address}
              onChangeText={(v) => {
                setTyped('address', v);
                setPicked(false);
              }}
              placeholder="Karl Johans gate 10"
              autoComplete="street-address"
            />
            <FormRow
              onFocus={showFields}
              divider
              label="Postnr."
              value={draft.postNumber}
              onChangeText={(v) => setTyped('postNumber', formatPostalCode(v))}
              placeholder="0150"
              maxLength={4}
              keyboardType="number-pad"
              autoComplete="postal-code"
              error={validation || undefined}
            />
            <FormRow
              onFocus={showFields}
              divider
              label="Sted"
              value={draft.postSted}
              onChangeText={(v) => set('postSted', v)}
              placeholder="Oslo"
            />
          </Card>

          <Text className="mt-4 px-1 text-[0.8125rem] leading-5 text-muted">
            Alle feltene er valgfrie, og tomme felt lagres som tomme.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
