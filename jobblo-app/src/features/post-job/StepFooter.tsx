import React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { LIQUID_GLASS } from '../../components/GlassTabBar';
import { GlassFill } from '../../components/ui/GlassButton';

const BRAND = '#2E6641';

interface StepFooterProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** A quiet text link under the main button (e.g. "Hopp over"). */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /**
   * A green glass button floating over the screen (no bar): the content scrolls under it, so the
   * screen needs ~96 px bottom padding. Liquid Glass on iOS 26, blur on older iOS, solid on Android.
   */
  glass?: boolean;
}

/** The one main action of a screen, pinned above the tab bar. */
export function StepFooter({ label, onPress, disabled, secondaryLabel, onSecondary, glass }: StepFooterProps) {
  if (glass) {
    return (
      <View pointerEvents="box-none" className="absolute bottom-0 left-0 right-0 px-4 pb-3 pt-3">
        <Pressable
          onPress={onPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: Boolean(disabled) }}
          className={`h-12 items-center justify-center rounded-full active:opacity-85 ${disabled ? 'opacity-50' : ''}`}
          style={
            LIQUID_GLASS
              ? undefined
              : Platform.OS === 'ios'
                ? { overflow: 'hidden', backgroundColor: 'rgba(46,102,65,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' }
                : { backgroundColor: BRAND, elevation: 6 }
          }
        >
          <GlassFill radius={24} interactive tint={BRAND} />
          <Text className="text-[0.9375rem] font-semibold text-white">{label}</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View className="border-t border-line bg-page px-4 pb-3 pt-3">
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: Boolean(disabled) }}
        className={`h-12 items-center justify-center rounded-full bg-brand active:opacity-85 ${disabled ? 'opacity-50' : ''}`}
      >
        <Text className="text-[0.9375rem] font-semibold text-white">{label}</Text>
      </Pressable>
      {secondaryLabel && onSecondary ? (
        <Pressable onPress={onSecondary} accessibilityRole="button" className="mt-2 h-10 items-center justify-center">
          <Text className="text-[0.875rem] font-semibold text-brand-text">{secondaryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
