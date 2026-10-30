import React from 'react';
import { Platform, Pressable, View, type ViewStyle } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import { GlassView } from 'expo-glass-effect';
import { useColorScheme } from 'nativewind';
import { LIQUID_GLASS } from '../GlassTabBar';
import { TC } from '../../theme/colors';

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
          ? Platform.OS === 'ios'
            ? 'rgba(28,31,27,0.35)'
            : 'rgba(28,31,27,0.92)'
          : Platform.OS === 'ios'
            ? 'rgba(255,255,255,0.35)'
            : 'rgba(255,255,255,0.92)',
      };
  return style;
}

export function GlassFill({
  radius,
  interactive,
  tint,
  solid,
}: {
  radius: number;
  interactive?: boolean;
  tint?: string;
  /**
   * For glass that floats over content to be read (the chat's pinned job card): a
   * page-coloured veil over the glass, so bubbles behind it don't show through the text.
   */
  solid?: boolean;
}) {
  // The app's own theme, not "auto": the theme can be set in the app (Innstillinger), and
  // glass left on auto could keep the previous scheme after a switch.
  const dark = useColorScheme().colorScheme === 'dark';
  const veil = solid ? (dark ? 'rgba(28,31,27,0.72)' : 'rgba(255,255,255,0.72)') : undefined;
  const fill = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius,
  } as const;
  if (LIQUID_GLASS)
    return (
      <GlassView
        glassEffectStyle="regular"
        isInteractive={interactive}
        tintColor={tint ?? veil}
        colorScheme={dark ? 'dark' : 'light'}
        style={fill}
        pointerEvents="none"
      />
    );
  if (Platform.OS === 'ios')
    return (
      <>
        <BlurView
          intensity={60}
          tint={dark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
          style={fill}
          pointerEvents="none"
        />
        {veil ? <View style={[fill, { backgroundColor: veil }]} pointerEvents="none" /> : null}
      </>
    );
  return null;
}

/** Round glass button (job page over the photo, post-job header). */
export function GlassButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
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

/**
 * The back button of every sub-screen (FINN's "‹" in a glass circle). `label` is where it
 * goes, read out to screen readers ("Tilbake til Innstillinger"); it is not drawn.
 */
export function GlassBackButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <GlassButton label={`Tilbake til ${label}`} onPress={onPress}>
      <ChevronLeft size={22} color={TC.ink} />
    </GlassButton>
  );
}
