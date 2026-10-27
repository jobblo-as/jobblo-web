import React, { useCallback, useEffect, useRef, useState } from 'react';
import { setStatusBarStyle } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppState, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import {
  Award,
  BadgeCheck,
  Bookmark,
  Briefcase,
  CalendarClock,
  ChevronRight,
  LogOut,
  MapPin,
  Megaphone,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useProfile } from '../../../src/hooks/useProfile';
import { usePublicProfile } from '../../../src/hooks/usePublicProfile';
import { useMyJobs } from '../../../src/hooks/useMyJobs';
import { useMyApplications } from '../../../src/hooks/useMyApplications';
import { useAuthStore } from '../../../src/store/authStore';
import { apiBaseUrl } from '../../../src/api/client';
import { ErrorState } from '../../../src/components/ui/ErrorState';
import { ConfirmDialog } from '../../../src/components/ui/ConfirmDialog';
import { DropdownMenu } from '../../../src/components/ui/DropdownMenu';
import {
  AddButton,
  Empty,
  Panel,
  ProfileIdentity,
  ProfileTabs,
  ProfileViewSwitch,
  RatingCard,
  ReliabilityCard,
  ReviewCard,
  dayDate,
  profileChips,
  type ProfileView,
} from '../../../src/components/profile/ProfileParts';
import { EmailVerificationRow } from '../../../src/components/profile/EmailVerificationRow';
import { TC, tc } from '../../../src/theme/colors';
import type { PublicUser } from '../../../src/types/UserProfile';
import { JobProfileSkeleton } from '../../../src/components/skeletons/ScreenSkeletons';

/**
 * Own profile, rebuilt to match the website (frontend/src/components/profile/ProfilePage.tsx):
 * sprout cover, identity card with "Rediger profil" + "…" menu and stat chips, the
 * Jobbsøker/Oppdragsgiver switch, the BankID card, tabs, rating breakdown, Pålitelighet and
 * the SafePay card. Stats come from GET /users/:id (same as the web); /auth/profile has none.
 */

const TABS: Record<'seeker' | 'poster' | 'company', string[]> = {
  seeker: ['Om meg', 'Fullførte', 'Vurderinger'],
  poster: ['Aktive', 'Tidligere', 'Vurderinger'],
  company: ['Om oss', 'Aktive', 'Tidligere', 'Vurderinger'],
};
const WEB_BASE = apiBaseUrl.replace(/\/api\/?$/, '');

function ListItem({
  title,
  meta,
  right,
  onPress,
}: {
  title: string;
  meta: string;
  right?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-2xl border border-line bg-surface p-4 active:bg-surface-2"
    >
      <View className="min-w-0 flex-1">
        <Text className="text-[0.9375rem] font-semibold text-ink" numberOfLines={1}>
          {title}
        </Text>
        <Text className="mt-0.5 text-[0.8125rem] text-muted" numberOfLines={1}>
          {meta}
        </Text>
      </View>
      {right ? <Text className="text-[0.9375rem] font-semibold text-ink">{right}</Text> : null}
      <ChevronRight size={18} color={tc('#9B9E96', 'subtle')} />
    </Pressable>
  );
}

/** "Jobbprofil" (from Min Jobblo): the website-style profile with cover, tabs and reviews. */
export default function JobProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tab?: string }>();
  const logout = useAuthStore((state) => state.logout);
  const { data: profile, isLoading, isError, refetch } = useProfile();
  const ownId = profile?._id ?? null;
  const statsQuery = usePublicProfile(ownId);
  const isCompany = profile?.role === 'company';
  const [profileType, setProfileType] = useState<ProfileView>('seeker');
  const tabs = isCompany ? TABS.company : TABS[profileType];
  const [tab, setTab] = useState(params.tab && tabs.includes(params.tab) ? params.tab : tabs[0]);
  const jobsQuery = useMyJobs();
  const applicationsQuery = useMyApplications({
    status: 'accepted',
    limit: 50,
    enabled: tab === 'Fullførte',
  });
  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuTop, setMenuTop] = useState<number | undefined>();
  const menuButton = useRef<React.ComponentRef<typeof View>>(null);
  const [logoutVisible, setLogoutVisible] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [openingBankId, setOpeningBankId] = useState(false);

  // The cover runs under the status bar: light icons on it while this screen is in front.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('auto');
    }, [])
  );

  // Companies only have the poster view.
  useEffect(() => {
    if (isCompany) setProfileType('poster');
  }, [isCompany]);
  const firstRender = useRef(true);
  useEffect(() => {
    // Keep a tab asked for in the link on first load; reset only when the view switches.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setTab(tabs[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileType, isCompany]);

  // Back from the BankID page in the browser: re-read the verified state.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && openingBankId) {
        setOpeningBankId(false);
        void refetch();
        void statsQuery.refetch();
      }
    });
    return () => sub.remove();
  }, [openingBankId, refetch, statsQuery]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetch(), statsQuery.refetch(), jobsQuery.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
      setLogoutVisible(false);
      router.replace('/(auth)/login');
    }
  };

  if (isLoading)
    return (
      <SafeAreaView edges={['left', 'right']} className="flex-1 bg-page">
        <JobProfileSkeleton />
      </SafeAreaView>
    );
  if (isError || !profile)
    return (
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
        <ErrorState
          title="Kunne ikke laste profilen"
          message="Profilen kunne ikke hentes akkurat nå."
          onAction={() => void refetch()}
        />
      </SafeAreaView>
    );

  // Computed stats from /users/:id when they have arrived, the stored profile otherwise.
  const user = { ...profile, ...(statsQuery.data ?? {}) } as PublicUser &
    typeof profile & { totalEarned?: number };
  const fullName = isCompany
    ? user.companyName || user.name || 'Bedrift'
    : [user.name, user.lastName].filter(Boolean).join(' ') || 'Bruker';
  const verified = user.identityVerified === true;
  const reviews = user.reviews ?? [];
  const reviewCount = reviews.length || user.reviewCount || 0;
  const edit = () => router.push('/profile/edit');

  const openMenu = () => {
    menuButton.current?.measureInWindow((_x, y, _w, h) => {
      setMenuTop(y + h + 6);
      setMenuOpen(true);
    });
  };

  const verifyWithBankId = async () => {
    // The BankID (Idura) flow returns to the website only, so it runs there.
    setOpeningBankId(true);
    let closed = true;
    try {
      // Android answers 'opened' at once and the AppState effect above handles the return.
      // iOS keeps the app active under the browser sheet, so AppState never fires there: the
      // promise resolving IS the return, and without this the button stayed on "Åpner BankID …".
      closed = (await WebBrowser.openBrowserAsync(`${WEB_BASE}/profile`)).type !== 'opened';
    } finally {
      if (closed) {
        setOpeningBankId(false);
        void refetch();
        void statsQuery.refetch();
      }
    }
  };

  const activeJobs = (jobsQuery.data ?? []).filter((job) =>
    ['open', 'pending', 'awaiting_payment', 'paid', 'in_progress', 'waiting_for_approval'].includes(
      job.status
    )
  );
  const pastJobs = (jobsQuery.data ?? []).filter((job) =>
    ['completed', 'closed', 'cancelled', 'expired'].includes(job.status)
  );
  const finished = (applicationsQuery.data?.applications ?? []).filter(
    (application) => application.order?.status === 'completed'
  );

  const renderJobs = (jobs: typeof activeJobs, emptyTitle: string, emptyText: string) =>
    jobs.length ? (
      <View className="gap-2.5">
        {jobs.map((job) => (
          <ListItem
            key={job._id}
            title={job.title}
            meta={`${dayDate(job.createdAt)}${job.location?.city ? ` · ${job.location.city}` : ''}`}
            right={
              typeof job.price === 'number' ? `${job.price.toLocaleString('nb-NO')} kr` : undefined
            }
            onPress={() => router.push({ pathname: '/(app)/jobs/[id]', params: { id: job._id } })}
          />
        ))}
      </View>
    ) : (
      <Empty
        title={emptyTitle}
        text={emptyText}
        action={
          <Pressable
            onPress={() => router.push('/(app)/create-job')}
            className="flex-row items-center gap-1.5 rounded-full bg-brand px-5 py-3"
          >
            <Plus size={16} color="#FFFFFF" />
            <Text className="font-semibold text-white">Legg ut oppdrag</Text>
          </Pressable>
        }
      />
    );

  return (
    <SafeAreaView edges={['left', 'right']} className="flex-1 bg-page">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            tintColor="#FFFFFF"
            colors={[TC.brandText]}
          />
        }
      >
        <ProfileIdentity
          user={user}
          fullName={fullName}
          topInset={insets.top}
          onBack={() => router.back()}
          chips={profileChips(user, profileType)}
          actions={
            <>
              <Pressable
                onPress={edit}
                className="h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-full bg-brand active:opacity-90"
              >
                <Pencil size={15} color="#FFFFFF" />
                <Text className="text-[0.9375rem] font-semibold text-white">Rediger profil</Text>
              </Pressable>
              <View ref={menuButton} collapsable={false}>
                <Pressable
                  onPress={openMenu}
                  accessibilityLabel="Flere valg"
                  className="h-11 w-11 items-center justify-center rounded-full border border-line bg-surface active:bg-surface-2"
                >
                  <MoreHorizontal size={20} color={TC.ink} />
                </Pressable>
              </View>
            </>
          }
        />

        <View className="px-4">
          {/* Jobbsøker / Oppdragsgiver (view only; companies are always Oppdragsgiver). */}
          {!isCompany ? <ProfileViewSwitch value={profileType} onChange={setProfileType} /> : null}

          {/* E-post: its own row, separate from BankID (no "Verifisert" wording or badge). */}
          <EmailVerificationRow
            email={profile?.email}
            emailVerified={profile?.emailVerified}
            onVerified={refetch}
          />

          {/* BankID */}
          {verified ? (
            <View className="mt-4 flex-row items-center gap-3 rounded-3xl border border-[#C6E2CE] bg-tint p-4 dark:border-brand-text/30">
              <BadgeCheck size={24} color={TC.brandText} />
              <View className="flex-1">
                <Text className="text-[1.0625rem] font-semibold text-ink">Identitet bekreftet</Text>
                <Text className="mt-0.5 text-[0.875rem] text-muted">
                  Bekreftet med BankID
                  {user.identityVerifiedAt ? ` · ${dayDate(user.identityVerifiedAt)}` : ''}
                </Text>
              </View>
            </View>
          ) : (
            <View className="mt-4 rounded-3xl bg-surface p-5">
              <View className="flex-row items-center gap-2">
                <ShieldCheck size={18} color={TC.brandText} />
                <Text className="text-[1.0625rem] font-semibold text-ink">BankID</Text>
              </View>
              <Text className="mt-1.5 text-[0.9375rem] leading-6 text-muted">
                Bekreft identiteten din med BankID for å skape mer trygghet på Jobblo.
              </Text>
              <Pressable
                onPress={() => void verifyWithBankId()}
                className="mt-4 h-12 flex-row items-center justify-center gap-2 rounded-full bg-brand active:opacity-90"
              >
                <ShieldCheck size={17} color="#FFFFFF" />
                <Text className="text-[1.0625rem] font-semibold text-white">
                  {openingBankId ? 'Åpner BankID …' : 'Verifiser med BankID'}
                </Text>
              </Pressable>
            </View>
          )}

          <ProfileTabs tabs={tabs} value={tab} onChange={setTab} />

          <View className="mt-4 gap-4">
            {tab === 'Om meg' || tab === 'Om oss' ? (
              <>
                <Panel icon={Briefcase} title={tab} onEdit={edit}>
                  {user.bio ? (
                    <Text className="text-[0.9375rem] leading-6 text-ink-2">{user.bio}</Text>
                  ) : (
                    <>
                      <Text className="text-[0.9375rem] text-muted">
                        Du har ikke skrevet noe om deg selv ennå.
                      </Text>
                      <AddButton label="Skriv en bio" onPress={edit} />
                    </>
                  )}
                </Panel>

                <Panel
                  icon={Award}
                  title="Ferdigheter"
                  onEdit={user.skills?.length ? edit : undefined}
                >
                  {user.skills?.length ? (
                    <View className="flex-row flex-wrap gap-2">
                      {user.skills.map((skill) => (
                        <View key={skill} className="rounded-full bg-tint px-3 py-1.5">
                          <Text className="text-[0.875rem] font-medium text-brand-text">
                            {skill}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <>
                      <Text className="text-[0.9375rem] text-muted">
                        Ingen ferdigheter lagt til.
                      </Text>
                      <AddButton label="Legg til" onPress={edit} />
                    </>
                  )}
                </Panel>

                {user.locations?.length ? (
                  <Panel icon={MapPin} title="Områder">
                    <View className="flex-row flex-wrap gap-2">
                      {user.locations.map((area) => (
                        <View key={area} className="rounded-full bg-surface-2 px-3 py-1.5">
                          <Text className="text-[0.875rem] text-ink-2">{area}</Text>
                        </View>
                      ))}
                    </View>
                  </Panel>
                ) : null}

                <Panel
                  icon={CalendarClock}
                  title="Tilgjengelighet"
                  onEdit={user.availabilityText ? edit : undefined}
                >
                  {user.availabilityText ? (
                    <Text className="text-[0.9375rem] leading-6 text-ink-2">
                      {user.availabilityText}
                    </Text>
                  ) : (
                    <>
                      <Text className="text-[0.9375rem] text-muted">
                        Fortell når du kan ta oppdrag.
                      </Text>
                      <AddButton label="Legg til" onPress={edit} />
                    </>
                  )}
                </Panel>

                <RatingCard
                  reviews={reviews}
                  average={Number(user.averageRating || 0)}
                  count={reviewCount}
                />
                <ReliabilityCard user={user} />

                <Pressable
                  onPress={() => router.push('/profile/settings/safepay')}
                  className="rounded-3xl border border-line bg-surface p-5 active:bg-surface-2"
                >
                  <View className="flex-row items-center gap-2">
                    <ShieldCheck size={17} color={TC.brandText} />
                    <Text className="text-[0.8125rem] font-semibold uppercase tracking-[0.12em] text-muted">
                      SafePay
                    </Text>
                  </View>
                  <Text className="mt-2 text-[1.75rem] font-bold tabular-nums text-ink">
                    {Number(user.totalEarned || 0).toLocaleString('nb-NO')} kr
                  </Text>
                  <Text className="mt-0.5 text-[0.9375rem] text-muted">
                    Utbetalt til deg.{' '}
                    <Text className="font-semibold text-brand-text">Se historikken →</Text>
                  </Text>
                </Pressable>
              </>
            ) : null}

            {tab === 'Fullførte' ? (
              finished.length ? (
                <View className="gap-2.5">
                  {finished.map((application) => (
                    <ListItem
                      key={application._id}
                      title={application.service?.title || 'Oppdrag'}
                      meta={`Fullført${application.service?.location?.city ? ` · ${application.service.location.city}` : ''}`}
                      right={
                        application.order?.agreedPrice
                          ? `${application.order.agreedPrice.toLocaleString('nb-NO')} kr`
                          : undefined
                      }
                      onPress={() =>
                        application.order?._id &&
                        router.push({
                          pathname: '/(app)/provider/orders/[orderId]',
                          params: { orderId: application.order._id },
                        })
                      }
                    />
                  ))}
                </View>
              ) : (
                <Empty
                  title="Ingen fullførte oppdrag"
                  text="Fullførte oppdrag vises her når de er godkjent."
                />
              )
            ) : null}

            {tab === 'Aktive'
              ? renderJobs(activeJobs, 'Ingen aktive oppdrag', 'Oppdrag du legger ut, vises her.')
              : null}
            {tab === 'Tidligere'
              ? renderJobs(
                  pastJobs,
                  'Ingen tidligere oppdrag',
                  'Fullførte og avsluttede oppdrag vises her.'
                )
              : null}

            {tab === 'Vurderinger' ? (
              reviews.length ? (
                <View className="gap-3">
                  {reviews.map((review) => (
                    <ReviewCard key={review._id} review={review} />
                  ))}
                </View>
              ) : (
                <Empty
                  title="Ingen vurderinger ennå"
                  text="Vurderinger fra fullførte oppdrag vises her."
                />
              )
            ) : null}
          </View>
        </View>
      </ScrollView>

      <DropdownMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        top={menuTop}
        items={[
          { label: 'Mine annonser', icon: Megaphone, onPress: () => router.push('/my-jobs') },
          { label: 'Mine søkere', icon: Users, onPress: () => router.push('/my-applications') },
          {
            label: 'Lagrede lister',
            icon: Bookmark,
            onPress: () => router.push('/(app)/favorites'),
          },
          {
            label: 'SafePay',
            icon: ShieldCheck,
            onPress: () => router.push('/profile/settings/safepay'),
          },
          {
            label: 'Innstillinger',
            icon: Settings,
            onPress: () => router.push('/(app)/profile/settings'),
          },
          null,
          {
            label: 'Logg ut',
            icon: LogOut,
            destructive: true,
            onPress: () => setLogoutVisible(true),
          },
        ]}
      />
      <ConfirmDialog
        visible={logoutVisible}
        title="Logg ut?"
        message="Vil du logge ut av Jobblo?"
        confirmLabel="Ja, logg ut"
        pendingLabel="Logger ut..."
        cancelLabel="Avbryt"
        destructive
        isPending={isLoggingOut}
        onConfirm={() => void handleLogout()}
        onClose={() => !isLoggingOut && setLogoutVisible(false)}
      />
    </SafeAreaView>
  );
}
