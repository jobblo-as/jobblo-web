import React, { useCallback, useEffect, useState } from 'react';
import { setStatusBarStyle } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Award, BadgeCheck, Briefcase, CalendarClock, FolderOpen, GraduationCap, MapPin } from 'lucide-react-native';
import { usePublicProfile } from '../../../src/hooks/usePublicProfile';
import { useJobs } from '../../../src/hooks/useJobs';
import { useProfile } from '../../../src/hooks/useProfile';
import { ErrorState } from '../../../src/components/ui/ErrorState';
import { JobCard } from '../../../src/components/JobCard';
import {
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
import type { ExperienceItem } from '../../../src/types/UserProfile';
import { TC } from '../../../src/theme/colors';
import { PublicProfileSkeleton, SkJobGrid } from '../../../src/components/skeletons/ScreenSkeletons';

/**
 * Another user's profile: the same layout as your own (profile/me.tsx, client review P2) but read
 * only: no "Rediger", no BankID button, no SafePay earnings. Active jobs come from the job feed.
 */

const TABS: Record<'seeker' | 'poster' | 'company', string[]> = {
  seeker: ['Om meg', 'Vurderinger'],
  poster: ['Aktive', 'Vurderinger'],
  company: ['Om oss', 'Aktive', 'Vurderinger'],
};

function asExperience(field: unknown): ExperienceItem[] {
  if (!field) return [];
  if (Array.isArray(field)) return field as ExperienceItem[];
  if (typeof field === 'object') return [field as ExperienceItem];
  return [];
}

function formatExperienceDate(value?: string) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('nb-NO', { month: 'short', year: 'numeric' });
}

function formatDateRange(item: ExperienceItem) {
  if (typeof item.startDate !== 'string' && typeof item.endDate !== 'string') return '';
  const start = formatExperienceDate(item.startDate);
  const end = formatExperienceDate(item.endDate);
  return [start || 'Ukjent start', end || 'Nå'].join(' – ');
}

function ExperienceCard({ item }: { item: ExperienceItem }) {
  const title = typeof item.title === 'string' ? item.title : '';
  const company = typeof item.company === 'string' ? item.company : '';
  const description = typeof item.description === 'string' ? item.description : '';
  if (!title && !company && !description) return null;
  return (
    <View className="rounded-2xl bg-surface-2 p-4">
      {title ? <Text className="text-[0.9375rem] font-semibold text-ink">{title}</Text> : null}
      {company ? <Text className="mt-0.5 text-[0.875rem] font-medium text-brand-text">{company}</Text> : null}
      {formatDateRange(item) ? <Text className="mt-0.5 text-[0.8125rem] text-muted">{formatDateRange(item)}</Text> : null}
      {description ? <Text className="mt-2 text-[0.9375rem] leading-6 text-ink-2">{description}</Text> : null}
    </View>
  );
}

function ItemList({ items }: { items: { _id: string; title?: string; description?: string }[] }) {
  return (
    <View className="gap-3">
      {items.map((item) => (
        <View key={item._id} className="rounded-2xl bg-surface-2 p-4">
          <Text className="text-[0.9375rem] font-semibold text-ink">{item.title}</Text>
          {item.description ? <Text className="mt-1 text-[0.9375rem] leading-6 text-ink-2">{item.description}</Text> : null}
        </View>
      ))}
    </View>
  );
}

export default function PublicProfileScreen() {
  const params = useLocalSearchParams<{ userId: string | string[] }>();
  const userId = Array.isArray(params.userId) ? params.userId[0] : params.userId;
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: self, isLoading: selfLoading } = useProfile();
  const isSelf = !!self?._id && !!userId && self._id === userId;

  useEffect(() => {
    if (isSelf) router.replace('/(app)/profile');
  }, [isSelf]);

  const { data: user, isLoading, isError, refetch } = usePublicProfile(isSelf ? null : userId ?? null);
  const isCompany = user?.role === 'company';
  const [view, setView] = useState<ProfileView>('seeker');
  const tabs = isCompany ? TABS.company : TABS[view];
  const [tab, setTab] = useState(tabs[0]);
  const {
    data: jobsData,
    isLoading: jobsLoading,
    isError: jobsError,
    refetch: refetchJobs,
  } = useJobs({ userId: userId ?? '', limit: 20, enabled: !isSelf && !!userId });
  const activeJobs = jobsData?.data ?? [];

  // Companies only have the poster side.
  useEffect(() => {
    if (isCompany) setView('poster');
  }, [isCompany]);
  useEffect(() => {
    setTab(tabs[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, isCompany]);

  // The cover runs under the status bar: light icons on it while this screen is in front.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('auto');
    }, [])
  );

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    setRefreshing(true);
    try { await Promise.all([refetch(), refetchJobs()]); } finally { setRefreshing(false); }
  };

  if (isSelf) return null;
  if (selfLoading || isLoading) {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
        <PublicProfileSkeleton />
      </SafeAreaView>
    );
  }
  if (isError || !user) {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
        <ErrorState
          title="Fant ikke brukeren"
          message="Profilen finnes ikke lenger, eller lenken er feil."
          onAction={() => router.replace('/(app)')}
        />
      </SafeAreaView>
    );
  }

  const fullName = isCompany
    ? user.companyName || user.name || 'Bedrift'
    : [user.name, user.lastName].filter(Boolean).join(' ') || 'Bruker';
  const firstName = isCompany ? fullName : user.name || fullName;
  const reviews = user.reviews ?? [];
  const reviewCount = reviews.length || user.reviewCount || 0;
  const experience = asExperience(user.experience ?? null);
  const hasAbout = Boolean(
    user.bio || user.skills?.length || user.locations?.length || user.availabilityText || experience.length || user.portfolio?.length || user.previousProjects?.length
  );

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} className="flex-1 bg-page">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor="#FFFFFF" colors={[TC.brandText]} />}
      >
        <ProfileIdentity user={user} fullName={fullName} topInset={insets.top} onBack={() => router.back()} chips={profileChips(user, view)} />

        <View className="px-4">
          {!isCompany ? <ProfileViewSwitch value={view} onChange={setView} /> : null}

          {user.identityVerified === true ? (
            <View className="mt-4 flex-row items-center gap-3 rounded-3xl border border-[#C6E2CE] bg-tint p-4 dark:border-brand-text/30">
              <BadgeCheck size={24} color={TC.brandText} />
              <View className="flex-1">
                <Text className="text-[1.0625rem] font-semibold text-ink">Identitet bekreftet</Text>
                <Text className="mt-0.5 text-[0.875rem] text-muted">
                  Bekreftet med BankID{user.identityVerifiedAt ? ` · ${dayDate(user.identityVerifiedAt)}` : ''}
                </Text>
              </View>
            </View>
          ) : null}

          <ProfileTabs tabs={tabs} value={tab} onChange={setTab} />

          <View className="mt-4 gap-4">
            {tab === 'Om meg' || tab === 'Om oss' ? (
              <>
                {user.bio ? (
                  <Panel icon={Briefcase} title={tab}>
                    <Text className="text-[0.9375rem] leading-6 text-ink-2">{user.bio}</Text>
                  </Panel>
                ) : null}

                {user.skills?.length ? (
                  <Panel icon={Award} title="Ferdigheter">
                    <View className="flex-row flex-wrap gap-2">
                      {user.skills.map((skill) => (
                        <View key={skill} className="rounded-full bg-tint px-3 py-1.5">
                          <Text className="text-[0.875rem] font-medium text-brand-text">{skill}</Text>
                        </View>
                      ))}
                    </View>
                  </Panel>
                ) : null}

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

                {user.availabilityText ? (
                  <Panel icon={CalendarClock} title="Tilgjengelighet">
                    <Text className="text-[0.9375rem] leading-6 text-ink-2">{user.availabilityText}</Text>
                  </Panel>
                ) : null}

                {experience.length ? (
                  <Panel icon={GraduationCap} title="Erfaring">
                    <View className="gap-3">
                      {experience.map((item, index) => <ExperienceCard key={item._id ?? item.id ?? index} item={item} />)}
                    </View>
                  </Panel>
                ) : null}

                {user.portfolio?.length ? (
                  <Panel icon={FolderOpen} title="Portfolio">
                    <ItemList items={user.portfolio} />
                  </Panel>
                ) : null}

                {user.previousProjects?.length ? (
                  <Panel icon={FolderOpen} title="Tidligere prosjekter">
                    <ItemList items={user.previousProjects} />
                  </Panel>
                ) : null}

                {!hasAbout ? <Empty title="Ingenting her ennå" text={`${firstName} har ikke fylt ut profilen sin.`} /> : null}

                <RatingCard reviews={reviews} average={Number(user.averageRating || 0)} count={reviewCount} />
                <ReliabilityCard user={user} />
              </>
            ) : null}

            {tab === 'Aktive' ? (
              jobsLoading ? (
                <SkJobGrid />
              ) : jobsError ? (
                <ErrorState title="Kunne ikke laste oppdrag" message="Prøv igjen." actionLabel="Prøv igjen" onAction={() => void refetchJobs()} />
              ) : activeJobs.length ? (
                <View className="flex-row flex-wrap gap-3">
                  {activeJobs.map((job) => (
                    <View key={job._id} className="w-[47%]">
                      <JobCard job={job} compact />
                    </View>
                  ))}
                </View>
              ) : (
                <Empty title="Ingen aktive oppdrag" text={`${firstName} har ingen aktive oppdrag ute akkurat nå.`} />
              )
            ) : null}

            {tab === 'Vurderinger' ? (
              reviews.length ? (
                <View className="gap-3">{reviews.map((review) => <ReviewCard key={review._id} review={review} />)}</View>
              ) : (
                <Empty title="Ingen vurderinger ennå" text="Vurderinger fra fullførte oppdrag vises her." />
              )
            ) : null}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
