import React from 'react';
import { Image, Text, View } from 'react-native';
import { ShieldCheck } from 'lucide-react-native';
import { SERVICE_SHOWCASE } from '../../utils/categoryImage';
import { TC } from '../../theme/colors';

/**
 * "No jobs" for a job list (Hjem, Utforsk), as on the web (frontend JobsEmptyState): three of
 * the services overlapped, a bold title, the next step and the SafePay line.
 */
export function JobsEmptyState({
  title,
  text,
  actions,
  reassure = true,
}: {
  title: string;
  text: string;
  actions?: React.ReactNode;
  reassure?: boolean;
}) {
  return (
    <View className="items-center overflow-hidden rounded-3xl bg-surface px-5 py-9">
      <View
        className="flex-row"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {SERVICE_SHOWCASE.slice(0, 3).map((s, i) => (
          <Image
            key={s.name}
            source={s.src}
            className="h-16 w-16 rounded-full border-4 border-surface"
            style={{ marginLeft: i ? -16 : 0, transform: [{ translateY: i === 1 ? -6 : 0 }] }}
          />
        ))}
      </View>
      <Text className="mt-5 text-center text-[1.25rem] font-bold text-ink">{title}</Text>
      <Text className="mt-2 text-center text-[0.9375rem] leading-6 text-muted">{text}</Text>
      {actions ? <View className="mt-6 w-full gap-2.5">{actions}</View> : null}
      {reassure ? (
        <View className="mt-5 flex-row items-center gap-1.5">
          <ShieldCheck size={14} color={TC.brandText} />
          <Text className="text-[0.8125rem] font-medium text-brand-text">
            Betaling holdes trygt til du har godkjent
          </Text>
        </View>
      ) : null}
    </View>
  );
}
