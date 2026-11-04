import React, { useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Linking, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banknote,
  Bell,
  Briefcase,
  MessageSquare,
  Settings2,
  Star,
  UserCheck,
  type LucideIcon,
} from 'lucide-react-native';
import { ScreenHeader } from '../../../../src/components/ui/ScreenHeader';
import {
  deactivateRegisteredPushToken,
  getPushPermission,
  getPushPreferences,
  getRegisteredPushToken,
  registerPushNotifications,
  updatePushPreferences,
  type PushPreferences,
} from '../../../../src/services/pushNotifications.service';
import { TC, tc } from '../../../../src/theme/colors';

/** The groups the backend filters pushes by (services/notifications PUSH_GROUPS). */
const GROUPS: { key: keyof PushPreferences; label: string; hint: string; Icon: LucideIcon }[] = [
  { key: 'messages', label: 'Meldinger', hint: 'Nye meldinger i chat', Icon: MessageSquare },
  {
    key: 'applications',
    label: 'Søknader',
    hint: 'Når noen søker på oppdraget ditt, eller du blir valgt',
    Icon: UserCheck,
  },
  {
    key: 'orders',
    label: 'Oppdrag og betaling',
    hint: 'Betaling, start, levering og godkjenning',
    Icon: Banknote,
  },
  { key: 'reviews', label: 'Vurderinger', hint: 'Når noen gir deg en vurdering', Icon: Star },
  {
    key: 'jobs',
    label: 'Oppdrag du følger',
    hint: 'Endringer på oppdrag du har lagret',
    Icon: Briefcase,
  },
];

const PREFS_KEY = ['push-preferences'] as const;

function SwitchRow({
  Icon,
  label,
  hint,
  value,
  disabled,
  onChange,
  last,
}: {
  Icon: LucideIcon;
  label: string;
  hint: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  last?: boolean;
}) {
  return (
    <View
      className={`flex-row items-center gap-3 px-4 py-3.5 ${last ? '' : 'border-b border-line'} ${disabled ? 'opacity-50' : ''}`}
    >
      <View className="h-10 w-10 items-center justify-center rounded-xl bg-tint">
        <Icon size={18} color={TC.brandText} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[0.9375rem] font-semibold text-ink">{label}</Text>
        <Text className="mt-0.5 text-[0.8125rem] leading-5 text-muted">{hint}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: TC.brand, false: tc('#D9DBD3', 'line') }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

export default function NotificationsSettingsScreen() {
  const queryClient = useQueryClient();
  const [permission, setPermission] = useState<
    'granted' | 'denied' | 'undetermined' | 'unavailable'
  >('undetermined');
  const [registered, setRegistered] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const expoGo = permission === 'unavailable';
  const pushOn = permission === 'granted' && registered;

  const refresh = async () => {
    setLoading(true);
    try {
      setPermission(await getPushPermission());
      setRegistered(Boolean(await getRegisteredPushToken()));
    } catch {
      setPermission('unavailable');
      setRegistered(false);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const openSettings = () => void Linking.openSettings().catch(() => undefined);
  const enable = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await registerPushNotifications();
      setPermission(result.status);
      setRegistered(result.registered);
      if (!result.registered && result.status === 'denied')
        setError('Varsler er ikke tillatt. Åpne systeminnstillingene for å aktivere dem.');
    } catch {
      setError('Kunne ikke registrere denne enheten. Prøv igjen i en development build.');
    } finally {
      setLoading(false);
    }
  };
  const disable = async () => {
    setLoading(true);
    setError('');
    try {
      await deactivateRegisteredPushToken({ optOut: true });
      setRegistered(false);
    } catch {
      setError('Kunne ikke slå av push-varsler. Prøv igjen.');
    } finally {
      setLoading(false);
    }
  };

  // Per-group switches: saved at once, the switch moves first and moves back on an error.
  const prefs = useQuery({ queryKey: PREFS_KEY, queryFn: getPushPreferences });
  const save = useMutation({
    mutationFn: updatePushPreferences,
    onMutate: async (patch) => {
      setError('');
      await queryClient.cancelQueries({ queryKey: PREFS_KEY });
      const before = queryClient.getQueryData<PushPreferences>(PREFS_KEY);
      if (before) queryClient.setQueryData(PREFS_KEY, { ...before, ...patch });
      return { before };
    },
    onError: (_e, _patch, context) => {
      if (context?.before) queryClient.setQueryData(PREFS_KEY, context.before);
      setError('Kunne ikke lagre valget. Prøv igjen.');
    },
    onSuccess: (saved) => queryClient.setQueryData(PREFS_KEY, saved),
  });

  const status = loading
    ? 'Sjekker…'
    : expoGo
      ? 'Fungerer ikke i Expo Go. Bruk appen fra App Store / Google Play.'
      : permission === 'denied'
        ? 'Blokkert av telefonen. Slå på varsler i systeminnstillingene.'
        : pushOn
          ? 'På for denne telefonen'
          : 'Av for denne telefonen';

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 36 }}>
        <ScreenHeader
          title="Varslingsinnstillinger"
          subtitle="Velg hvilke push-varsler du vil få"
          icon={Bell}
        />

        <View className="overflow-hidden rounded-3xl bg-surface">
          <SwitchRow
            Icon={Bell}
            label="Push-varsler"
            hint={status}
            value={pushOn}
            disabled={loading || expoGo || permission === 'denied'}
            onChange={(on) => void (on ? enable() : disable())}
            last
          />
        </View>
        {Platform.OS !== 'web' && !expoGo && permission === 'denied' ? (
          <Pressable
            onPress={openSettings}
            className="mt-3 flex-row items-center justify-center rounded-xl border border-line bg-surface px-4 py-3"
          >
            <Settings2 size={16} color={TC.brandText} />
            <Text className="ml-2 text-sm font-semibold text-ink">Åpne innstillinger</Text>
          </Pressable>
        ) : null}

        <Text className="mb-2 ml-1 mt-6 text-[0.8125rem] font-semibold uppercase tracking-[0.12em] text-muted">
          Varsle meg om
        </Text>
        <View className="overflow-hidden rounded-3xl bg-surface">
          {GROUPS.map(({ key, label, hint, Icon }, i) => (
            <SwitchRow
              key={key}
              Icon={Icon}
              label={label}
              hint={hint}
              value={prefs.data?.[key] ?? true}
              disabled={!pushOn || !prefs.data}
              onChange={(on) => save.mutate({ [key]: on })}
              last={i === GROUPS.length - 1}
            />
          ))}
        </View>

        {error ? (
          <Text className="mt-3 text-[0.8125rem] text-[#B4544A] dark:text-danger">{error}</Text>
        ) : prefs.isError ? (
          <Text className="mt-3 text-[0.8125rem] text-[#B4544A] dark:text-danger">
            Kunne ikke hente valgene dine. Dra ned eller åpne siden på nytt.
          </Text>
        ) : null}
        <Text className="mt-4 px-1 text-[0.8125rem] leading-5 text-muted">
          {pushOn
            ? 'Det du slår av her, vises fortsatt under Varsler i appen — du får bare ikke push på telefonen.'
            : 'Slå på push-varsler for å velge hva du vil bli varslet om.'}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
