import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useColorScheme } from 'nativewind';

/**
 * The app's opening screen: the sprout from the logo grows (stem, then the two leaves), sways,
 * and a hairline sweeps under it — the web's PageLoader, animated. It sits over the router at
 * the native splash's size, place and colours, so the hand-off from the static splash is seamless,
 * and fades away once the stored session is read (and the intro has played once).
 *
 * Paths are traced from assets/splash-icon.png (1024 × 1024).
 */
const SIZE = 160; // app.json splash imageWidth
const INTRO_MS = 950;

const COLORS = {
  light: { bg: '#EFF0EA', stem: '#2F6844', left: '#1F4A2E', right: '#2F6844', track: '#E6E7E1' },
  dark: { bg: '#121411', stem: '#8FBE9A', left: '#8FBE9A', right: '#B8DCC2', track: '#2E322C' },
};

function Layer({ d, color, stroke }: { d: string; color: string; stroke?: boolean }) {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 1024 1024" style={StyleSheet.absoluteFill}>
      {stroke ? (
        <Path d={d} stroke={color} strokeWidth={70} strokeLinecap="round" fill="none" />
      ) : (
        <Path d={d} fill={color} />
      )}
    </Svg>
  );
}

export function BootSplash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const { colorScheme } = useColorScheme();
  const c = COLORS[colorScheme === 'dark' ? 'dark' : 'light'];
  const stem = useRef(new Animated.Value(0)).current;
  const left = useRef(new Animated.Value(0)).current;
  const right = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loops: Animated.CompositeAnimation[] = [];
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) {
        // Reduced motion: the finished sprout, no movement.
        [stem, left, right].forEach((v) => v.setValue(1));
        bar.setValue(0.4);
        setIntroDone(true);
        return;
      }
      const grow = (v: Animated.Value, delay: number, duration: number) =>
        Animated.timing(v, {
          toValue: 1,
          delay,
          duration,
          easing: Easing.out(Easing.back(1.6)),
          useNativeDriver: true,
        });
      Animated.parallel([
        Animated.timing(stem, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        grow(left, 300, 380),
        grow(right, 430, 420),
      ]).start();
      setTimeout(() => !cancelled && setIntroDone(true), INTRO_MS);

      const swayLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(sway, {
            toValue: 1,
            duration: 900,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(sway, {
            toValue: -1,
            duration: 1800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(sway, {
            toValue: 0,
            duration: 900,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      );
      const barLoop = Animated.loop(
        Animated.timing(bar, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        })
      );
      loops.push(swayLoop, barLoop);
      setTimeout(() => !cancelled && swayLoop.start(), 800);
      barLoop.start();
    });
    return () => {
      cancelled = true;
      loops.forEach((loop) => loop.stop());
    };
  }, [stem, left, right, sway, bar]);

  useEffect(() => {
    if (!ready || !introDone) return;
    Animated.timing(fade, {
      toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => finished && onDone());
  }, [ready, introDone, fade, onDone]);

  const trackWidth = SIZE;
  return (
    <Animated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Laster Jobblo"
      style={[
        StyleSheet.absoluteFill,
        styles.center,
        { backgroundColor: c.bg, opacity: fade, zIndex: 1000, elevation: 1000 },
      ]}
    >
      <Animated.View
        style={{
          width: SIZE,
          height: SIZE,
          // Sways from the foot of the stem.
          transformOrigin: '50% 83%',
          transform: [
            { rotate: sway.interpolate({ inputRange: [-1, 1], outputRange: ['-3deg', '3deg'] }) },
          ],
        }}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { transformOrigin: '50% 83%', transform: [{ scaleY: stem }] },
          ]}
        >
          <Layer d="M511 843 C505 740 503 620 512 512" color={c.stem} stroke />
        </Animated.View>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { transformOrigin: '50% 51.5%', transform: [{ scale: left }], opacity: left },
          ]}
        >
          <Layer d="M512 528 C440 410 300 365 172 392 C230 510 360 590 512 528 Z" color={c.left} />
        </Animated.View>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { transformOrigin: '51% 50%', transform: [{ scale: right }], opacity: right },
          ]}
        >
          <Layer d="M516 512 C560 350 700 220 888 190 C840 380 720 510 545 512 Z" color={c.right} />
        </Animated.View>
      </Animated.View>

      {/* The web loader's hairline: a 40 % segment travelling past both ends. */}
      <View style={[styles.track, { width: trackWidth, backgroundColor: c.track }]}>
        <Animated.View
          style={[
            styles.segment,
            {
              width: trackWidth * 0.4,
              backgroundColor: c.stem,
              transform: [
                {
                  translateX: bar.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-trackWidth * 0.4, trackWidth],
                  }),
                },
              ],
            },
          ]}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  // Out of the flow, so the sprout stays exactly where the native splash drew it.
  track: {
    position: 'absolute',
    top: '50%',
    marginTop: SIZE / 2 + 20,
    height: 2,
    borderRadius: 1,
    overflow: 'hidden',
  },
  segment: { height: 2, borderRadius: 1 },
});
