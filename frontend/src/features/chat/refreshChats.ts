import type { QueryClient } from '@tanstack/react-query';
import type { Chat, ChatMessage } from '../../api/chatAPI';

/**
 * The chat caches (['chats'] list, ['chat', id] thread) follow socket events without a refetch
 * where the event carries the data: receive-message has the whole message, messages-read who
 * read. Every open page used to refetch both on each event (send, echo, read, local read):
 * 3–4 GET /api/chats/get + GET /api/chats/:id per message, per page.
 */

type IdRef = string | { _id?: string } | null | undefined;
const idOf = (ref: IdRef) => (!ref ? '' : typeof ref === 'string' ? ref : String(ref._id || ''));

/**
 * Put a message (socket payload or our own send's response) into the cached list and thread.
 * Returns false when the list has no such chat yet (a new conversation): refetch then.
 */
export function applyIncomingMessage(queryClient: QueryClient, chatId: string, message?: ChatMessage): boolean {
  if (!message?._id) return false;
  let listed = false;
  queryClient.setQueryData<Chat[]>(['chats'], (chats) => {
    if (!Array.isArray(chats)) return chats;
    const i = chats.findIndex((c) => c._id === chatId);
    if (i < 0) return chats;
    listed = true;
    // The list carries only the last message; newest conversation first, as the server sorts.
    const chat = { ...chats[i], messages: [message], lastMessage: message.text, updatedAt: message.createdAt };
    return [chat, ...chats.slice(0, i), ...chats.slice(i + 1)];
  });
  queryClient.setQueryData<Chat>(['chat', chatId], (chat) => {
    if (!chat?.messages || chat.messages.some((m) => m._id === message._id)) return chat;
    // The thread shows the sender's name and avatar: take them from the populated participants.
    const sender = [chat.clientId, chat.providerId].find((p) => p && typeof p === 'object' && idOf(p) === idOf(message.senderId as IdRef));
    return { ...chat, messages: [...chat.messages, { ...message, senderId: (sender ?? message.senderId) as ChatMessage['senderId'] }] };
  });
  return listed;
}

/** messages-read: `userId` has now seen every message in the chat. */
export function applyMessagesRead(queryClient: QueryClient, chatId: string, userId: string) {
  const mark = (m: ChatMessage): ChatMessage =>
    (m.seenBy as IdRef[] | undefined)?.some((id) => idOf(id) === userId) ? m : { ...m, seenBy: [...(m.seenBy || []), userId] };
  queryClient.setQueryData<Chat[]>(['chats'], (chats) =>
    Array.isArray(chats) ? chats.map((c) => (c._id === chatId ? { ...c, messages: c.messages?.map(mark) } : c)) : chats
  );
  queryClient.setQueryData<Chat>(['chat', chatId], (chat) => (chat?.messages ? { ...chat, messages: chat.messages.map(mark) } : chat));
}

/**
 * Refetch, for what the events do not carry (a reconnect, a new conversation). Calls within
 * WINDOW_MS share one refetch; an invalidate during a fetch would cancel it and start another,
 * and getMyChats does not abort, so each reached the server.
 */
const WINDOW_MS = 150;
const pendingChatIds = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function refreshChats(queryClient: QueryClient, chatId?: string) {
  if (chatId) pendingChatIds.add(chatId);
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const ids = [...pendingChatIds];
    pendingChatIds.clear();
    void queryClient.invalidateQueries({ queryKey: ['chats'] });
    for (const id of ids) void queryClient.invalidateQueries({ queryKey: ['chat', id] });
  }, WINDOW_MS);
}
