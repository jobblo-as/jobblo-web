import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity } from 'react-native';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps {
  label: string;
  variant?: ButtonVariant;
  onPress?: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
  small?: boolean;
  /** A spinner in place of the icon while the action runs (the button is disabled too). */
  loading?: boolean;
}

export function Button({
  label,
  variant = 'primary',
  onPress,
  disabled = false,
  icon,
  fullWidth = false,
  small = false,
  loading = false,
}: ButtonProps) {
  const variantClass =
    variant === 'primary'
      ? 'bg-brand'
      : variant === 'secondary'
        ? 'bg-surface border border-line'
        : 'bg-transparent';

  const labelClass =
    variant === 'primary' ? 'text-white' : variant === 'secondary' ? 'text-ink' : 'text-muted';

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      className={[
        // gap: the icon sat glued to the label ("✓Velg og start SafePay").
        'flex-row items-center justify-center gap-2 rounded-full',
        variantClass,
        fullWidth ? 'w-full' : '',
        small ? 'px-3 py-2' : 'px-4 py-3',
        disabled && !loading ? 'opacity-60' : loading ? 'opacity-80' : '',
      ].join(' ')}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variant === 'primary' ? '#FFFFFF' : undefined} />
      ) : icon ? (
        <React.Fragment>{icon}</React.Fragment>
      ) : null}
      <Text className={['text-[0.875rem] font-semibold', labelClass].join(' ')}>{label}</Text>
    </TouchableOpacity>
  );
}
