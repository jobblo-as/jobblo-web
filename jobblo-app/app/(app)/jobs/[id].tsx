import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  Pressable,
  Share,
  FlatList,
  Linking,
  Platform,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { GlassButton } from '../../../src/components/ui/GlassButton';
import { jobPoint } from '../../../src/utils/jobPoint';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { setStatusBarStyle } from 'expo-status-bar';
import { useFocusEffect, useIsFocused, useLocalSearchParams, useRouter, type ErrorBoundaryProps } from 'expo-router';
import {
  ArrowLeft,
  Heart,
  BadgeCheck,
  ChevronRight,
  Flag,
  MapPin,
  MessageCircle,
  ShieldCheck,
  Share2,
  Star,
  Zap,
} from 'lucide-react-native';
import { useJobDetails } from '../../../src/hooks/useJobDetails';
import { useApplyMutation } from '../../../src/hooks/useApplyMutation';
import { useConnectStatus } from '../../../src/hooks/usePayout';
import { useMyJobRequests } from '../../../src/hooks/useMyApplications';
import { useIsServiceSaved } from '../../../src/hooks/useFavoriteLists';
import { useAuthStore } from '../../../src/store/authStore';
import { ErrorState } from '../../../src/components/ui/ErrorState';
import { EmptyState } from '../../../src/components/ui/EmptyState';
import { ApplyModal } from '../../../src/components/domain/ApplyModal';
import { SaveToListSheet } from '../../../src/components/domain/SaveToListSheet';
import { ReportJobSheet } from '../../../src/components/domain/ReportJobSheet';
import { JobAreaMap } from '../../../src/components/domain/JobAreaMap';
import { ImageViewer } from '../../../src/components/ui/ImageViewer';
import { categoryImage } from '../../../src/utils/categoryImage';
import { serviceStatusLabel } from '../../../src/components/domain/ServiceStatusBadge';
import { MEMBERSHIP_ENABLED } from '../../../src/config/features';
import { EQUIPMENT_LABELS, type Job } from '../../../src/types/Jobs';
import { JobDetailSkeleton } from '../../../src/components/skeletons/ScreenSkeletons';
import { TC, tc } from '../../../src/theme/colors';

function formatDate(value?: string, withTime = false) {
  if (!value) return 'Ikke angitt';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Ikke angitt';

  return date.toLocaleDateString('nb-NO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

function formatDuration(duration?: Job['duration']) {
  if (!duration?.value) return null;
  const unit = duration.unit === 'minutes' ? 'minutter' : duration.unit === 'days' ? 'dager' : 'timer';
  return `${duration.value} ${unit}`;
}

/** "3. nov. – 5. nov.", or "Fra 3. nov. · fleksibel" without an end date. */
function formatWhen(from?: string, to?: string) {
  if (!from) return null;
  return to ? `${formatDate(from)} – ${formatDate(to)}` : `Fra ${formatDate(from)} · fleksibel`;
}

/** Round white button floating over the listing photo (FINN style). */
/** The fixed buttons sit 8 px under the notch (6 px + a 44 px row, like Hjem's sticky header). */
const HEADER_TOP = 6;
const HEADER_ROW = 44;
const HEADER_HEIGHT = HEADER_TOP + HEADER_ROW + 10;


/** FINN's key facts: label left in grey, value next to it, one row per fact. */
function Fact({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View className="flex-row py-1.5">
      <Text className="w-[38%] text-[0.9375rem] text-muted">{label}</Text>
      <Text className="flex-1 text-[0.9375rem] text-ink">{value}</Text>
    </View>
  );
}

/** A flat page section (FINN: heading + content on the page, no card), divided by a hairline. */
function Section({ title, children, divider = true }: { title?: string; children: React.ReactNode; divider?: boolean }) {
  return (
    <View className={`px-4 py-6 ${divider ? 'border-t border-line-soft' : ''}`}>
      {title ? <Text className="mb-3 text-[1.25rem] font-bold tracking-[-0.01em] text-ink">{title}</Text> : null}
      {children}
    </View>
  );
}

/**
 * Expo Router's per-route boundary: a render error on this page shows what went wrong (and lets
 * the user retry or go back) instead of a blank or red screen, and logs it for the console.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const router = useRouter();
  React.useEffect(() => {
    console.error('[job page] render error:', error);
  }, [error]);
  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
      <ErrorState
        title="Kunne ikke vise oppdraget"
        message={`Noe gikk galt på siden.\n\n${error?.message ?? ''}`}
        actionLabel="Prøv igjen"
        onAction={() => void retry()}
      />
      <Pressable onPress={() => router.back()} accessibilityRole="button" className="mb-8 items-center py-3">
        <Text className="text-[0.9375rem] font-semibold text-brand-text">Tilbake</Text>
      </Pressable>
    </SafeAreaView>
  );
}

/**
 * Job page laid out like FINN's listing page (client spec, "FINN listing detail page"): photos →
 * "Legg til favoritt" → title → price with the safe-payment badge → main button → safe-payment
 * box → key facts → description → job owner card → area → "Om annonsen" → breadcrumb.
 * "Kjøp nå" is "Søk på oppdraget", "Fiks ferdig" is SafePay, the seller card is the job owner.
 */
export default function JobDetailsScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { user, isAuthenticated } = useAuthStore();
  const { data: job, isLoading, isError, refetch } = useJobDetails(id ?? '');
  const requestsQuery = useMyJobRequests(isAuthenticated && !!id);
  const connectStatusQuery = useConnectStatus(isAuthenticated);
  useFocusEffect(
    React.useCallback(() => {
      if (isAuthenticated) void connectStatusQuery.refetch();
    }, [connectStatusQuery.refetch, isAuthenticated])
  );
  /** Scrolled past the photos: the page colour goes behind the status bar. */
  const [pastPhoto, setPastPhoto] = React.useState(false);
  // The status-bar strip fades in and out, like Hjem's.
  const barFade = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(barFade, { toValue: pastPhoto ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  }, [barFade, pastPhoto]);
  const isFocused = useIsFocused();
  // Light status-bar icons over the dark photo area; the theme's own once the header turns solid.
  React.useEffect(() => {
    if (!isFocused) return;
    setStatusBarStyle(pastPhoto ? 'auto' : 'light');
    return () => setStatusBarStyle('auto');
  }, [isFocused, pastPhoto]);
  const [isApplyModalOpen, setIsApplyModalOpen] = React.useState(false);
  const [applyError, setApplyError] = React.useState<string | null>(null);
  const [saveSheetVisible, setSaveSheetVisible] = React.useState(false);
  const [reportVisible, setReportVisible] = React.useState(false);
  const [activeImage, setActiveImage] = React.useState(0);
  const [viewerIndex, setViewerIndex] = React.useState<number | null>(null);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { isSaved, isLoading: savedLoading } = useIsServiceSaved(id ?? '');

  const { mutate: applyToJob, isPending: isApplyLoading } = useApplyMutation({
    onSuccess: () => {
      setIsApplyModalOpen(false);
      setApplyError(null);
      // Modal closes, success toast is shown by parent if needed
    },
    onError: (error: any) => {
      const errorData = error.response?.data;
      let errorMessage = 'Kunne ikke sende forespørsel. Prøv igjen senere.';

      if (error.response?.status === 403 && errorData?.isDelayed) {
        const minutesLeft = Math.ceil((new Date(errorData.unlockAt).getTime() - Date.now()) / 60000);
        errorMessage = `Du må vente ${minutesLeft} minutter før du kan søke på nytt.`;
      } else if (error.response?.status === 402) {
        errorMessage = MEMBERSHIP_ENABLED
          ? 'Du har nådd din månedlige grense for kontakter. Oppgrader planen din for å søke videre.'
          : 'Du har nådd din månedlige grense for kontakter.';
      } else if (errorData?.code === 'STRIPE_CONNECT_REQUIRED') {
        void connectStatusQuery.refetch();
        errorMessage = 'Du må fullføre og verifisere Stripe Connect-kontoen din før du kan sende forespørsler eller starte oppdrag.';
      } else if (errorData?.error) {
        errorMessage = String(errorData.error);
      } else if (errorData?.message) {
        errorMessage = String(errorData.message);
      } else if (error.message) {
        errorMessage = String(error.message);
      }

      setApplyError(errorMessage);
    },
  });

  const poster = typeof job?.userId === 'object' && job.userId ? job.userId : null;
  const isOwner = !!poster && !!user && String((user as any)._id ?? (user as any).id) === String(poster._id ?? '');
  const isClosed = job?.status === 'closed' || job?.status === 'completed' || job?.status === 'cancelled' || job?.status === 'expired';
  const currentUserId = user ? String((user as any)._id ?? (user as any).id ?? '') : '';
  const hasPendingRequest = (requestsQuery.data ?? []).some((request) => {
    const serviceId = typeof request.serviceId === 'object' ? request.serviceId?._id : request.serviceId;
    const customerId = typeof request.customerId === 'object' ? request.customerId?._id : request.customerId;
    if (!serviceId || !customerId) return false;
    return String(serviceId) === String(id) && String(customerId) === currentUserId && request.status === 'pending';
  });
  const imageList = Array.isArray(job?.images) && job.images.length > 0 ? job.images : [];

  const primaryCtaLabel = !isAuthenticated
    ? 'Logg inn for å søke'
    : isClosed
      ? 'Oppdraget er lukket'
      : hasPendingRequest
        ? 'Forespørsel sendt'
        : 'Søk på oppdraget';
  const primaryDisabled = isAuthenticated && (isClosed || hasPendingRequest);

  const handleShare = async () => {
    if (!job) return;
    const url = `https://jobblo.no/jobs/${id}`;
    const message = `${job.title}\n\n${url}`;
    await Share.share({ message, url });
  };

  const requireLogin = (then: () => void) => {
    if (!isAuthenticated) {
      router.push('/(auth)/login');
      return;
    }
    then();
  };

  const handlePrimaryAction = () =>
    requireLogin(() => {
      if (isOwner || isClosed || hasPendingRequest) return;
      setApplyError(null);
      setIsApplyModalOpen(true);
    });

  const handleApplySubmit = (payload: any) => {
    if (connectStatusQuery.data?.payoutReady !== true) return;
    applyToJob({
      serviceId: id ?? '',
      message: payload.message,
    });
  };

  if (isLoading) {
    return (
      <SafeAreaView edges={['left', 'right']} className="flex-1 bg-page">
        <JobDetailSkeleton />
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
        <ErrorState
          title="Kunne ikke laste oppdraget"
          message="Sjekk internettforbindelsen din og prøv igjen."
          actionLabel="Prøv igjen"
          onAction={() => refetch()}
        />
      </SafeAreaView>
    );
  }

  if (!job) {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
        <EmptyState
          title="Oppdraget finnes ikke"
          message="Annonsen er kanskje fjernet, eller lenken er feil."
        />
      </SafeAreaView>
    );
  }

  const area = job.location?.city || 'Norge';
  // The maps app opens on the job's pin (on the city when the job has no point).
  const openArea = () => {
    const point = jobPoint(job.location?.coordinates);
    const q = encodeURIComponent(area);
    const at = point ? `${point.latitude},${point.longitude}` : '';
    void Linking.openURL(
      Platform.OS === 'ios'
        ? point ? `http://maps.apple.com/?ll=${at}&q=${q}` : `http://maps.apple.com/?q=${q}`
        : point ? `geo:${at}?q=${at}(${q})` : `geo:0,0?q=${q}`
    );
  };
  const photoHeight = Math.round(width * 0.8);
  const priceLabel = job.paymentType === 'Timepris' ? 'Timepris' : job.paymentType === 'Anbud' ? 'Anbud · antatt budsjett' : 'Fastpris';
  const priceText =
    job.paymentType === 'Timepris' && job.hourlyRate
      ? `${job.hourlyRate.toLocaleString('nb-NO')} kr/t`
      : job.price
        ? `${job.price.toLocaleString('nb-NO')} kr`
        : 'Pris ikke satt';
  const ownerName = poster ? poster.companyName || [poster.name, poster.lastName].filter(Boolean).join(' ') || 'Oppdragsgiver' : '';

  return (
    <SafeAreaView edges={['left', 'right']} className="flex-1 bg-surface">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        scrollEventThrottle={16}
        onScroll={(e) => {
          const past = e.nativeEvent.contentOffset.y > photoHeight - HEADER_HEIGHT;
          if (past !== pastPhoto) setPastPhoto(past);
        }}
      >
        {/* Photos: swipe edge to edge, the whole photo shown (FINN letterboxes), tap for full screen. */}
        {/* The dark band fills the status bar / notch; the photos start below it, so none is hidden. */}
        <View className="bg-[#1C1D1A]" style={{ height: photoHeight + insets.top, paddingTop: insets.top }}>
          {imageList.length > 0 ? (
            <FlatList
              data={imageList}
              keyExtractor={(uri, index) => `${uri}-${index}`}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setActiveImage(Math.round(e.nativeEvent.contentOffset.x / width))}
              renderItem={({ item, index }) => (
                <Pressable
                  onPress={() => setViewerIndex(index)}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={`Bilde ${index + 1} av ${imageList.length}. Vis i full størrelse`}
                  style={{ width, height: photoHeight }}
                >
                  <Image source={{ uri: item }} style={{ width, height: photoHeight }} resizeMode="contain" />
                </Pressable>
              )}
            />
          ) : (
            <Image source={categoryImage(job.categories)} style={{ width, height: photoHeight }} resizeMode="cover" />
          )}

          <View pointerEvents="none" className="absolute bottom-3 left-3 flex-row flex-wrap gap-2">
            {job.urgent && (
              <View className="flex-row items-center gap-1 rounded-full bg-brand-deep px-2.5 py-1.5">
                <Zap size={12} color="#FFFFFF" fill="#FFFFFF" />
                <Text className="text-[0.8125rem] font-semibold text-white">Haster</Text>
              </View>
            )}
            {job.promoted && (
              <View className="flex-row items-center gap-1 rounded-full bg-white/95 px-2.5 py-1.5">
                <Zap size={12} color="#2E6641" fill="#2E6641" />
                <Text className="text-[0.8125rem] font-semibold text-[#55584F]">Sponset</Text>
              </View>
            )}
          </View>
          {imageList.length > 1 ? (
            <View pointerEvents="none" className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1">
              <Text className="text-[0.8125rem] font-semibold text-white">
                {Math.min(activeImage, imageList.length - 1) + 1}/{imageList.length}
              </Text>
            </View>
          ) : null}

        </View>

        {/* FINN: "♡ Legg til favoritt" left, "8 har lagt til som favoritt" right. */}
        <View className="flex-row items-center justify-between px-4 pt-3">
          {!isOwner ? (
            <Pressable onPress={() => requireLogin(() => setSaveSheetVisible(true))} accessibilityRole="button" hitSlop={8} className="flex-row items-center gap-1.5 active:opacity-70">
              <Heart size={17} color={isSaved ? '#B4453A' : TC.brandText} fill={isSaved ? '#B4453A' : 'none'} />
              <Text className="text-[0.9375rem] font-medium text-brand-text">{isSaved ? 'Lagret som favoritt' : 'Legg til favoritt'}</Text>
            </Pressable>
          ) : (
            <View />
          )}
          {typeof job.views === 'number' && job.views > 0 ? (
            <Text className="text-[0.8125rem] text-muted">
              {job.views.toLocaleString('nb-NO')} har sett annonsen
            </Text>
          ) : null}
        </View>

        {/* Title */}
        <View className="px-4 pt-4">
          <Text className="text-[1.625rem] font-bold leading-[1.2] tracking-[-0.02em] text-ink">{job.title || 'Uten tittel'}</Text>
        </View>

        {/* Price (FINN: "Til salgs" + price + "Trygg betaling", the "Fiks ferdig" badge on the right) */}
        <View className="px-4 pt-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-[0.9375rem] text-ink">{priceLabel}</Text>
            <View className="flex-row items-center gap-1 rounded-md bg-tint px-2 py-1">
              <ShieldCheck size={13} color={TC.brandText} />
              <Text className="text-[0.8125rem] font-semibold text-brand-text">SafePay</Text>
            </View>
          </View>
          <Text className="mt-1 text-[2rem] font-bold leading-[1.15] tracking-[-0.03em] text-ink">{priceText}</Text>
          <Text className="mt-1 text-[0.875rem] text-muted">Betales trygt med SafePay · {area}</Text>
        </View>

        {/* Main button(s), FINN "Kjøp nå" */}
        <View className="gap-2.5 px-4 pt-5">
          {isOwner ? (
            <>
              <TouchableOpacity
                onPress={() => router.push({ pathname: '/(app)/job-applicants/[serviceId]', params: { serviceId: id ?? '' } })}
                className="h-12 items-center justify-center rounded-lg bg-brand"
                activeOpacity={0.9}
              >
                <Text className="text-[1.0625rem] font-semibold text-white">Se søkere</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push({ pathname: '/(app)/create-job', params: { editId: id ?? '' } })}
                className="h-12 items-center justify-center rounded-lg border border-brand-text"
                activeOpacity={0.9}
              >
                <Text className="text-[1.0625rem] font-semibold text-brand-text">Rediger oppdraget</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              onPress={handlePrimaryAction}
              disabled={primaryDisabled}
              accessibilityState={{ disabled: primaryDisabled }}
              className={`h-12 items-center justify-center rounded-lg ${primaryDisabled ? 'bg-surface-2' : 'bg-brand'}`}
              activeOpacity={0.9}
            >
              <Text className={`text-[1.0625rem] font-semibold ${primaryDisabled ? 'text-muted' : 'text-white'}`}>{primaryCtaLabel}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Safe-payment box (FINN: "Trygg handel med Fiks ferdig") */}
        <View className="px-4 pt-5">
          <View className="flex-row gap-3 rounded-xl border border-line p-4">
            <ShieldCheck size={22} color={TC.brandText} />
            <View className="flex-1">
              <Text className="text-[1.0625rem] font-semibold text-ink">Trygg handel med SafePay</Text>
              <Text className="mt-1 text-[0.875rem] leading-5 text-ink-2">
                Pengene holdes trygt hos Jobblo til du har godkjent jobben. Starter ikke utføreren innen fristen, får du alt tilbake – og blir dere uenige, hjelper Jobblo dere.
              </Text>
            </View>
          </View>
        </View>

        {/* FINN: "Hvis du lurer på noe om varen, så send en melding til selger" */}
        {!isOwner ? (
          <View className="flex-row items-start gap-2 px-4 pt-4">
            <MessageCircle size={16} color={tc('#63665F', 'muted')} style={{ marginTop: 2 }} />
            <Text className="flex-1 text-[0.875rem] leading-5 text-muted">
              Lurer du på noe om oppdraget? Søk på oppdraget, så kan du og oppdragsgiveren sende meldinger til hverandre.
            </Text>
          </View>
        ) : null}

        {/* Key facts (FINN: Tilstand · Merke · Modell) */}
        <Section>
          <Fact label="Type" value={job.customerType === 'business' ? 'Bedriftsoppdrag' : job.customerType === 'private' ? 'Privat oppdrag' : null} />
          <Fact label="Kategori" value={job.categories?.length ? job.categories.join(', ') : null} />
          <Fact label="Varighet" value={formatDuration(job.duration)} />
          <Fact label="Utstyr" value={job.equipment ? EQUIPMENT_LABELS[job.equipment] ?? null : null} />
          <Fact label="Når" value={formatWhen(job.fromDate, job.toDate)} />
          <Fact label="Status" value={job.status ? serviceStatusLabel(job.status) : null} />
        </Section>

        {/* Description (FINN: "Beskrivelse av varen") */}
        <Section title="Beskrivelse av oppdraget">
          <Text className="text-[1.0625rem] leading-[1.55] text-ink">{job.description || 'Ingen beskrivelse tilgjengelig.'}</Text>
          {job.tags?.length > 0 ? (
            <View className="mt-4 flex-row flex-wrap gap-2">
              {job.tags.map((tag) => (
                <View key={tag} className="rounded-full bg-surface-2 px-3 py-1.5">
                  <Text className="text-[0.8125rem] font-medium text-ink-2">{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </Section>

        {/* Job owner card (FINN seller card: name, BankID, member since, reviews) */}
        {poster ? (
          <Section>
            <Pressable
              onPress={() => router.push({ pathname: '/(app)/profile/[userId]', params: { userId: String(poster._id) } })}
              accessibilityRole="button"
              accessibilityLabel={`Se profilen til ${ownerName}`}
              className="flex-row items-center gap-3.5 rounded-xl border border-line p-4 active:bg-surface-2"
            >
              <View className="h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-tint">
                {poster.avatarUrl ? (
                  <Image source={{ uri: poster.avatarUrl }} className="h-full w-full" resizeMode="cover" />
                ) : (
                  <Text className="text-[1.0625rem] font-semibold text-brand-text">{ownerName.charAt(0).toUpperCase()}</Text>
                )}
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-[1.0625rem] font-semibold text-ink" numberOfLines={1}>{ownerName}</Text>
                {poster.verified ? (
                  <View className="mt-1 flex-row items-center gap-1">
                    <BadgeCheck size={14} color={TC.brandText} />
                    <Text className="text-[0.8125rem] font-medium text-brand-text">Verifisert med BankID</Text>
                  </View>
                ) : null}
                {/* As on the website: "Bedrift" for companies, no badge for private people. */}
                {poster.role === 'company' || poster.createdAt ? (
                  <Text className="mt-1 text-[0.8125rem] text-muted">
                    {[poster.role === 'company' ? 'Bedrift' : '', poster.createdAt ? `Har vært på Jobblo siden ${new Date(poster.createdAt).getFullYear()}` : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                ) : null}
                <View className="mt-1.5 flex-row items-center gap-1">
                  <Star size={13} color={TC.brandText} fill={poster.averageRating ? TC.brandText : 'none'} />
                  <Text className="text-[0.8125rem] text-ink-2">
                    {poster.averageRating
                      ? `${poster.averageRating.toFixed(1)} · ${poster.reviewCount ?? 0} ${poster.reviewCount === 1 ? 'vurdering' : 'vurderinger'}`
                      : 'Ingen vurderinger ennå'}
                    {poster.completedJobs ? ` · ${poster.completedJobs} fullførte med SafePay` : ''}
                  </Text>
                </View>
              </View>
              <ChevronRight size={18} color={tc('#9B9E96', 'subtle')} />
            </Pressable>
          </Section>
        ) : null}

        {/* Where (FINN: "📍 2818 Gjøvik" + map): the area only, never the street address. */}
        <Section title="Hvor er jobben?">
          <JobAreaMap coordinates={job.location?.coordinates} area={area} onPress={openArea} />
          <Pressable onPress={openArea} accessibilityRole="link" accessibilityLabel={`Vis ${area} i kart`} className="mt-3 flex-row items-center gap-1.5 self-start active:opacity-70">
            <MapPin size={16} color={TC.brandText} />
            <Text className="text-[0.9375rem] font-medium text-brand-text">{area}</Text>
          </Pressable>
        </Section>

        {/* About the listing (FINN: "Om annonsen" · FINN-kode · Sist endret) */}
        <Section title="Om annonsen">
          <Fact label="Oppdrags-ID" value={id ? id.slice(-8).toUpperCase() : null} />
          <Fact label="Lagt ut" value={formatDate(job.createdAt, true)} />
          <Fact label="Sist endret" value={job.updatedAt ? formatDate(job.updatedAt, true) : null} />
          {!isOwner ? (
            <Pressable onPress={() => requireLogin(() => setReportVisible(true))} accessibilityRole="button" className="mt-3 flex-row items-center gap-1.5 self-start active:opacity-70">
              <Flag size={14} color={TC.brandText} />
              <Text className="text-[0.875rem] font-medium text-brand-text">Rapporter svindel eller regelbrudd</Text>
            </Pressable>
          ) : null}

          {/* Breadcrumb (FINN: "FINN / Elektronikk og hvitevarer / Telefoner") */}
          <Text className="mt-5 text-[0.8125rem] text-muted">
            Jobblo{job.categories?.[0] ? ` / ${job.categories[0]}` : ''} / {area}
          </Text>
        </Section>
      </ScrollView>

      {/* Like Hjem: once the photo has scrolled away, the page colour sits behind the status bar so
          nothing runs under the clock. */}
      <Animated.View
        pointerEvents="none"
        className="absolute left-0 right-0 top-0 bg-page"
        style={{ height: insets.top, opacity: barFade, zIndex: 30, elevation: 30, shadowColor: 'transparent' }}
      />

      {/* Fixed over the scroll view (FINN): the glass buttons stay at the top while the page scrolls. */}
      <View
        pointerEvents="box-none"
        className="absolute left-0 right-0 top-0 flex-row items-center justify-between px-4"
        style={{ marginTop: insets.top + HEADER_TOP, height: HEADER_ROW, zIndex: 40, elevation: 40, shadowColor: 'transparent' }}
      >
        <GlassButton label="Tilbake" onPress={() => router.back()}>
          <ArrowLeft size={19} color={TC.ink} />
        </GlassButton>
        <View className="flex-row gap-2.5">
          <GlassButton label="Del oppdrag" onPress={() => void handleShare()}>
            <Share2 size={18} color={TC.ink} />
          </GlassButton>
          {/* Lagre i liste: on every job, your own too (it was hidden there). */}
          <GlassButton label={isSaved ? 'Fjern fra lagrede lister' : 'Lagre i liste'} onPress={() => requireLogin(() => setSaveSheetVisible(true))}>
            {savedLoading ? <View className="h-4 w-4" /> : <Heart size={18} color={isSaved ? '#B4453A' : TC.ink} fill={isSaved ? '#B4453A' : 'none'} />}
          </GlassButton>
        </View>
      </View>

      <ImageViewer images={imageList} index={viewerIndex} onClose={() => setViewerIndex(null)} />

      {isApplyModalOpen ? (
        <ApplyModal
          visible
          onClose={() => setIsApplyModalOpen(false)}
          onSubmit={handleApplySubmit}
          jobTitle={job?.title}
          isLoading={isApplyLoading}
          error={applyError}
          connectStatus={
            connectStatusQuery.isLoading
              ? 'loading'
              : connectStatusQuery.isError
                ? 'unavailable'
                : connectStatusQuery.data?.payoutReady === true
                  ? 'ready'
                  : 'required'
          }
          onGoToPayout={() => router.push('/profile/settings/payout')}
        />
      ) : null}

      <SaveToListSheet visible={saveSheetVisible} onClose={() => setSaveSheetVisible(false)} serviceId={id ?? ''} serviceTitle={job?.title} />
      <ReportJobSheet visible={reportVisible} serviceId={id ?? ''} onClose={() => setReportVisible(false)} />
    </SafeAreaView>
  );
}
