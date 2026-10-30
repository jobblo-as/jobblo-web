import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Alert, Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { createURL } from 'expo-linking';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import {
  useConnectStatus,
  useCreateAccountLinkMutation,
  useRefreshStatusMutation,
} from '../../../../src/hooks/usePayout';
import type { ConnectStatusResponse } from '../../../../src/services/payout.service';
import { ErrorState } from '../../../../src/components/ui/ErrorState';
import { ScreenHeader } from '../../../../src/components/ui/ScreenHeader';
import { TC, tc } from '../../../../src/theme/colors';
import { PayoutSkeleton } from '../../../../src/components/skeletons/ScreenSkeletons';

// Same states, copy and labels as the web's PayoutSettingsView.
type AccountState = 'ready' | 'pending' | 'incomplete' | 'restricted' | 'none';

function getAccountState(s: ConnectStatusResponse): AccountState {
  if (!s.hasAccount || s.payoutOnboardingStatus === 'none') return 'none';
  if (s.payoutReady) return 'ready';
  if (s.payoutOnboardingStatus === 'restricted') return 'restricted';
  if (s.payoutOnboardingStatus === 'pending_verification') return 'pending';
  return 'incomplete';
}

const STATUS_COPY: Record<AccountState, { title: string; label: string; description: string }> = {
  ready: {
    title: 'Kontoen er verifisert',
    label: 'Klar for utbetalinger',
    description: 'Stripe Connect-kontoen din er verifisert og klar til å motta overføringer.',
  },
  pending: {
    title: 'Stripe gjennomgår opplysningene',
    label: 'Venter på verifisering',
    description:
      'Stripe gjennomgår opplysningene dine. Vi oppdaterer statusen når kontoen er klar.',
  },
  incomplete: {
    title: 'Oppsett ikke fullført',
    label: 'Handling kreves',
    description:
      'Fullfør Stripe Connect-oppsettet for å kunne sende forespørsler, starte oppdrag og motta utbetalinger.',
  },
  restricted: {
    title: 'Stripe trenger mer informasjon',
    label: 'Handling kreves',
    description:
      'Stripe har begrenset kontoen. Åpne Stripe for å se hvilke opplysninger eller verifiseringer som mangler.',
  },
  none: {
    title: 'Koble til Stripe Connect',
    label: 'Ikke tilkoblet',
    description:
      'Koble til Stripe Connect for å kunne sende forespørsler og motta betaling for oppdrag.',
  },
};

const ACTION_LABEL: Record<AccountState, string> = {
  ready: 'Administrer Stripe-konto',
  none: 'Koble til Stripe Connect',
  pending: 'Åpne Stripe-konto',
  restricted: 'Oppdater Stripe-opplysninger',
  incomplete: 'Fullfør Stripe Connect-oppsett',
};

const PROCESS_STEPS = [
  { title: 'Kunden betaler', description: 'Kunden fullfører betalingen gjennom SafePay.' },
  {
    title: 'Oppdraget godkjennes',
    description: 'Du fullfører jobben, og kunden godkjenner arbeidet.',
  },
  {
    title: 'Overføring til Stripe Connect',
    description: 'Jobblo overfører tilgjengelige midler til Stripe-kontoen din.',
  },
  {
    title: 'Utbetaling til bankkonto',
    description: 'Stripe utbetaler til banken etter kontoens utbetalingsplan.',
  },
];

// Stripe opens in the app's own browser as an auth session (as Google/Vipps sign-in,
// utils/oauthAuthSession.ts): it closes itself when Stripe's return bridge hands off to the
// app, which a plain in-app sheet cannot do for exp:// links in Expo Go. Android: own task
// via the proxy activity, so the tab cannot draw itself back over Jobblo later.
const BROWSER_OPTIONS: WebBrowser.AuthSessionOpenOptions = {
  createTask: true,
  useProxyActivity: true,
  showTitle: true,
  toolbarColor: '#122A1C',
  controlsColor: '#2E6641',
  enableBarCollapsing: false,
};
const PAYOUT_RETURN_PATH = /profile\/settings\/payout/;

function getErrorInfo(error: unknown) {
  const err = error as {
    response?: { status?: number; data?: { error?: string; message?: string; code?: string } };
  };
  const status = err?.response?.status;
  const message = err?.response?.data?.error || err?.response?.data?.message;
  return { status, message, code: err?.response?.data?.code };
}

function dateLabel(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PayoutSettingsScreen() {
  const router = useRouter();
  const [platformSetupRequired, setPlatformSetupRequired] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const statusQuery = useConnectStatus();
  const accountLinkMutation = useCreateAccountLinkMutation();
  const refreshMutation = useRefreshStatusMutation();
  const stripeOpenRef = useRef(false);

  const { mutateAsync: refreshAsync } = refreshMutation;
  const { refetch } = statusQuery;

  // Web: refresh with Stripe, then a toast saying whether the account is ready.
  const refreshStatus = useCallback(
    async (showMessage = true) => {
      setRefreshError(null);
      try {
        await refreshAsync();
        const { data } = await refetch();
        if (showMessage) {
          setNotice(
            data?.payoutReady
              ? 'Stripe Connect er klar for utbetalinger.'
              : 'Stripe-statusen er oppdatert.'
          );
        }
      } catch (error) {
        setRefreshError(
          getErrorInfo(error).message || 'Stripe-status er midlertidig utilgjengelig. Prøv igjen.'
        );
      }
    },
    [refreshAsync, refetch]
  );

  // The way back from Stripe, once per opening: the auth session ending, or the bridge's deep
  // link reaching the app itself (a server prefix that differs from createURL's).
  const returnFromStripeRef = useRef(() => {});
  returnFromStripeRef.current = () => {
    if (!stripeOpenRef.current) return;
    stripeOpenRef.current = false;
    if (Platform.OS !== 'android') {
      try {
        WebBrowser.dismissAuthSession();
      } catch {
        // Already closed.
      }
    }
    void refreshStatus();
  };

  useEffect(() => {
    const deepLink = Linking.addEventListener('url', ({ url }) => {
      if (PAYOUT_RETURN_PATH.test(url ?? '')) returnFromStripeRef.current();
    });
    return () => deepLink.remove();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const handleAccountAction = async () => {
    setPlatformSetupRequired(false);
    try {
      const data = await accountLinkMutation.mutateAsync();
      const url = typeof data?.url === 'string' ? data.url.trim() : '';
      if (!url) {
        Alert.alert('Kunne ikke åpne Stripe', 'Stripe returnerte ingen kontolenke. Prøv igjen.');
        return;
      }
      stripeOpenRef.current = true;
      // Resolves when the bridge redirects back (sheet closes itself), the user closes it, or
      // (Android) the app is in front again — every one of them means "refresh the status".
      await WebBrowser.openAuthSessionAsync(
        url,
        createURL('profile/settings/payout'),
        BROWSER_OPTIONS
      );
      returnFromStripeRef.current();
    } catch (error) {
      if (stripeOpenRef.current) {
        stripeOpenRef.current = false;
        Alert.alert('Kunne ikke åpne Stripe', 'Kunne ikke åpne kontolenken. Prøv igjen.');
        return;
      }
      const info = getErrorInfo(error);
      if (info.code === 'STRIPE_CONNECT_PLATFORM_SETUP_REQUIRED') setPlatformSetupRequired(true);
      Alert.alert(
        'Kunne ikke åpne Stripe',
        info.status === 401
          ? 'Du må være innlogget for å sette opp utbetalinger.'
          : info.message || 'Sjekk internettforbindelsen din og prøv igjen.'
      );
    }
  };

  const handleCopyAccount = async (accountId: string) => {
    try {
      await Clipboard.setStringAsync(accountId);
      setNotice('Stripe-konto-ID kopiert.');
    } catch {
      Alert.alert('Kunne ikke kopiere konto-ID.');
    }
  };

  if (statusQuery.isLoading) {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
        <PayoutSkeleton />
      </SafeAreaView>
    );
  }

  if (statusQuery.isError || !statusQuery.data) {
    const info = getErrorInfo(statusQuery.error);
    const title = info.status === 401 ? 'Pålogging kreves' : 'Kunne ikke laste utbetalingsstatus';
    const message =
      info.status === 500
        ? 'Serverfeil. Prøv igjen litt senere.'
        : info.message || 'Utbetalingsstatusen kunne ikke hentes akkurat nå.';
    return (
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
        <ErrorState
          title={title}
          message={message}
          actionLabel="Prøv igjen"
          onAction={() => void statusQuery.refetch()}
        />
      </SafeAreaView>
    );
  }

  const status = statusQuery.data;
  const state = getAccountState(status);
  const copy = STATUS_COPY[state];
  const linking = accountLinkMutation.isPending;
  const refreshing = refreshMutation.isPending;
  const ready = state === 'ready';
  const StateIcon = ready ? ShieldCheck : state === 'pending' ? Clock3 : AlertCircle;

  const detailRows: [string, string][] = [
    ['Tilkoblingsstatus', copy.label],
    [
      'Identitetsverifisering',
      ready
        ? 'Fullført'
        : state === 'pending'
          ? 'Under behandling'
          : status.detailsSubmitted
            ? 'Opplysninger sendt'
            : state === 'none'
              ? 'Ikke tilkoblet'
              : 'Ikke fullført',
    ],
    [
      'Klar for overføringer',
      status.transfersEnabled ? 'Ja' : status.hasAccount ? 'Nei' : 'Ikke tilkoblet',
    ],
    [
      'Bankutbetalinger aktivert',
      status.payoutEnabled ? 'Ja' : status.hasAccount ? 'Nei' : 'Ikke tilkoblet',
    ],
  ];

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 36 }}
      >
        <ScreenHeader
          title="Utbetalinger"
          subtitle="Administrer Stripe Connect-kontoen din og se status for utbetalinger."
        />

        {status.mode === 'test' ? (
          <View className="mb-4 rounded-xl bg-surface-2 px-4 py-3">
            <Text className="text-[0.8125rem] font-semibold text-muted">Testmodus</Text>
            <Text className="mt-1 text-[0.8125rem] leading-5 text-muted">
              Dette er en testkonto. Ingen ekte bankoverføringer gjennomføres.
            </Text>
          </View>
        ) : null}

        {notice ? (
          <View
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            className="mb-4 flex-row items-center gap-2 rounded-xl border border-[#D1E7D9] bg-[#F2F9F4] px-4 py-3"
          >
            <CheckCircle2 size={16} color={TC.brandText} />
            <Text className="flex-1 text-[0.8125rem] font-medium text-[#173A24] dark:text-brand-text">
              {notice}
            </Text>
          </View>
        ) : null}

        {refreshError ? (
          <View
            accessibilityRole="alert"
            className="mb-4 rounded-2xl border border-line bg-surface p-4"
          >
            <View className="flex-row items-start gap-3">
              <AlertCircle size={18} color={tc('#63665F', 'muted')} />
              <Text className="flex-1 text-[0.8125rem] leading-5 text-ink">{refreshError}</Text>
            </View>
            <Pressable
              onPress={() => void refreshStatus(false)}
              disabled={refreshing}
              className="mt-3 min-h-10 flex-row items-center justify-center gap-2 self-start rounded-xl border border-line bg-page px-4"
            >
              {refreshing ? (
                <Loader2 size={16} color={tc('#30332F', 'ink')} />
              ) : (
                <RefreshCw size={15} color={tc('#30332F', 'ink')} />
              )}
              <Text className="text-sm font-semibold text-ink">Prøv igjen</Text>
            </Pressable>
          </View>
        ) : null}

        {platformSetupRequired ? (
          <View
            accessibilityRole="alert"
            className="mb-4 rounded-xl border border-warn-line bg-warn-tint px-4 py-3"
          >
            <Text className="text-[0.8125rem] leading-5 text-warn">
              Stripe Connect-oppsettet må fullføres av plattformadministratoren. Du trenger ikke
              gjøre flere forsøk nå.
            </Text>
          </View>
        ) : null}

        <View accessibilityLiveRegion="polite" className="rounded-2xl bg-surface p-5">
          <View className="flex-row items-start">
            <View
              className={[
                'mt-0.5 h-10 w-10 items-center justify-center rounded-xl',
                ready ? 'bg-[#EAF1E9]' : 'bg-surface-2',
              ].join(' ')}
            >
              <StateIcon size={20} color={ready ? TC.brandText : tc('#63665F', 'muted')} />
            </View>
            <View className="ml-3.5 flex-1">
              <Text className="text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-[#85887F]">
                Stripe Connect
              </Text>
              <Text className="mt-1 text-lg font-semibold text-ink">{copy.title}</Text>
              <Text className="mt-1.5 text-[0.8125rem] leading-5 text-muted">
                {copy.description}
              </Text>
              <View
                className={[
                  'mt-3 flex-row items-center gap-1.5 self-start rounded-full px-2.5 py-1',
                  ready ? 'bg-[#EAF1E9]' : 'bg-surface-2',
                ].join(' ')}
              >
                {ready ? (
                  <CheckCircle2 size={14} color={TC.brandText} />
                ) : (
                  <Info size={14} color={tc('#55584F', 'muted')} />
                )}
                <Text
                  className={[
                    'text-[0.75rem] font-semibold',
                    ready ? 'text-[#245536] dark:text-brand-text' : 'text-muted',
                  ].join(' ')}
                >
                  {copy.label}
                </Text>
              </View>
            </View>
          </View>

          <Pressable
            onPress={() => void handleAccountAction()}
            disabled={linking || refreshing || platformSetupRequired}
            accessibilityRole="button"
            className={[
              'mt-5 min-h-12 flex-row items-center justify-center gap-2 rounded-xl px-5 py-3',
              linking || refreshing || platformSetupRequired ? 'opacity-60' : '',
            ].join(' ')}
            style={{ backgroundColor: TC.brand }}
          >
            {linking ? (
              <Loader2 size={17} color="#FFFFFF" />
            ) : (
              <ExternalLink size={17} color="#FFFFFF" />
            )}
            <Text className="text-[0.9375rem] font-semibold text-white">
              {linking
                ? 'Åpner Stripe...'
                : platformSetupRequired
                  ? 'Venter på plattformadministrator'
                  : ACTION_LABEL[state]}
            </Text>
          </Pressable>

          {state === 'pending' ? (
            <Pressable
              onPress={() => void refreshStatus()}
              disabled={refreshing || linking}
              accessibilityRole="button"
              className="mt-2 min-h-10 flex-row items-center justify-center gap-2 rounded-xl px-3"
            >
              {refreshing ? (
                <Loader2 size={15} color={TC.brandText} />
              ) : (
                <RefreshCw size={15} color={TC.brandText} />
              )}
              <Text className="text-sm font-semibold text-brand-text">Sjekk status</Text>
            </Pressable>
          ) : null}
        </View>

        <View className="mt-3 rounded-2xl bg-surface p-5">
          <View className="mb-2 flex-row items-start justify-between gap-3">
            <View>
              <Text className="text-[0.9375rem] font-semibold text-ink">Kontoinformasjon</Text>
              <Text className="mt-1 text-[0.75rem] text-[#85887F]">Status hentet fra Stripe</Text>
            </View>
            {dateLabel(status.lastRefreshed) ? (
              <Text className="text-[0.75rem] text-[#85887F]">
                Oppdatert {dateLabel(status.lastRefreshed)}
              </Text>
            ) : null}
          </View>
          {detailRows.map(([label, value]) => (
            <View
              key={label}
              className="min-h-12 flex-row items-center justify-between gap-4 border-t border-[#F0F1EC] py-3"
            >
              <Text className="flex-1 text-[0.8125rem] text-muted">{label}</Text>
              <Text
                className={[
                  'text-right text-[0.8125rem] font-medium',
                  value === 'Ja' || value === 'Fullført'
                    ? 'text-[#245536] dark:text-brand-text'
                    : 'text-[#30332F] dark:text-ink',
                ].join(' ')}
              >
                {value}
              </Text>
            </View>
          ))}
          {status.accountId ? (
            <View className="min-h-12 flex-row items-center justify-between gap-4 border-t border-[#F0F1EC] py-3">
              <Text className="text-[0.8125rem] text-muted">Stripe-konto</Text>
              <View className="flex-row items-center gap-1">
                <Text className="font-mono text-[0.75rem] text-[#30332F] dark:text-ink">
                  {status.accountId.slice(0, 9)}…{status.accountId.slice(-4)}
                </Text>
                <Pressable
                  onPress={() => void handleCopyAccount(status.accountId as string)}
                  accessibilityRole="button"
                  accessibilityLabel="Kopier Stripe-konto-ID"
                  hitSlop={8}
                  className="h-8 w-8 items-center justify-center rounded-lg"
                >
                  <Copy size={14} color={tc('#63665F', 'muted')} />
                </Pressable>
              </View>
            </View>
          ) : null}
          {dateLabel(status.connectedAt) ? (
            <View className="min-h-12 flex-row items-center justify-between gap-4 border-t border-[#F0F1EC] py-3">
              <Text className="text-[0.8125rem] text-muted">Tilkoblet siden</Text>
              <Text className="text-[0.8125rem] font-medium text-[#30332F] dark:text-ink">
                {dateLabel(status.connectedAt)}
              </Text>
            </View>
          ) : null}
          {!ready ? (
            <Text className="mt-3 rounded-xl bg-surface-2 p-3 text-[0.8125rem] leading-5 text-muted">
              Fullfør Stripe Connect-oppsettet for å kunne sende forespørsler, starte oppdrag og
              motta utbetalinger.
            </Text>
          ) : null}
        </View>

        <View className="mt-3 rounded-2xl bg-surface p-5">
          <View className="flex-row items-start justify-between gap-4">
            <View className="flex-1">
              <Text className="text-[0.9375rem] font-semibold text-ink">
                Slik fungerer utbetalinger
              </Text>
              <Text className="mt-1 text-[0.8125rem] text-muted">
                Fire steg fra kundebetaling til bankutbetaling.
              </Text>
            </View>
            <Info size={17} color="#85887F" />
          </View>
          {PROCESS_STEPS.map((step, index) => (
            <View key={step.title} className="mt-4 flex-row gap-3">
              <View className="h-7 w-7 items-center justify-center rounded-full bg-surface-2">
                <Text className="text-[0.75rem] font-bold text-brand-text">{index + 1}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-[0.8125rem] font-semibold text-[#30332F] dark:text-ink">
                  {step.title}
                </Text>
                <Text className="mt-1 text-[0.75rem] leading-5 text-muted">{step.description}</Text>
              </View>
            </View>
          ))}
          <Text className="mt-5 border-t border-[#F0F1EC] pt-4 text-[0.75rem] leading-5 text-muted">
            En overføring til Stripe Connect betyr ikke at beløpet allerede er utbetalt til
            bankkontoen. Bankutbetaling følger Stripes utbetalingsplan.
          </Text>
          <Pressable
            onPress={() => router.push('/profile/settings/safepay')}
            className="mt-4 self-start py-2"
          >
            <Text className="text-sm font-semibold text-brand-text">
              Se transaksjonshistorikk →
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
