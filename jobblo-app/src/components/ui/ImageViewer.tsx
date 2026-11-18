import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { shouldClose } from '../../utils/swipeToClose';

interface ImageViewerProps {
  images: string[];
  /** Index to open at; null = closed. */
  index: number | null;
  onClose: () => void;
}

/**
 * Full-screen photo viewer: swipe sideways between images, pinch to zoom, swipe down to close.
 *
 * ponytail: pinch-zoom uses the native ScrollView zoom, which only exists on iOS. Android gets
 * swipe + full-screen without zoom; upgrade to a reanimated pinch gesture if Android needs it.
 */
export function ImageViewer({ images, index, onClose }: ImageViewerProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(index ?? 0);
  const [zoomed, setZoomed] = useState(false);
  const dragY = useRef(new Animated.Value(0)).current;
  const dragX = useRef(new Animated.Value(0)).current;
  // With one photo there is nothing to swipe to, so a sideways swipe closes it too.
  const single = images.length <= 1;

  useEffect(() => {
    if (index !== null) {
      setCurrent(index);
      setZoomed(false);
      dragY.setValue(0);
      dragX.setValue(0);
    }
  }, [index, dragY, dragX]);

  // Swipe up or down to close (sideways too with one photo; with several, sideways changes the
  // photo). Off while zoomed, so panning a zoomed photo does not close it.
  const swipeAway = Gesture.Pan()
    .runOnJS(true)
    .enabled(!zoomed)
    .activeOffsetY([-15, 15])
    .activeOffsetX(single ? [-15, 15] : [-1000, 1000])
    .failOffsetX(single ? [-1000, 1000] : [-15, 15])
    .onUpdate((event) => {
      dragY.setValue(event.translationY);
      if (single) dragX.setValue(event.translationX);
    })
    .onEnd((event) => {
      if (shouldClose(event, single)) onClose();
      else
        Animated.parallel([
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true }),
          Animated.spring(dragX, { toValue: 0, useNativeDriver: true }),
        ]).start();
    });

  // Fades as the photo is dragged away, whichever way.
  const backdrop = Animated.add(
    dragY.interpolate({
      inputRange: [-300, 0, 300],
      outputRange: [300, 0, 300],
      extrapolate: 'clamp',
    }),
    dragX.interpolate({
      inputRange: [-300, 0, 300],
      outputRange: [300, 0, 300],
      extrapolate: 'clamp',
    })
  ).interpolate({ inputRange: [0, 300], outputRange: [1, 0.3], extrapolate: 'clamp' });

  return (
    <Modal
      visible={index !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View style={{ flex: 1, backgroundColor: 'black', opacity: backdrop }}>
          <GestureDetector gesture={swipeAway}>
            <Animated.View
              style={{ flex: 1, transform: [{ translateX: dragX }, { translateY: dragY }] }}
            >
              <FlatList
                data={images}
                horizontal
                pagingEnabled
                // One photo: the sideways swipe belongs to closing, not to this list.
                scrollEnabled={!zoomed && !single}
                showsHorizontalScrollIndicator={false}
                initialScrollIndex={index ?? 0}
                getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
                keyExtractor={(uri, i) => `${uri}-${i}`}
                onMomentumScrollEnd={(event) =>
                  setCurrent(Math.round(event.nativeEvent.contentOffset.x / width))
                }
                renderItem={({ item }) => (
                  <ScrollView
                    style={{ width, height }}
                    contentContainerStyle={{ width, height }}
                    // Only pans once zoomed: unzoomed, its vertical drag took the gesture, so
                    // swiping the photo away did nothing and only the X closed the viewer.
                    // Pinch-zoom still works with scrolling off.
                    scrollEnabled={zoomed}
                    bounces={zoomed}
                    maximumZoomScale={4}
                    minimumZoomScale={1}
                    centerContent
                    bouncesZoom
                    showsHorizontalScrollIndicator={false}
                    showsVerticalScrollIndicator={false}
                    scrollEventThrottle={32}
                    onScroll={(event) => setZoomed((event.nativeEvent.zoomScale ?? 1) > 1.01)}
                  >
                    <Image source={{ uri: item }} style={{ width, height }} resizeMode="contain" />
                  </ScrollView>
                )}
              />
            </Animated.View>
          </GestureDetector>

          <View
            pointerEvents="box-none"
            style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16 }}
            className="flex-row items-center justify-between"
          >
            <Text className="text-[0.9375rem] font-semibold text-white">
              {images.length > 1 ? `${current + 1} / ${images.length}` : ''}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Lukk bildevisning"
              className="h-10 w-10 items-center justify-center rounded-full bg-white/20"
            >
              <X size={20} color="#FFFFFF" />
            </Pressable>
          </View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}
