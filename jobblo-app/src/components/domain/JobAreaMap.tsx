import React from 'react';
import { Pressable, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { MAP_PROVIDER, MAPS_AVAILABLE } from '@/utils/mapProvider';
import { jobPoint } from '@/utils/jobPoint';
import { MapUnavailable } from '@/components/ui/MapUnavailable';
import { TC } from '../../theme/colors';

interface JobAreaMapProps {
  /** GeoJSON [lng, lat] from the API. */
  coordinates?: [number, number] | number[] | null;
  /** e.g. "Oslo": the label on the map. */
  area: string;
  /** Tap: open the place in the phone's maps app. */
  onPress: () => void;
}

/**
 * "Hvor er jobben?": a pin on the place the poster chose (PlaceStep), on a small, still map.
 * Lite mode on Android (a static image, cheap in a scroll view); no gestures, so the page scrolls
 * over it. Nothing when the job has no point.
 */
export function JobAreaMap({ coordinates, area, onPress }: JobAreaMapProps) {
  const point = jobPoint(coordinates);
  if (!point) return null;
  const region = { ...point, latitudeDelta: 0.012, longitudeDelta: 0.024 };

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Kart over ${area}. Åpne i kart-appen`} className="h-48 overflow-hidden rounded-xl border border-line bg-surface-2">
      {MAPS_AVAILABLE ? (
        <View pointerEvents="none" style={{ flex: 1 }}>
          <MapView
            provider={MAP_PROVIDER}
            style={{ flex: 1 }}
            initialRegion={region}
            liteMode
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            toolbarEnabled={false}
            showsPointsOfInterests={false}
          >
            <Marker coordinate={point} pinColor={TC.brandText} />
          </MapView>
        </View>
      ) : (
        <MapUnavailable />
      )}
      <View pointerEvents="none" className="absolute bottom-2 left-2 rounded-full bg-white/95 px-2.5 py-1">
        <Text className="text-[0.8125rem] font-semibold text-[#2E6641]">{area}</Text>
      </View>
    </Pressable>
  );
}
