import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GlassFill, useGlass } from '../../../src/components/ui/GlassButton';
import { Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useState } from 'react';
import { MessagesSquare } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../../src/store/authStore';
import { useMessages } from '../../../src/hooks/useMessages';
import type {
  MessageConversation,
  MessageParticipant,
} from '../../../src/services/messages.service';
import { Button } from '../../../src/components/ui/Button';
import { ErrorState } from '../../../src/components/ui/ErrorState';
import { TC } from '../../../src/theme/colors';
import { MessagesSkeleton } from '../../../src/components/skeletons/ScreenSkeletons';

function formatTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
}

function otherParticipant(chat: MessageConversation, userId?: string | null) {
  return chat.clientId?._id === userId ? chat.providerId : chat.clientId;
}

function hasUnread(chat: MessageConversation, userId?: string | null) {
  const latest = chat.messages?.[0];
  return Boolean(
    userId &&
    latest?.senderId &&
    String(typeof latest.senderId === 'string' ? latest.senderId : latest.senderId._id) !==
      userId &&
    !latest.seenBy?.includes(userId)
  );
}

function conversationPreview(chat: MessageConversation) {
  return chat.lastMessage?.trim() || chat.messages?.[0]?.text?.trim() || 'Ingen meldinger ennå';
}

function ConversationRow({
  chat,
  userId,
  onPress,
}: {
  chat: MessageConversation;
  userId?: string | null;
  onPress: () => void;
}) {
  const person = otherParticipant(chat, userId);
  const personName = person?.name?.trim();
  const serviceTitle = chat.serviceId?.title?.trim();
  const title = serviceTitle || personName || 'Ukjent';
  const unread = hasUnread(chat, userId);
  const latest = chat.messages?.[0];
  const photo = chat.serviceId?.images?.[0] || chat.serviceId?.image || undefined;
  // ponytail: one glass/blur layer per row; fine for a chat list, a FlatList if it grows to hundreds.
  const glass = useGlass(16);
  return (
    <Pressable
      onPress={onPress}
      className="mb-3 flex-row items-center gap-3 p-4 active:opacity-80"
      style={glass}
    >
      <GlassFill radius={16} />
      <View className="relative shrink-0">
        <View className="h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-tint">
          {photo ? (
            <Image source={{ uri: photo }} className="h-full w-full" resizeMode="cover" />
          ) : (
            <MessagesSquare size={17} strokeWidth={2} color={TC.brandText} />
          )}
        </View>
        <View className="absolute -bottom-1 -right-1 h-6 w-6 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-tint">
          {person?.avatarUrl ? (
            <Image
              source={{ uri: person.avatarUrl }}
              className="h-full w-full"
              resizeMode="cover"
            />
          ) : (
            <Text className="text-[0.6875rem] font-semibold text-brand-text">
              {(person?.name?.charAt(0) || 'U').toUpperCase()}
            </Text>
          )}
        </View>
      </View>
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center justify-between gap-2">
          <Text
            className={[
              'flex-1 text-[0.9375rem] text-ink',
              unread ? 'font-bold' : 'font-semibold',
            ].join(' ')}
            numberOfLines={1}
          >
            {title}
          </Text>
          <Text className="text-[0.8125rem] text-muted">
            {formatTime(chat.updatedAt ?? latest?.createdAt)}
          </Text>
        </View>
        {serviceTitle && personName ? (
          <Text className="mt-0.5 text-[0.8125rem] text-muted" numberOfLines={1}>
            {personName}
          </Text>
        ) : null}
        <View className="mt-1 flex-row items-center gap-2">
          <Text
            className={[
              'flex-1 text-[0.8125rem]',
              unread ? 'font-medium text-ink' : 'text-muted',
            ].join(' ')}
            numberOfLines={1}
          >
            {conversationPreview(chat)}
          </Text>
          {unread ? <View className="h-2 w-2 shrink-0 rounded-full bg-brand" /> : null}
          {chat.serviceId?.isSold ? (
            <Text className="rounded-full bg-surface-2 px-2 py-0.5 text-[0.8125rem] font-semibold text-muted">
              Solgt
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function MessagesScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const userId =
    user && typeof user === 'object' && '_id' in user && typeof user._id === 'string'
      ? user._id
      : null;
  const query = useMessages();
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  if (query.isLoading)
    return (
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
        <MessagesSkeleton />
      </SafeAreaView>
    );
  if (query.isError)
    return (
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
        <ErrorState
          title="Kunne ikke laste meldinger"
          message="Sjekk internettforbindelsen din og prøv igjen."
          actionLabel="Prøv igjen"
          onAction={() => void query.refetch()}
        />
      </SafeAreaView>
    );
  if (!query.data?.length)
    return (
      <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void handleRefresh()}
              tintColor={TC.brandText}
            />
          }
        >
          <View className="flex-1 px-4 pt-6">
            <Text className="text-[0.8125rem] font-semibold uppercase tracking-[0.16em] text-muted">
              Meldinger
            </Text>
            <Text className="mt-2 text-[1.9rem] font-bold text-ink">Meldinger</Text>
            {/* As on the web's Meldinger: the chat icon in two soft rings, a sample exchange so
                the empty page shows what it is for, and the way to a first conversation. */}
            <View className="mt-8 items-center rounded-3xl bg-surface px-5 py-9">
              <View className="h-28 w-28 items-center justify-center rounded-full bg-tint/50">
                <View className="h-20 w-20 items-center justify-center rounded-full bg-tint">
                  <View className="h-14 w-14 items-center justify-center rounded-full bg-page">
                    <MessagesSquare size={24} color={TC.brandText} />
                  </View>
                </View>
              </View>
              <Text className="mt-5 text-center text-[1.25rem] font-bold text-ink">
                Ingen samtaler ennå
              </Text>
              <Text className="mt-2 text-center text-[0.9375rem] leading-6 text-muted">
                Når du søker på et oppdrag, eller noen søker på ditt, starter samtalen her.
              </Text>
              <View
                className="mt-6 w-full gap-2"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <View className="max-w-[85%] self-start rounded-2xl rounded-bl-md border border-line bg-page px-3.5 py-2.5">
                  <Text className="text-[0.875rem] font-semibold text-ink">
                    Hei! Jeg kan male stua di på lørdag.
                  </Text>
                </View>
                <View className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-brand px-3.5 py-2.5 opacity-80">
                  <Text className="text-[0.875rem] font-semibold text-white">
                    Supert, hva koster det?
                  </Text>
                </View>
                <View className="self-start rounded-2xl rounded-bl-md border border-line bg-page px-3.5 py-2.5 opacity-60">
                  <Text className="text-[0.875rem] font-semibold text-muted">Skriver …</Text>
                </View>
              </View>
              <View className="mt-6 w-full">
                <Button label="Finn oppdrag" onPress={() => router.push('/(app)/explore')} />
              </View>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} className="flex-1 bg-page">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={TC.brandText}
          />
        }
      >
        <View className="mb-6">
          <Text className="text-[0.8125rem] font-semibold uppercase tracking-[0.16em] text-muted">
            Meldinger
          </Text>
          <Text className="mt-2 text-[1.9rem] font-bold text-ink">Meldinger</Text>
        </View>
        <View>
          {query.data.map((chat) => (
            <ConversationRow
              key={chat._id}
              chat={chat}
              userId={userId}
              onPress={() =>
                router.push({ pathname: '/(app)/messages/[chatId]', params: { chatId: chat._id } })
              }
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
