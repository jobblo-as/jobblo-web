import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  BadgeCheck,
  Briefcase,
  ChevronLeft,
  MoreHorizontal,
  Send,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  UserRoundCheck,
  UserRoundX,
} from 'lucide-react-native';
import { useUnblockUser } from '../../../src/hooks/useBlockedUsers';
import { usePublicProfile } from '../../../src/hooks/usePublicProfile';
import type { PublicUser } from '../../../src/types/UserProfile';
import { GlassButton, GlassFill, useGlass } from '../../../src/components/ui/GlassButton';
import { LIQUID_GLASS } from '../../../src/components/GlassTabBar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../../src/store/authStore';
import {
  messageIdentity,
  upsertChatMessage,
  useChatDetail,
  useSendChatMessage,
} from '../../../src/hooks/useChatDetail';
import { getChatSocket } from '../../../src/services/chatSocket.service';
import {
  createChatContract,
  deleteChatForMe,
  submitChatReport,
  type ChatDetail,
  type ChatMessage,
  type MessageParticipant,
} from '../../../src/services/messages.service';
import { queryKeys } from '../../../src/queryKeys';
import { ErrorState } from '../../../src/components/ui/ErrorState';
import { Button } from '../../../src/components/ui/Button';
import { ConfirmDialog } from '../../../src/components/ui/ConfirmDialog';
import { DropdownMenu } from '../../../src/components/ui/DropdownMenu';
import { orderRouteForRole } from '../../../src/utils/orderRoute';
import { groupSystemMessages, isStatusGroup, type ChatItem } from '../../../src/utils/chatGrouping';
import { TC, tc } from '../../../src/theme/colors';
import { ChatSkeleton } from '../../../src/components/skeletons/ScreenSkeletons';

/**
 * The "Oppdragsstatus" cards (runs of system messages) are hidden in the thread for now.
 * Nothing is removed: the messages still load and StatusCard is kept; set true to show them.
 */
const SHOW_STATUS_CARDS = false;

const STATUS_LABELS: Record<string, string> = {
  completed: 'Fullført',
  ready_for_review: 'Meldt ferdig',
  in_progress: 'Pågår',
  awaiting_payment: 'Venter på betaling',
  accepted: 'Godtatt',
  pending: 'Ventende',
  cancelled: 'Kansellert',
  declined: 'Avslått',
};

function idOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    '_id' in value &&
    typeof value._id === 'string'
  )
    return value._id;
  return null;
}
function nameOf(value?: MessageParticipant | null) {
  return value?.name?.trim() || 'Bruker';
}
function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'U'
  );
}
function formatTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
}
/** "18. sep. 19:33" — FINN puts the time between messages, not inside each bubble. */
function formatStamp(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })} ${formatTime(value)}`;
}
/** A stamp opens the thread and every gap of more than 30 minutes. */
function showStamp(at?: string, previous?: string) {
  if (!at) return false;
  if (!previous) return true;
  return new Date(at).getTime() - new Date(previous).getTime() > 30 * 60 * 1000;
}
function itemTime(item: ChatItem<ChatMessage> | undefined) {
  if (!item) return undefined;
  return isStatusGroup(item) ? item.items[0]?.createdAt : item.createdAt;
}
function messageKey(message: ChatMessage) {
  return (
    message._id ||
    `${message.createdAt || ''}:${message.text || ''}:${idOf(message.senderId) || ''}`
  );
}
function isSystem(message: ChatMessage) {
  return message.type?.startsWith('system_');
}
function serverError(error: unknown) {
  const data = (error as { response?: { data?: { message?: string; error?: string } } } | null)
    ?.response?.data;
  return data?.message ?? data?.error;
}

/** One card for a run of system messages: the latest line, expandable to the whole run. */
function StatusCard({
  items,
  onOpen,
}: {
  items: ChatMessage[];
  onOpen: (orderId?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const latest = items[items.length - 1];
  const target = [...items].reverse().find((item) => item.systemData?.orderId)?.systemData?.orderId;
  return (
    <View className="my-2 rounded-3xl bg-surface px-5 py-4">
      <Text className="text-[0.8125rem] font-semibold uppercase tracking-[0.12em] text-muted">
        Oppdragsstatus
      </Text>
      {(expanded ? items : [latest]).map((item) => (
        <View key={messageKey(item)} className="mt-1.5 flex-row items-start gap-2">
          <Text className="flex-1 text-[0.875rem] leading-5 text-ink">
            {item.text || 'Status oppdatert'}
          </Text>
          <Text className="text-[0.8125rem] text-muted">{formatTime(item.createdAt)}</Text>
        </View>
      ))}
      {items.length > 1 || target ? (
        <View className="mt-2.5 flex-row items-center justify-between">
          {items.length > 1 ? (
            <Pressable onPress={() => setExpanded((value) => !value)} hitSlop={8}>
              <Text className="text-[0.8125rem] font-semibold text-brand-text">
                {expanded ? 'Vis mindre' : `Vis alle (${items.length})`}
              </Text>
            </Pressable>
          ) : (
            <View />
          )}
          {target ? (
            <Pressable onPress={() => onOpen(target)} hitSlop={8}>
              <Text className="text-[0.8125rem] font-semibold text-brand-text">Se oppdrag ›</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Who you are talking to, as FINN: big avatar, name, verified · member since, rating. */
function ChatIntro({
  other,
  profile,
  onOpenProfile,
}: {
  other?: MessageParticipant | null;
  profile?: PublicUser;
  onOpenProfile: () => void;
}) {
  const name = nameOf(other);
  const avatar = other?.avatarUrl || profile?.avatarUrl;
  const verified = other?.verified || profile?.identityVerified;
  const since = profile?.createdAt ? new Date(profile.createdAt).getFullYear() : null;
  const rating = profile?.averageRating ?? 0;
  return (
    <View className="items-center pb-5">
      <Pressable
        onPress={onOpenProfile}
        accessibilityRole="button"
        accessibilityLabel={`Se profilen til ${name}`}
        className="h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-surface-2"
      >
        {avatar ? (
          <Image source={{ uri: avatar }} className="h-full w-full" />
        ) : (
          <Text className="text-[2rem] font-semibold text-brand-text">{initials(name)}</Text>
        )}
      </Pressable>
      <Pressable onPress={onOpenProfile} hitSlop={6}>
        <Text className="mt-3 text-[1.125rem] font-semibold text-brand-text">{name}</Text>
      </Pressable>
      {verified || since ? (
        <View className="mt-1.5 flex-row items-center gap-1.5">
          {verified ? (
            <>
              <BadgeCheck size={15} color={TC.brandText} />
              <Text className="text-[0.8125rem] text-muted">Verifisert</Text>
            </>
          ) : null}
          {verified && since ? <Text className="text-[0.8125rem] text-muted">|</Text> : null}
          {since ? (
            <Text className="text-[0.8125rem] text-muted">På Jobblo siden {since}</Text>
          ) : null}
        </View>
      ) : null}
      {rating > 0 ? (
        <Text className="mt-1.5 text-[0.8125rem] text-muted">
          <Text className="font-semibold text-ink">{rating.toFixed(1).replace('.', ',')}</Text>
          {'  '}
          {profile?.reviewCount ?? 0} {profile?.reviewCount === 1 ? 'vurdering' : 'vurderinger'}
        </Text>
      ) : null}
    </View>
  );
}

function JobContext({
  chat,
  userId,
  onPress,
}: {
  chat: ChatDetail;
  userId: string | null;
  onPress: () => void;
}) {
  const service = chat.serviceId;
  const order = typeof chat.orderId === 'object' ? chat.orderId : null;
  const status = order?.status || chat.status;
  const isCustomer = service?.userId === userId;
  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-3 rounded-3xl bg-surface p-3">
      <View className="h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-tint">
        {service?.images?.[0] ? (
          <Image source={{ uri: service.images[0] }} className="h-full w-full" />
        ) : (
          <Briefcase size={20} color={TC.brandText} />
        )}
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[0.875rem] font-semibold text-ink" numberOfLines={1}>
          {service?.title || 'Oppdrag'}
        </Text>
        {service?.categories?.length ? (
          <Text className="mt-0.5 text-[0.8125rem] text-muted" numberOfLines={1}>
            {service.categories.join(', ')}
          </Text>
        ) : null}
        {chat.agreedPrice != null ? (
          <Text className="mt-1 text-[0.8125rem] font-semibold text-brand-text">
            Avtalt pris: {chat.agreedPrice.toLocaleString('nb-NO')} kr
          </Text>
        ) : service?.price != null ? (
          <Text className="mt-1 text-[0.8125rem] font-semibold text-brand-text">
            {service.price.toLocaleString('nb-NO')} kr
          </Text>
        ) : null}
      </View>
      {status ? (
        <View className="rounded-full bg-surface-2 px-2.5 py-1">
          <Text className="text-[0.8125rem] font-semibold text-muted">
            {STATUS_LABELS[status] || (order?.paymentStatus === 'paid' ? 'Betalt' : 'Forespørsel')}
          </Text>
        </View>
      ) : null}
      <ShieldCheck size={16} color={isCustomer ? TC.brandText : tc('#63665F', 'muted')} />
    </Pressable>
  );
}

export default function ChatDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ chatId: string | string[] }>();
  const chatId = (Array.isArray(params.chatId) ? params.chatId[0] : params.chatId) || '';
  const user = useAuthStore((state) => state.user);
  const userId =
    user && typeof user === 'object' && '_id' in user && typeof user._id === 'string'
      ? user._id
      : null;
  const queryClient = useQueryClient();
  const query = useChatDetail(chatId);
  const sendMutation = useSendChatMessage(chatId);
  const listRef = useRef<FlatList<ChatItem<ChatMessage>>>(null);
  const [text, setText] = useState('');
  const [reporting, setReporting] = useState(false);
  const [creatingContract, setCreatingContract] = useState(false);

  useEffect(() => {
    if (!chatId) return;
    const socket = getChatSocket();
    let joined = false;
    const joinChat = () => {
      // On every REconnect, fetch what arrived while the socket was down.
      if (joined) void queryClient.invalidateQueries({ queryKey: queryKeys.chats.detail(chatId) });
      joined = true;
      socket.emit('join-chat', chatId);
    };
    const handleMessage = (data: { chatId: string; message: ChatMessage }) => {
      if (data.chatId !== chatId) return;
      queryClient.setQueryData(
        queryKeys.chats.detail(chatId),
        (current: { pages: ChatDetail[]; pageParams: unknown[] } | undefined) =>
          upsertChatMessage(current, data.message)
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
    };
    const handleChatError = (data: { chatId?: string; error?: string }) => {
      if (__DEV__ && data.chatId === chatId)
        console.warn('[chat] room access failed:', data.error || 'unknown error');
    };
    socket.on('connect', joinChat);
    socket.on('receive-message', handleMessage);
    socket.on('chat-error', handleChatError);
    if (socket.connected) joinChat();
    return () => {
      socket.emit('leave-chat', chatId);
      socket.off('connect', joinChat);
      socket.off('receive-message', handleMessage);
      socket.off('chat-error', handleChatError);
    };
  }, [chatId, queryClient]);

  const chat = query.data?.pages[0];
  const messages = useMemo(() => {
    const pages =
      query.data?.pages
        .slice()
        .reverse()
        .flatMap((page) => page.messages) || [];
    const seen = new Set<string>();
    return pages.filter((message) => {
      const key = messageIdentity(message);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [query.data?.pages]);
  const items = useMemo(() => groupSystemMessages(messages), [messages]);
  // The other person's public profile, for "På Jobblo siden" and the rating (the chat
  // payload only carries name, avatar and verified).
  const otherId = chat
    ? idOf(chat.clientId) === userId
      ? idOf(chat.providerId)
      : idOf(chat.clientId)
    : null;
  const { data: otherProfile } = usePublicProfile(otherId);
  const composer = useGlass(24);
  const titlePill = useGlass(22);
  const jobPill = useGlass(20);
  // Once the big avatar and name have scrolled away, a small one sits between ‹ and •••.
  const introEnd = useRef(220);
  const compactRef = useRef(false);
  const [compact, setCompact] = useState(false);
  const titleFade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(titleFade, {
      toValue: compact ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [compact, titleFade]);

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || sendMutation.isPending || !chatId) return;
    sendMutation.mutate(trimmed, {
      onSuccess: () => {
        setText('');
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
      },
    });
  };
  /** Opens the chat's order, or the one a system message points at. Customers land on checkout/status/approval, providers on their work page. */
  const openOrder = (targetId?: string) => {
    const orderId = targetId || idOf(chat?.orderId);
    if (!chat || !orderId) return;
    const order =
      typeof chat.orderId === 'object' && chat.orderId?._id === orderId ? chat.orderId : undefined;
    router.push(
      orderRouteForRole(
        orderId,
        chat.serviceId?.userId === userId,
        order ? order.status || chat.status : undefined,
        order?.paymentStatus
      )
    );
  };

  const createContract = async () => {
    if (!chatId || creatingContract) return;
    try {
      setCreatingContract(true);
      await createChatContract(chatId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.chats.detail(chatId) });
    } catch (error) {
      Alert.alert('Kunne ikke opprette kontrakt', serverError(error) || 'Prøv igjen.');
    } finally {
      setCreatingContract(false);
    }
  };

  // "…" menu and its dialogs (shadcn-style DropdownMenu + ConfirmDialog, no native popups).
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<'report' | 'delete' | 'reported' | 'block' | null>(null);
  const blockMutation = useUnblockUser();
  const [dialogPending, setDialogPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [reportMessage, setReportMessage] = useState('');
  const openDialog = (kind: 'report' | 'delete' | 'block') => {
    setDialogError(null);
    setDialog(kind);
  };
  const closeDialog = () => {
    if (dialogPending) return;
    setDialog(null);
    setDialogError(null);
  };

  const confirmDelete = async () => {
    try {
      setDialogPending(true);
      await deleteChatForMe(chatId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
      setDialog(null);
      router.back();
    } catch (error) {
      setDialogError(serverError(error) || 'Kunne ikke slette samtalen. Prøv igjen.');
    } finally {
      setDialogPending(false);
    }
  };

  // POST /users/:id/block toggles: blocks, or lifts a block already in place.
  const confirmBlock = async (otherId?: string) => {
    if (!otherId) return;
    try {
      setDialogPending(true);
      await blockMutation.mutateAsync(otherId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
      setDialog(null);
    } catch (error) {
      setDialogError(serverError(error) || 'Kunne ikke oppdatere blokkeringen. Prøv igjen.');
    } finally {
      setDialogPending(false);
    }
  };

  const confirmReport = async () => {
    if (!chatId) return;
    try {
      setDialogPending(true);
      setReporting(true);
      const result = await submitChatReport(chatId, {
        scope: 'chat',
        reportType: 'other',
        title: 'Rapportering av samtale',
        description:
          'Jeg rapporterer denne samtalen fordi den inkluderer uønsket eller upassende innhold som trenger vurdering av Jobblo.',
      });
      setReportMessage(result.message || 'Jobblo har mottatt rapporten og vil vurdere den.');
      setDialog('reported');
    } catch (error) {
      setDialogError(serverError(error) || 'Kunne ikke sende rapporten. Prøv igjen senere.');
    } finally {
      setDialogPending(false);
      setReporting(false);
    }
  };

  if (query.isLoading)
    return (
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
        <ChatSkeleton />
      </SafeAreaView>
    );
  if (query.isError || !chat)
    return (
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
        <ErrorState
          title="Samtale ikke funnet"
          message="Kunne ikke laste denne samtalen."
          actionLabel="Tilbake"
          onAction={() => router.back()}
        />
      </SafeAreaView>
    );

  const other = chat.clientId?._id === userId ? chat.providerId : chat.clientId;
  const otherBlocked =
    !!other?._id &&
    Array.isArray(user?.blockedUsers) &&
    user.blockedUsers.map(String).includes(String(other._id));
  // Only the job owner (customer) creates the contract. Paying is reached from the job card
  // (it opens checkout); the separate "Start fiks ferdig-betaling" button was removed.
  const isCustomer = !!userId && chat.serviceId?.userId === userId;
  const chatReady = chat.status === 'agreed' || chat.agreedPrice != null || !!chat.orderId;
  const action =
    !isCustomer || !chat.serviceId || !chatReady || chat.orderId
      ? null
      : {
          label: creatingContract ? 'Oppretter kontrakt…' : 'Opprett kontrakt',
          onPress: () => void createContract(),
        };
  return (
    // 'bottom' too: there is no tab bar here, so the composer keeps clear of the home bar.
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} className="flex-1 bg-page">
      <KeyboardAvoidingView
        className="flex-1"
        // Both platforms: on Android (edge-to-edge since SDK 54) the keyboard no longer
        // resizes the window, so without this the composer sat behind the keyboard.
        behavior="padding"
      >
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(item) => (isStatusGroup(item) ? item.key : messageKey(item))}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}
          onContentSizeChange={() => {
            if (!query.isFetchingNextPage) listRef.current?.scrollToEnd({ animated: false });
          }}
          onScroll={(event) => {
            const next = event.nativeEvent.contentOffset.y > introEnd.current - 48;
            if (next !== compactRef.current) {
              compactRef.current = next;
              setCompact(next);
            }
            if (
              event.nativeEvent.contentOffset.y < 80 &&
              query.hasNextPage &&
              !query.isFetchingNextPage
            )
              void query.fetchNextPage();
          }}
          scrollEventThrottle={32}
          maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
          // FINN's chat: who you are talking to, the job, and the house rule, above the thread.
          ListHeaderComponent={
            <View className="pb-2">
              <View
                onLayout={(event) => {
                  introEnd.current = event.nativeEvent.layout.y + event.nativeEvent.layout.height;
                }}
              >
                <ChatIntro
                  other={other}
                  profile={otherProfile}
                  onOpenProfile={() =>
                    other?._id &&
                    router.push({
                      pathname: '/(app)/profile/[userId]',
                      params: { userId: String(other._id) },
                    })
                  }
                />
                <JobContext chat={chat} userId={userId} onPress={() => openOrder()} />
              </View>
              <Text className="mt-3 text-center text-[0.75rem] leading-4 text-muted">
                Jobblo forbeholder seg retten til å kontrollere og stoppe meldinger.
              </Text>
            </View>
          }
          ListEmptyComponent={
            <Text className="mt-8 text-center text-[0.875rem] text-muted">
              Ingen meldinger ennå. Skriv den første!
            </Text>
          }
          renderItem={({ item, index }) => {
            const at = itemTime(item);
            const previous = index > 0 ? itemTime(items[index - 1]) : undefined;
            const stamp = showStamp(at, previous) ? (
              <Text className="mb-2 mt-4 text-center text-[0.75rem] text-muted">
                {formatStamp(at)}
              </Text>
            ) : null;
            if (isStatusGroup(item))
              return !SHOW_STATUS_CARDS ? null : (
                <>
                  {stamp}
                  <StatusCard items={item.items} onOpen={openOrder} />
                </>
              );
            const own = idOf(item.senderId) === userId;
            return (
              <>
                {stamp}
                <View
                  className={[
                    'mb-1.5 max-w-[80%] rounded-3xl px-4 py-2.5',
                    own ? 'self-end rounded-br-lg bg-brand' : 'self-start rounded-bl-lg bg-surface',
                  ].join(' ')}
                >
                  <Text
                    className={[
                      'text-[0.9375rem] leading-[1.35rem]',
                      own ? 'text-white' : 'text-ink',
                    ].join(' ')}
                  >
                    {item.text || ''}
                  </Text>
                </View>
              </>
            );
          }}
        />

        {action ? (
          <View className="px-4 pb-1 pt-2">
            <Button
              label={action.label}
              onPress={action.onPress}
              disabled={creatingContract}
              fullWidth
            />
          </View>
        ) : null}

        {/* FINN's composer: a glass pill, the send button inside it. */}
        <View className="px-4 pb-2 pt-2">
          <View
            className="min-h-[48px] flex-row items-end py-1 pl-4 pr-1"
            style={[composer, { elevation: LIQUID_GLASS ? 0 : 3 }]}
          >
            <GlassFill radius={24} />
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Skriv melding …"
              placeholderTextColor={TC.placeholder}
              multiline
              accessibilityLabel="Skriv melding"
              className="max-h-28 flex-1 py-2.5 text-[0.9375rem] text-ink"
            />
            <Pressable
              onPress={send}
              disabled={!text.trim() || sendMutation.isPending}
              accessibilityRole="button"
              accessibilityLabel="Send melding"
              className="mb-0.5 h-10 w-10 items-center justify-center rounded-full bg-brand disabled:opacity-40"
            >
              <Send size={17} color="#FFF" />
            </Pressable>
          </View>
        </View>

        {/* Floating over the thread, as FINN: back left, the menu right. */}
        <View
          pointerEvents="box-none"
          className="absolute left-0 right-0 top-2 flex-row items-center justify-between px-4"
          style={{ zIndex: 10, elevation: 10, shadowColor: 'transparent' }}
        >
          <GlassButton label="Tilbake" onPress={() => router.back()}>
            <ChevronLeft size={22} color={TC.ink} />
          </GlassButton>
          <Animated.View
            pointerEvents={compact ? 'box-none' : 'none'}
            className="flex-1 items-center px-2"
            style={{
              opacity: titleFade,
              transform: [
                {
                  translateY: titleFade.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }),
                },
              ],
            }}
          >
            <Pressable
              onPress={() =>
                other?._id &&
                router.push({
                  pathname: '/(app)/profile/[userId]',
                  params: { userId: String(other._id) },
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`Se profilen til ${nameOf(other)}`}
              className="h-11 max-w-full flex-row items-center gap-2 pl-1.5 pr-4"
              style={[titlePill, { elevation: LIQUID_GLASS ? 0 : 4 }]}
            >
              <GlassFill radius={22} />
              <View className="h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-surface-2">
                {other?.avatarUrl ? (
                  <Image source={{ uri: other.avatarUrl }} className="h-full w-full" />
                ) : (
                  <Text className="text-[0.75rem] font-semibold text-brand-text">
                    {initials(nameOf(other))}
                  </Text>
                )}
              </View>
              <Text numberOfLines={1} className="shrink text-[0.9375rem] font-semibold text-ink">
                {nameOf(other)}
              </Text>
            </Pressable>
          </Animated.View>
          <View className="flex-row items-center gap-2">
            {reporting ? <ActivityIndicator size="small" color={TC.brandText} /> : null}
            <GlassButton label="Flere valg" onPress={() => setMenuOpen(true)}>
              <MoreHorizontal size={21} color={TC.ink} />
            </GlassButton>
          </View>
        </View>

        {/* The job stays in reach: once the intro and job card scroll away, a compact copy
            sits under ‹ and •••. */}
        <Animated.View
          pointerEvents={compact ? 'box-none' : 'none'}
          className="absolute left-0 right-0 px-4"
          style={{
            top: 60,
            zIndex: 9,
            elevation: 9,
            shadowColor: 'transparent',
            opacity: titleFade,
            transform: [
              { translateY: titleFade.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) },
            ],
          }}
        >
          <Pressable
            onPress={() => openOrder()}
            accessibilityRole="button"
            accessibilityLabel={`Oppdrag: ${chat.serviceId?.title || 'Oppdrag'}`}
            className="min-h-[68px] flex-row items-center gap-3 py-2.5 pl-2.5 pr-4"
            style={[jobPill, { elevation: LIQUID_GLASS ? 0 : 4 }]}
          >
            <GlassFill radius={20} solid />
            <View className="h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-tint">
              {chat.serviceId?.images?.[0] ? (
                <Image source={{ uri: chat.serviceId.images[0] }} className="h-full w-full" />
              ) : (
                <Briefcase size={17} color={TC.brandText} />
              )}
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-[0.875rem] font-semibold text-ink" numberOfLines={1}>
                {chat.serviceId?.title || 'Oppdrag'}
              </Text>
              {chat.agreedPrice != null || chat.serviceId?.price != null ? (
                <Text className="text-[0.8125rem] font-semibold text-brand-text">
                  {(chat.agreedPrice ?? chat.serviceId?.price ?? 0).toLocaleString('nb-NO')} kr
                </Text>
              ) : null}
            </View>
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>

      <DropdownMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={[
          {
            label: otherBlocked ? 'Opphev blokkering' : 'Blokker bruker',
            icon: otherBlocked ? UserRoundCheck : UserRoundX,
            onPress: () => openDialog('block'),
          },
          { label: 'Rapporter bruker', icon: TriangleAlert, onPress: () => openDialog('report') },
          {
            label: 'Slett samtalen',
            icon: Trash2,
            destructive: true,
            onPress: () => openDialog('delete'),
          },
        ]}
      />
      {/* One dialog for "report?" and "sent": swapping two Modals at once fails on iOS. */}
      <ConfirmDialog
        visible={dialog === 'report' || dialog === 'reported'}
        title={dialog === 'reported' ? 'Rapport sendt' : `Rapporter ${nameOf(other)}?`}
        message={
          dialog === 'reported'
            ? reportMessage
            : 'Rapporten sendes til Jobblo for vurdering. Bare den andre personen i samtalen blir markert som rapportert.'
        }
        confirmLabel={dialog === 'reported' ? 'OK' : 'Send rapport'}
        pendingLabel="Sender…"
        destructive={dialog === 'report'}
        hideCancel={dialog === 'reported'}
        isPending={dialogPending}
        errorMessage={dialogError}
        onConfirm={() => (dialog === 'reported' ? setDialog(null) : void confirmReport())}
        onClose={closeDialog}
      />
      <ConfirmDialog
        visible={dialog === 'block'}
        title={
          otherBlocked ? `Oppheve blokkeringen av ${nameOf(other)}?` : `Blokkere ${nameOf(other)}?`
        }
        message={
          otherBlocked
            ? 'Dere kan sende meldinger og inngå avtaler igjen.'
            : 'Dere kan ikke sende meldinger til hverandre eller inngå nye avtaler. Du kan oppheve blokkeringen under Innstillinger → Blokkerte brukere.'
        }
        confirmLabel={otherBlocked ? 'Opphev' : 'Blokker'}
        pendingLabel={otherBlocked ? 'Opphever…' : 'Blokkerer…'}
        destructive={!otherBlocked}
        isPending={dialogPending}
        errorMessage={dialogError}
        onConfirm={() => void confirmBlock(other?._id ? String(other._id) : undefined)}
        onClose={closeDialog}
      />
      <ConfirmDialog
        visible={dialog === 'delete'}
        title="Slette samtalen?"
        message="Samtalen fjernes fra listen din. Den andre personen beholder sin kopi."
        confirmLabel="Slett"
        pendingLabel="Sletter…"
        destructive
        isPending={dialogPending}
        errorMessage={dialogError}
        onConfirm={() => void confirmDelete()}
        onClose={closeDialog}
      />
    </SafeAreaView>
  );
}
