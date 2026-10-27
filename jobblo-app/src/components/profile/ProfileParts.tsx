import React from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import {
  ArrowLeft,
  BadgeCheck,
  MapPin,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  Star,
  type LucideIcon,
} from 'lucide-react-native';
import { ProfileCover } from './ProfileCover';
import { TC, tc } from '../../theme/colors';
import type { PublicUser, Review } from '../../types/UserProfile';

/**
 * The building blocks of a profile, shared by your own profile (profile/me.tsx) and other users'
 * (profile/[userId].tsx), so both look like the website's ProfilePage (client review P2: "Use
 * one profile component for both"). Own-only bits (edit, BankID button, earnings) stay in me.tsx.
 */

export const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '?';
export const placeOf = (user: { postSted?: string | { city?: string }; address?: string }) =>
  typeof user.postSted === 'string' ? user.postSted : user.postSted?.city || user.address || '';
export const monthYear = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' });
};
export const dayDate = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
};
/** Same as the web: under 1 t, {h} t, {d} d. */
export const responseTime = (minutes: number) =>
  minutes < 60
    ? 'under 1 t'
    : minutes < 1440
      ? `${Math.round(minutes / 60)} t`
      : `${Math.round(minutes / 1440)} d`;

export type ProfileView = 'seeker' | 'poster';

export function StatChip({
  icon: Icon,
  children,
  accent,
}: {
  icon?: LucideIcon;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <View
      className={`flex-row items-center gap-1.5 rounded-full px-3 py-1.5 ${accent ? 'bg-tint' : 'bg-surface-2'}`}
    >
      {Icon ? <Icon size={14} color={accent ? TC.brandText : TC.ink2} /> : null}
      <Text
        className={`text-[0.875rem] ${accent ? 'font-semibold text-brand-text' : 'text-ink-2'}`}
      >
        {children}
      </Text>
    </View>
  );
}

/** The website's stat chips: rating, fullførte / lagt ut, svarer, svartid, verified; "Ny på Jobblo" when none. */
export function profileChips(user: PublicUser, view: ProfileView) {
  const reviewCount = (user.reviews?.length || user.reviewCount || 0) as number;
  const rating = Number(user.averageRating || 0);
  const since = monthYear(user.createdAt);
  const chips: React.ReactNode[] = [];
  if (reviewCount > 0)
    chips.push(
      <StatChip
        key="r"
        icon={Star}
        accent
      >{`${rating.toFixed(1)} · ${reviewCount} ${reviewCount === 1 ? 'vurdering' : 'vurderinger'}`}</StatChip>
    );
  if (view === 'seeker' && user.completedJobs)
    chips.push(<StatChip key="c">{`${user.completedJobs} fullførte`}</StatChip>);
  if (view === 'poster' && user.postedJobsCount)
    chips.push(<StatChip key="p">{`${user.postedJobsCount} lagt ut`}</StatChip>);
  if (user.totalJobRequests && typeof user.responseRate === 'number')
    chips.push(<StatChip key="s">{`${user.responseRate} % svarer`}</StatChip>);
  if (user.averageResponseTimeMinutes && user.averageResponseTimeMinutes > 0)
    chips.push(
      <StatChip key="t">{`${responseTime(user.averageResponseTimeMinutes)} svartid`}</StatChip>
    );
  if (user.identityVerified === true)
    chips.push(
      <StatChip key="v" icon={BadgeCheck} accent>
        Verifisert
      </StatChip>
    );
  if (!chips.length)
    chips.push(
      <StatChip
        key="n"
        icon={Sparkles}
      >{`Ny på Jobblo${since ? ` · siden ${since}` : ''}`}</StatChip>
    );
  return chips;
}

/**
 * Sprout cover with a back button, and the identity card over its foot: avatar (+ BankID shield),
 * name, "Bedrift" for companies only (as on the website: no "Privat" badge), place · member since,
 * org number, the screen's own buttons, and the stat chips.
 */
export function ProfileIdentity({
  user,
  fullName,
  topInset,
  onBack,
  actions,
  chips,
}: {
  user: PublicUser & { orgNumber?: string };
  fullName: string;
  topInset: number;
  onBack: () => void;
  actions?: React.ReactNode;
  chips: React.ReactNode[];
}) {
  const place = placeOf(user);
  const since = monthYear(user.createdAt);
  const isCompany = user.role === 'company';
  return (
    <>
      <View>
        <ProfileCover seed={user._id} height={190} />
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Tilbake"
          className="absolute left-4 h-10 w-10 items-center justify-center rounded-full bg-white/95 active:opacity-80"
          style={{ top: topInset + 8 }}
        >
          <ArrowLeft size={19} color="#0B0B0B" />
        </Pressable>
      </View>
      <View className="px-4">
        <View className="-mt-16 items-center rounded-3xl bg-surface px-5 pb-5 pt-0">
          <View className="-mt-12 h-[104px] w-[104px] items-center justify-center overflow-hidden rounded-full border-4 border-surface bg-tint">
            {user.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} className="h-full w-full" />
            ) : (
              <Text className="text-[2rem] font-semibold text-brand-text">
                {initials(fullName)}
              </Text>
            )}
          </View>
          {user.identityVerified === true ? (
            <View className="-mt-7 ml-20 h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-brand">
              <ShieldCheck size={14} color="#FFFFFF" />
            </View>
          ) : null}

          <View className="mt-3 flex-row flex-wrap items-center justify-center gap-2">
            <Text className="text-center text-[1.5rem] font-bold tracking-[-0.02em] text-ink">
              {fullName}
            </Text>
            {isCompany ? (
              <View className="rounded-full bg-surface-2 px-2.5 py-1">
                <Text className="text-[0.8125rem] font-bold uppercase tracking-[0.06em] text-muted">
                  Bedrift
                </Text>
              </View>
            ) : null}
          </View>
          <View className="mt-1 flex-row flex-wrap items-center justify-center gap-x-2">
            {place ? (
              <View className="flex-row items-center gap-1">
                <MapPin size={13} color={tc('#63665F', 'muted')} />
                <Text className="text-[0.875rem] text-muted">{place}</Text>
              </View>
            ) : null}
            {since ? (
              <Text className="text-[0.875rem] text-muted">
                {place ? '· ' : ''}Medlem siden {since}
              </Text>
            ) : null}
          </View>
          {isCompany && user.orgNumber ? (
            <Text className="mt-0.5 text-[0.8125rem] text-muted">Org.nr {user.orgNumber}</Text>
          ) : null}

          {actions ? <View className="mt-4 w-full flex-row gap-2.5">{actions}</View> : null}
          <View className="mt-4 flex-row flex-wrap justify-center gap-2">{chips}</View>
        </View>
      </View>
    </>
  );
}

/** Jobbsøker / Oppdragsgiver: which side of the profile to show (companies are always Oppdragsgiver). */
export function ProfileViewSwitch({
  value,
  onChange,
}: {
  value: ProfileView;
  onChange: (view: ProfileView) => void;
}) {
  return (
    <View className="mt-4 flex-row rounded-full border border-line bg-surface p-1">
      {(
        [
          ['seeker', 'Jobbsøker'],
          ['poster', 'Oppdragsgiver'],
        ] as const
      ).map(([view, label]) => (
        <Pressable
          key={view}
          onPress={() => onChange(view)}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === view }}
          className={`h-10 flex-1 items-center justify-center rounded-full ${value === view ? 'bg-brand' : ''}`}
        >
          <Text
            className={`text-[0.9375rem] font-semibold ${value === view ? 'text-white' : 'text-muted'}`}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ProfileTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: string[];
  value: string;
  onChange: (tab: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="-mx-4 mt-5"
      contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
    >
      {tabs.map((name) => (
        <Pressable
          key={name}
          onPress={() => onChange(name)}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === name }}
          className={`h-10 justify-center rounded-full border px-4 ${value === name ? 'border-ink bg-ink' : 'border-line bg-surface'}`}
        >
          <Text
            className={`text-[0.9375rem] font-semibold ${value === name ? 'text-page' : 'text-ink-2'}`}
          >
            {name}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** White panel with an icon title and, on your own profile, an inline "Rediger" (web `Panel`). */
export function Panel({
  icon: Icon,
  title,
  onEdit,
  children,
}: {
  icon: LucideIcon;
  title: string;
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <View className="rounded-3xl bg-surface p-5">
      <View className="mb-3 flex-row items-center gap-2">
        <Icon size={17} color={TC.brandText} />
        <Text className="flex-1 text-[1.0625rem] font-semibold text-ink">{title}</Text>
        {onEdit ? (
          <Pressable
            onPress={onEdit}
            hitSlop={8}
            className="flex-row items-center gap-1"
            accessibilityLabel={`Rediger ${title.toLowerCase()}`}
          >
            <Pencil size={13} color={TC.brandText} />
            <Text className="text-[0.875rem] font-semibold text-brand-text">Rediger</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="mt-3 flex-row items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong py-3 active:bg-surface-2"
    >
      <Plus size={15} color={TC.brandText} />
      <Text className="text-[0.875rem] font-semibold text-brand-text">{label}</Text>
    </Pressable>
  );
}

/** "Vurdering": the average and a bar per star level, counted from the reviews. */
export function RatingCard({
  reviews,
  average,
  count,
}: {
  reviews: Review[];
  average: number;
  count: number;
}) {
  const distribution = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    n: reviews.filter((r) => Math.round(Number(r.rating)) === stars).length,
  }));
  return (
    <View className="rounded-3xl bg-surface p-5">
      <Text className="text-[0.8125rem] font-semibold uppercase tracking-[0.12em] text-muted">
        Vurdering
      </Text>
      {count ? (
        <View className="mt-3 flex-row items-center gap-5">
          <View className="items-center">
            <Text className="text-[2.5rem] font-bold leading-none text-ink">
              {average.toFixed(1)}
            </Text>
            <Text className="mt-1 text-[0.8125rem] text-muted">
              {count} {count === 1 ? 'vurdering' : 'vurderinger'}
            </Text>
          </View>
          <View className="flex-1 gap-1.5">
            {distribution.map(({ stars, n }) => (
              <View key={stars} className="flex-row items-center gap-2">
                <Text className="w-3 text-[0.8125rem] text-muted">{stars}</Text>
                <View className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <View
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${count ? (n / count) * 100 : 0}%` }}
                  />
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : (
        <Text className="mt-2 text-[0.9375rem] text-muted">Ingen vurderinger ennå.</Text>
      )}
    </View>
  );
}

/** "Pålitelighet": blir hyret, fullfører, gjengangere, denne måneden (only the figures there are). */
export function ReliabilityCard({ user }: { user: PublicUser }) {
  const rows = [
    user.hireRate ? ['Blir hyret', `${user.hireRate} %`] : null,
    user.completionRate ? ['Fullfører', `${user.completionRate} %`] : null,
    user.repeatCustomersCount ? ['Gjengangere', String(user.repeatCustomersCount)] : null,
    user.jobsThisMonth ? ['Denne måneden', String(user.jobsThisMonth)] : null,
  ].filter(Boolean) as [string, string][];
  if (!rows.length) return null;
  return (
    <View className="rounded-3xl bg-surface p-5">
      <Text className="text-[0.8125rem] font-semibold uppercase tracking-[0.12em] text-muted">
        Pålitelighet
      </Text>
      {rows.map(([label, value], index) => (
        <View
          key={label}
          className={`flex-row items-center justify-between py-2.5 ${index ? 'border-t border-line-soft' : ''}`}
        >
          <Text className="text-[0.9375rem] text-ink-2">{label}</Text>
          <Text className="text-[0.9375rem] font-semibold text-ink">{value}</Text>
        </View>
      ))}
    </View>
  );
}

export function ReviewCard({ review }: { review: Review }) {
  const name =
    [review.reviewerId?.name, review.reviewerId?.lastName].filter(Boolean).join(' ') || 'Bruker';
  return (
    <View className="rounded-3xl bg-surface p-5">
      <View className="flex-row items-center gap-3">
        <View className="h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-tint">
          {review.reviewerId?.avatarUrl ? (
            <Image source={{ uri: review.reviewerId.avatarUrl }} className="h-full w-full" />
          ) : (
            <Text className="font-semibold text-brand-text">{initials(name)}</Text>
          )}
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[0.9375rem] font-semibold text-ink" numberOfLines={1}>
            {name}
          </Text>
          <Text className="text-[0.8125rem] text-muted">{dayDate(review.createdAt)}</Text>
        </View>
        <View className="flex-row items-center gap-1 rounded-full bg-tint px-2.5 py-1">
          <Star size={12} color={TC.brandText} fill={TC.brandText} />
          <Text className="text-[0.8125rem] font-semibold text-brand-text">
            {Number(review.rating || 0).toFixed(1)}
          </Text>
        </View>
      </View>
      {review.comment ? (
        <Text className="mt-3 text-[0.9375rem] leading-6 text-ink-2">{review.comment}</Text>
      ) : null}
      {review.serviceId?.title ? (
        <Text
          className="mt-3 border-t border-line-soft pt-3 text-[0.8125rem] text-muted"
          numberOfLines={1}
        >
          {review.serviceId.title}
        </Text>
      ) : null}
    </View>
  );
}

export function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <View className="items-center rounded-3xl bg-surface px-6 py-10">
      <Text className="text-center text-[1.0625rem] font-semibold text-ink">{title}</Text>
      <Text className="mt-1.5 text-center text-[0.9375rem] leading-6 text-muted">{text}</Text>
      {action ? <View className="mt-5">{action}</View> : null}
    </View>
  );
}
