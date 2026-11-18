import React from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { usePathname, useRouter } from 'expo-router';
import { edgeSwipeEnabled, isBackSwipe } from '../utils/edgeSwipe';

// Narrower than the 16 px page padding, so no button at the left edge loses its taps.
const EDGE_WIDTH = 14;

/**
 * Swipe from the left edge to go back, on the pages where the native stack cannot do it
 * (see edgeSwipeEnabled), on iOS and Android alike. A thin invisible strip along the left edge;
 * everything else on the page gets its touches as before.
 * ponytail: it goes back when the swipe ends, without the native interactive slide; an upgrade
 * is moving these pages into one stack above the tabs so iOS gives the real gesture.
 */
export function EdgeSwipeBack() {
  const pathname = usePathname();
  const router = useRouter();
  const enabled = edgeSwipeEnabled(pathname);

  const swipe = Gesture.Pan()
    .runOnJS(true)
    .enabled(enabled)
    .activeOffsetX(12)
    .failOffsetY([-20, 20])
    .onEnd((event) => {
      if (!isBackSwipe(event)) return;
      if (router.canGoBack()) router.back();
      else router.replace('/');
    });

  if (!enabled) return null;
  return (
    <GestureDetector gesture={swipe}>
      <View
        accessible={false}
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: EDGE_WIDTH, zIndex: 50 }}
      />
    </GestureDetector>
  );
}
