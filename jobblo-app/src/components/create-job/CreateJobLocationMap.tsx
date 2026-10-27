import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Crosshair, Layers, Locate } from 'lucide-react-native';
import MapView, { Marker, type LatLng, type MapPressEvent } from 'react-native-maps';
import * as Location from 'expo-location';
import { MAP_PROVIDER, MAPS_AVAILABLE } from '@/utils/mapProvider';
import { MapUnavailable } from '@/components/ui/MapUnavailable';
import { TC } from '../../theme/colors';
import { t } from '../../features/post-job/i18n';

// Norway, around Oslo, until there is a point.
const DEFAULT_REGION = {
  latitude: 59.9127,
  longitude: 10.7461,
  latitudeDelta: 4.5,
  longitudeDelta: 7.5,
};

const confirmedCoordinate = (coordinates: [number, number]) =>
  coordinates[0] !== 0 || coordinates[1] !== 0;

interface CreateJobLocationMapProps {
  /** [lat, lng]; [0, 0] = not set. */
  coordinates: [number, number];
  /** A tap, a dragged pin or the phone's position. */
  onCoordinatesChange: (coordinates: [number, number]) => void;
  /** Looking up the address for the new point. */
  busy?: boolean;
  /** A finger is on the map: the parent ScrollView must stop scrolling, or it steals the pan/zoom. */
  onTouchingChange?: (touching: boolean) => void;
}

/**
 * The exact spot of the job: tap the map or drag the pin, or use the phone's position. Follows
 * the address picked in the search. The job page shows this same pin.
 */
export function CreateJobLocationMap({ coordinates, onCoordinatesChange, busy, onTouchingChange }: CreateJobLocationMapProps) {
  const mapRef = useRef<MapView | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [satellite, setSatellite] = useState(false);
  const hasMarker = confirmedCoordinate(coordinates);

  const animateTo = (coordinate: LatLng) => {
    mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 500);
  };

  const selectCoordinate = (coordinate: LatLng) => {
    setLocationError('');
    onCoordinatesChange([coordinate.latitude, coordinate.longitude]);
  };

  // An address picked in the search (or a tap) moves the map to the pin.
  useEffect(() => {
    if (hasMarker) animateTo({ latitude: coordinates[0], longitude: coordinates[1] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordinates[0], coordinates[1]]);

  const useCurrentLocation = async () => {
    if (isLocating) return;
    setIsLocating(true);
    setLocationError('');
    try {
      if (!(await Location.requestForegroundPermissionsAsync()).granted) {
        setLocationError(t('Posisjon er ikke tillatt. Trykk på kartet eller søk etter adressen.', 'Location is not allowed. Tap the map or search for the address.'));
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      selectCoordinate({ latitude: position.coords.latitude, longitude: position.coords.longitude });
    } catch {
      setLocationError(t('Kunne ikke hente posisjonen. Trykk på kartet eller søk etter adressen.', 'Could not get your location. Tap the map or search for the address.'));
    } finally {
      setIsLocating(false);
    }
  };

  return (
    <View className="gap-3">
      <View
        // Height as a style, not a class: a MapView in a box with no height draws nothing.
        style={{ height: 320 }}
        className="overflow-hidden rounded-xl border border-line bg-surface-2"
        onTouchStart={() => onTouchingChange?.(true)}
        onTouchEnd={() => onTouchingChange?.(false)}
        onTouchCancel={() => onTouchingChange?.(false)}
      >
        {MAPS_AVAILABLE ? (
          <MapView
            ref={mapRef}
            provider={MAP_PROVIDER}
            style={{ flex: 1 }}
            initialRegion={hasMarker ? { latitude: coordinates[0], longitude: coordinates[1], latitudeDelta: 0.01, longitudeDelta: 0.01 } : DEFAULT_REGION}
            onPress={(event: MapPressEvent) => selectCoordinate(event.nativeEvent.coordinate)}
            // Satellite photos with road and place names on top.
            mapType={satellite ? 'hybrid' : 'standard'}
            showsCompass
            toolbarEnabled={false}
          >
            {hasMarker ? (
              <Marker
                coordinate={{ latitude: coordinates[0], longitude: coordinates[1] }}
                draggable
                onDragEnd={(event) => selectCoordinate(event.nativeEvent.coordinate)}
                pinColor={TC.brandText}
              />
            ) : null}
          </MapView>
        ) : (
          <MapUnavailable />
        )}
        {MAPS_AVAILABLE ? (
          <Pressable
            onPress={() => setSatellite((on) => !on)}
            accessibilityRole="switch"
            accessibilityState={{ checked: satellite }}
            accessibilityLabel={t('Satellittkart', 'Satellite map')}
            className="absolute bottom-3 right-3 h-10 flex-row items-center gap-1.5 rounded-full bg-white/95 px-3.5 active:opacity-80"
          >
            <Layers size={16} color="#2E6641" />
            <Text className="text-[0.8125rem] font-semibold text-[#2E6641]">{satellite ? t('Kart', 'Map') : t('Satellitt', 'Satellite')}</Text>
          </Pressable>
        ) : null}
        {MAPS_AVAILABLE && (!hasMarker || busy) ? (
          <View className="absolute inset-x-0 top-3 items-center" pointerEvents="none">
            <View className="flex-row items-center gap-2 rounded-full bg-white/95 px-4 py-2">
              {busy ? <ActivityIndicator size="small" color={TC.brandText} /> : <Crosshair size={15} color={TC.brandText} />}
              <Text className="text-[0.8125rem] font-semibold text-[#2E6641]">
                {busy ? t('Finner adressen …', 'Finding the address …') : t('Trykk på kartet for å velge stedet', 'Tap the map to choose the place')}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      {locationError ? <Text className="text-[0.8125rem] font-medium text-danger">{locationError}</Text> : null}
      <Pressable
        onPress={() => void useCurrentLocation()}
        disabled={isLocating}
        accessibilityRole="button"
        className="h-11 flex-row items-center justify-center gap-2 rounded-full border border-line bg-surface px-4 active:bg-surface-2"
      >
        {isLocating ? <ActivityIndicator size="small" color={TC.brandText} /> : <Locate size={16} color={TC.brandText} />}
        <Text className="text-[0.9375rem] font-semibold text-brand-text">{isLocating ? t('Henter posisjon …', 'Finding you …') : t('Bruk min posisjon', 'Use my location')}</Text>
      </Pressable>
    </View>
  );
}
