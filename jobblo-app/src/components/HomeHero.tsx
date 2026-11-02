import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Image, Pressable, Text, View } from 'react-native';
import { Locate, Plus, ShieldCheck } from 'lucide-react-native';
import { SERVICE_SHOWCASE } from '../utils/categoryImage';
import { useColorScheme } from 'nativewind';
import { TC } from '../theme/colors';

const FALLBACK_WORDS = ['maling', 'flytting', 'hagearbeid', 'rørlegger', 'rengjøring'];
const WORD_MS = 2400; // same rhythm as the website hero
const PHOTO_MS = 4600;
const PHOTO = 92;

interface HomeHeroProps {
  /** e.g. "Høst · Oslo" */
  eyebrow: string;
  /** Category names; the headline cycles the first six. */
  categories: string[];
  onPost: () => void;
  onNearby: () => void;
}

/**
 * Light website-style hero: "Jeg trenger hjelp til <word>" with the word rising into place,
 * a small round photo that cross-fades (decoration only; the categories live in the grid
 * below), and the two actions. Light mode: the website's brand-green card with white text (the
 * pale tint melted into the page); dark mode: the dark green tint.
 * Motion stops when the phone asks for reduced motion.
 */
export function HomeHero({ eyebrow, categories, onPost, onNearby }: HomeHeroProps) {
  const dark = useColorScheme().colorScheme === 'dark';
  const onCard = dark ? TC.brandText : '#FFFFFF';
  const words = categories.length
    ? categories.slice(0, 6).map((name) => name.toLowerCase())
    : FALLBACK_WORDS;
  const [word, setWord] = useState(0);
  const [photo, setPhoto] = useState(0);
  const wordIn = useRef(new Animated.Value(1)).current;
  const fades = useRef(SERVICE_SHOWCASE.map((_, i) => new Animated.Value(i === 0 ? 1 : 0))).current;

  useEffect(() => {
    let cancelled = false;
    const timers: Array<ReturnType<typeof setInterval>> = [];
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce || cancelled) return;
      timers.push(setInterval(() => setWord((i) => i + 1), WORD_MS));
      timers.push(setInterval(() => setPhoto((i) => (i + 1) % SERVICE_SHOWCASE.length), PHOTO_MS));
    });
    return () => {
      cancelled = true;
      timers.forEach(clearInterval);
    };
  }, []);

  // The new word rises in from below, like the website's `jb-word-in`.
  useEffect(() => {
    if (!word) return;
    wordIn.setValue(0);
    Animated.timing(wordIn, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, [word, wordIn]);

  useEffect(() => {
    Animated.parallel(
      fades.map((value, i) =>
        Animated.timing(value, {
          toValue: i === photo ? 1 : 0,
          duration: 800,
          useNativeDriver: true,
        })
      )
    ).start();
  }, [photo, fades]);

  return (
    <View className="mt-4 overflow-hidden rounded-[28px] bg-brand dark:bg-tint">
      {/* The soft light behind the photo, as on the website. */}
      <View
        pointerEvents="none"
        className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 dark:bg-brand/15"
      />

      <View className="flex-row items-center px-5 pt-5">
        <View className="min-w-0 flex-1 pr-3">
          <Text className="text-[0.8125rem] font-semibold uppercase tracking-[0.14em] text-white/80 dark:text-brand-text">
            {eyebrow}
          </Text>
          <Text className="mt-1.5 text-[1.5rem] font-bold leading-tight tracking-[-0.02em] text-white dark:text-ink">
            Jeg trenger hjelp til
          </Text>
          <View className="h-9 overflow-hidden">
            <Animated.View
              style={{
                opacity: wordIn,
                transform: [
                  { translateY: wordIn.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
                ],
              }}
            >
              <Text
                // Pale green on the brand card, as the website's second headline line.
                className="text-[1.5rem] font-bold leading-9 tracking-[-0.02em] text-[#B8DCC2] dark:text-brand-text"
                numberOfLines={1}
              >
                {words[word % words.length]}
              </Text>
            </Animated.View>
          </View>
        </View>

        {/* Decoration only: one small photo that slowly cross-fades. */}
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="overflow-hidden rounded-full border-4 border-surface bg-surface-2"
          style={{ width: PHOTO, height: PHOTO }}
        >
          {SERVICE_SHOWCASE.map((service, i) => (
            <Animated.View
              key={service.name}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                opacity: fades[i],
              }}
            >
              <Image
                source={service.src}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
            </Animated.View>
          ))}
        </View>
      </View>

      <View className="mt-4 flex-row gap-2.5 px-5">
        <Pressable
          onPress={onPost}
          className="h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-full bg-white dark:bg-brand active:opacity-90"
        >
          <Plus size={17} color={dark ? '#FFFFFF' : TC.brand} />
          <Text className="text-[0.9375rem] font-semibold text-brand dark:text-white">
            Legg ut oppdrag
          </Text>
        </Pressable>
        <Pressable
          onPress={onNearby}
          className="h-11 flex-row items-center justify-center gap-1.5 rounded-full border border-white/40 bg-white/10 px-4 dark:border-transparent dark:bg-surface active:opacity-90"
        >
          <Locate size={16} color={onCard} />
          <Text className="text-[0.9375rem] font-semibold text-white dark:text-brand-text">
            Nær meg
          </Text>
        </Pressable>
      </View>

      <View className="flex-row items-center gap-1.5 px-5 pb-4 pt-3">
        <ShieldCheck size={14} color={onCard} />
        <Text className="text-[0.8125rem] font-medium text-white/90 dark:text-brand-text">
          Betaling holdes trygt til du har godkjent
        </Text>
      </View>
    </View>
  );
}
