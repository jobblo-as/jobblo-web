import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import {
  Archive,
  Check,
  Heart,
  MessageCircle,
  ShieldCheck,
  Star,
  Users,
  X,
} from 'lucide-react-native';
import { Button } from '../ui/Button';
import type { ActiveApplicantOrder, ApplicantApplication } from '../../types/Applicants';
import { TC, tc } from '../../theme/colors';

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

/** "i dag", "i går", "3 dager siden", else the date: shorter than a full date in the header. */
function appliedLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return 'Søkte i dag';
  if (days === 1) return 'Søkte i går';
  if (days < 7) return `Søkte for ${days} dager siden`;
  return `Søkte ${formatDate(value)}`;
}

function statusLabel(status: string) {
  if (status === 'accepted') return 'Valgt';
  if (status === 'declined') return 'Avslått';
  return 'Venter på svar';
}

function activeOrderLabel(order: ActiveApplicantOrder | null) {
  if (!order) return 'Velg og start SafePay';
  if (order.status === 'awaiting_payment') return 'Gå til betaling';
  if (order.status === 'paid' || order.status === 'in_progress') return 'Betalt';
  if (order.status === 'ready_for_review' || order.status === 'completed') return 'Se godkjenning';
  return 'Se aktiv kontrakt';
}

export function ApplicantCard({
  application,
  activeOrder,
  lastOrder,
  isTop,
  isCompared,
  isSelecting,
  isStartingChat,
  onFavorite,
  onCompare,
  onArchive,
  onDecline,
  onSelect,
  onChat,
}: {
  application: ApplicantApplication;
  activeOrder: ActiveApplicantOrder | null;
  /** Set when no order is active: a declined card then opens this order's last step. */
  lastOrder?: ActiveApplicantOrder | null;
  isTop: boolean;
  isCompared: boolean;
  isSelecting: boolean;
  isStartingChat: boolean;
  onFavorite: (requestId: string) => void;
  onCompare: (applicantId: string) => void;
  onArchive: (requestId: string) => void;
  onDecline: (requestId: string) => void;
  onSelect: (application: ApplicantApplication) => void;
  onChat: (applicantId: string) => void;
}) {
  const { applicant } = application;
  // "0 · 0 anmeldelser" and "—★" read as a bad score; a new applicant has none yet.
  const hasReviews = applicant.reviewCount > 0 && Number(applicant.rating) > 0;
  // The server only awards pending/accepted applications (safepayController.createContract),
  // so a declined one gets no "Velg og start SafePay" — pressing it was a 400. When the job
  // has an ended order, the button opens its last step instead (handleSelect).
  const declined = !activeOrder && application.status === 'declined';
  const actionLabel = declined
    ? lastOrder
      ? 'Søknaden er avslått · Se status'
      : 'Søknaden er avslått'
    : isSelecting
      ? 'Starter…'
      : activeOrderLabel(activeOrder);

  return (
    <View
      className={[
        'rounded-[20px] border bg-surface p-4',
        application.favorite
          ? 'border-2 border-[#D6B84C]'
          : application.archived
            ? 'border-line opacity-60'
            : 'border-line',
      ].join(' ')}
    >
      <View className="flex-row items-start gap-3">
        <View className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-tint">
          {applicant.avatarUrl ? (
            <Image source={{ uri: applicant.avatarUrl }} className="h-full w-full" />
          ) : (
            <View className="h-full w-full items-center justify-center">
              <Text className="text-[1.0625rem] font-semibold text-[#122A1C] dark:text-brand-text">
                {getInitials(applicant.name)}
              </Text>
            </View>
          )}
        </View>

        <View className="min-w-0 flex-1">
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
            <Text className="shrink text-[1rem] font-semibold text-ink" numberOfLines={1}>
              {applicant.name}
            </Text>
            {applicant.verified ? <ShieldCheck size={15} color={TC.brandText} /> : null}
            {isTop ? (
              <View className="rounded-full bg-brand px-2 py-0.5">
                <Text className="text-[0.75rem] font-semibold text-white">Topp</Text>
              </View>
            ) : null}
          </View>
          <View className="mt-1 flex-row items-center gap-1">
            {hasReviews ? (
              <>
                <Star size={13} color="#D6A23C" fill="#D6A23C" />
                <Text className="text-[0.8125rem] font-semibold text-ink">
                  {Number(applicant.rating).toFixed(1)}
                </Text>
                <Text className="text-[0.8125rem] text-muted">
                  ({applicant.reviewCount}) · {applicant.completedJobs} oppdrag
                </Text>
              </>
            ) : (
              <Text className="text-[0.8125rem] font-medium text-brand-text">Ny på Jobblo</Text>
            )}
          </View>
          <Text className="mt-0.5 text-[0.8125rem] text-muted" numberOfLines={1}>
            {[
              applicant.skills.length > 0 ? applicant.skills.join(' · ') : 'Generell hjelp',
              applicant.locations[0],
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>

        <View className="self-start rounded-full bg-surface-2 px-2.5 py-1">
          <Text className="text-[0.75rem] font-semibold text-muted">
            {statusLabel(application.status)}
          </Text>
        </View>
      </View>

      {/* Three equal tiles instead of a row that cut "Søkt …" off on a phone. */}
      <View className="mt-4 flex-row gap-2">
        {[
          { value: String(applicant.completedJobs), label: 'Fullførte' },
          { value: hasReviews ? Number(applicant.rating).toFixed(1) : '–', label: 'Vurdering' },
          { value: applicant.responseRate ?? '–', label: 'Svarrate' },
        ].map((stat) => (
          <View key={stat.label} className="flex-1 items-center rounded-xl bg-surface-2 py-2.5">
            <Text className="text-[1rem] font-semibold text-ink">{stat.value}</Text>
            <Text className="mt-0.5 text-[0.75rem] text-muted">{stat.label}</Text>
          </View>
        ))}
      </View>
      <Text className="mt-2 text-[0.75rem] text-subtle">{appliedLabel(application.appliedAt)}</Text>

      <View className="mt-3 flex-row gap-2">
        {[
          {
            key: 'favorite',
            label: 'Favoritt',
            a11y: application.favorite ? 'Fjern som favoritt' : 'Marker som favoritt',
            active: Boolean(application.favorite),
            onPress: () => onFavorite(application._id),
            icon: (
              <Heart
                size={16}
                color={TC.brandText}
                fill={application.favorite ? TC.brandText : 'none'}
              />
            ),
          },
          {
            key: 'compare',
            label: 'Sammenlign',
            a11y: isCompared ? 'Fjern fra sammenligning' : 'Legg til i sammenligning',
            active: isCompared,
            onPress: () => onCompare(applicant._id),
            icon: <Users size={16} color={TC.brandText} />,
          },
          {
            key: 'archive',
            label: application.archived ? 'Gjenopprett' : 'Arkiver',
            a11y: application.archived ? 'Gjenopprett fra arkiv' : 'Arkiver søker',
            active: false,
            onPress: () => onArchive(application._id),
            icon: <Archive size={16} color={tc('#63665F', 'muted')} />,
          },
          {
            key: 'decline',
            label: 'Avslå',
            a11y: 'Avslå søker',
            active: false,
            danger: true,
            onPress: () => onDecline(application._id),
            icon: <X size={16} color={TC.dangerSolid} />,
          },
        ].map((action) => (
          <Pressable
            key={action.key}
            onPress={action.onPress}
            accessibilityRole="button"
            accessibilityLabel={action.a11y}
            accessibilityState={{ selected: action.active }}
            className={[
              'flex-1 items-center gap-1 rounded-xl py-2',
              action.active ? 'bg-tint' : action.danger ? 'bg-danger-tint' : 'bg-surface-2',
            ].join(' ')}
          >
            {action.icon}
            <Text
              numberOfLines={1}
              className={`text-[0.6875rem] font-medium ${action.danger ? 'text-danger' : action.active ? 'text-brand-text' : 'text-muted'}`}
            >
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {application.message ? (
        <View className="mt-3 rounded-xl border-l-[3px] border-brand-text bg-surface-2 px-3 py-2.5">
          <View className="flex-row items-center gap-1">
            <MessageCircle size={12} color={tc('#9B9E96', 'subtle')} />
            <Text className="text-[0.8125rem] text-muted">Melding fra søker</Text>
          </View>
          <Text className="mt-1 text-[0.8125rem] leading-relaxed text-ink">
            {application.message}
          </Text>
        </View>
      ) : null}

      <View className="mt-4 gap-2">
        <Button
          label={actionLabel}
          onPress={() => onSelect(application)}
          disabled={isSelecting || (declined && !lastOrder)}
          icon={<Check size={16} color="#FFFFFF" />}
          fullWidth
        />
        <Button
          label={isStartingChat ? 'Åpner melding…' : 'Send melding'}
          onPress={() => onChat(applicant._id)}
          disabled={isStartingChat}
          variant="secondary"
          icon={<MessageCircle size={16} color={TC.ink} />}
          fullWidth
        />
      </View>
    </View>
  );
}
