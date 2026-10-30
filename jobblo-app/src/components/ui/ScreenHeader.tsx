import React from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { type LucideIcon } from 'lucide-react-native';
import { cn } from '@/lib/utils';
import { TC, tc } from '../../theme/colors';
import { GlassBackButton } from './GlassButton';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Shown in a tinted tile beside the title. */
  icon?: LucideIcon;
  /** Text of the back link; null hides it. */
  backLabel?: string | null;
  /** Defaults to router.back(). */
  onBack?: () => void;
  /** Red icon tile, for destructive screens such as deleting the account. */
  destructive?: boolean;
  className?: string;
}

/**
 * The one header every sub-screen uses. With a back button it is FINN's bar: "‹" in a
 * glass circle, the title centred beside it, then the subtitle (with its icon) below.
 */
export function ScreenHeader({
  title,
  subtitle,
  icon: Icon,
  backLabel = 'Innstillinger',
  onBack,
  destructive = false,
  className,
}: ScreenHeaderProps) {
  const router = useRouter();
  return (
    <View className={cn('mb-5', className)}>
      {backLabel !== null ? (
        <>
          <View className="h-11 flex-row items-center">
            <GlassBackButton label={backLabel} onPress={onBack ?? (() => router.back())} />
            <Text
              numberOfLines={1}
              accessibilityRole="header"
              className="flex-1 px-2 text-center text-[1.0625rem] font-semibold text-ink"
            >
              {title}
            </Text>
            {/* Same width as the back button, so the title sits in the true centre. */}
            <View className="w-10" />
          </View>
          {subtitle ? (
            <View className="mt-4 flex-row items-center gap-3">
              {Icon ? (
                <View
                  className={cn(
                    'h-11 w-11 items-center justify-center rounded-2xl',
                    destructive ? 'bg-danger-tint' : 'bg-tint'
                  )}
                >
                  <Icon size={20} color={destructive ? tc('#B4544A', 'danger') : TC.brandText} />
                </View>
              ) : null}
              <Text className="min-w-0 flex-1 text-[0.875rem] leading-5 text-muted">
                {subtitle}
              </Text>
            </View>
          ) : null}
        </>
      ) : (
        <View className="flex-row items-center gap-3">
          {Icon ? (
            <View
              className={cn(
                'h-11 w-11 items-center justify-center rounded-2xl',
                destructive ? 'bg-danger-tint' : 'bg-tint'
              )}
            >
              <Icon size={20} color={destructive ? tc('#B4544A', 'danger') : TC.brandText} />
            </View>
          ) : null}
          <View className="min-w-0 flex-1">
            <Text className="text-[1.5rem] font-bold tracking-[-0.02em] text-ink">{title}</Text>
            {subtitle ? (
              <Text className="mt-0.5 text-[0.875rem] leading-5 text-muted">{subtitle}</Text>
            ) : null}
          </View>
        </View>
      )}
    </View>
  );
}
