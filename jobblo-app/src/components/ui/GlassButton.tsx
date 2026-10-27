import React from 'react';
import { Platform, Pressable, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView } from 'expo-glass-effect';
import { useColorScheme } from 'nativewind';
import { LIQUID_GLASS } from '../GlassTabBar';

/**
 * The tab bar's glass, for any rounded box: Liquid Glass on iOS 26, blur on older iOS,
 * near-opaque on Android (no cheap native blur). Put `style` on the box and `<GlassFill />`
 * as its first child.
 */
export function useGlass(radius: number) {
  const dark = useColorScheme().colorScheme === 'dark';
  const style: ViewStyle = LIQUID_GLASS
    ? { borderRadius: radius }
    : {
        borderRadius: radius,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.6)',
        backgroundColor: dark
          ? Platform.OS === 'ios' ? 'rgba(28,31,27,0.35)' : 'rgba(28,31,27,0.92)'
          : Platform.OS === 'ios' ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.92)',
      };
  return style;
}

export function GlassFill({ radius, interactive, tint }: { radius: number; interactive?: boolean; tint?: string }) {
  const fill = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius } as const;
  if (LIQUID_GLASS) return <GlassView glassEffectStyle="regular" isInteractive={interactive} tintColor={tint} colorScheme="auto" style={fill} pointerEvents="none" />;
  if (Platform.OS === 'ios') return <BlurView intensity={60} tint="systemChromeMaterial" style={fill} pointerEvents="none" />;
  return null;
}

/** Round glass button (job page over the photo, post-job header). */
export function GlassButton({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  const glass = useGlass(20);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      className="h-10 w-10 items-center justify-center rounded-full active:opacity-70"
      style={[glass, { elevation: LIQUID_GLASS ? 0 : 4 }]}
    >
      <GlassFill radius={20} interactive />
      {children}
    </Pressable>
  );
}
