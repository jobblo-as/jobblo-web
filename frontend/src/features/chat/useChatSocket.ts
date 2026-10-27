import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { initSocket } from '../../socket/socket';
import { useUserStore } from '../../stores/userStore';
import { useChatQueries } from '../../features/chat/hook';
import { applyIncomingMessage, applyMessagesRead, refreshChats } from './refreshChats';
import type { ChatMessage } from '../../api/chatAPI';

export const useChatSocket = (conversationId?: string) => {
  const queryClient = useQueryClient();
  const { user } = useUserStore();
  const userId = user?._id;
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);

  const { chatsQuery, activeChatQuery, sendMutation } = useChatQueries(conversationId);

  useEffect(() => {
    const socket = initSocket();
    if (!socket || !userId) return;

    // Rooms live on the server-side socket, so a reconnect (the server now closes sockets
    // when the access token expires, about hourly) starts with none: join again on every
    // connect, or live messages stop until the conversation is reopened.
    const joinRooms = () => {
      socket.emit('setup', userId);
      if (conversationId) {
        socket.emit('join-chat', conversationId);
        socket.emit('mark-as-read', { chatId: conversationId, userId });
      }
    };
    // mark-as-read answers with messages-read, which updates the unread state in the caches.
    joinRooms();
    const handleReconnect = () => {
      joinRooms();
      // Messages may have arrived while disconnected.
      refreshChats(queryClient, conversationId);
    };

    // Socket listeners. The Header applies the same events (it listens on every page);
    // applying one twice is harmless, the message is matched by _id.
    const handleReceiveMessage = (data: { chatId: string; message?: ChatMessage }) => {
      if (!applyIncomingMessage(queryClient, data.chatId, data.message))
        refreshChats(queryClient, data.chatId);

      if (conversationId === data.chatId) {
        socket.emit('mark-as-read', { chatId: conversationId, userId });
      }
    };

    const handleMessagesRead = (data: { chatId: string; userId: string }) => {
      applyMessagesRead(queryClient, data.chatId, data.userId);
    };

    const handleUserOnline = (onlineUserIds: string[]) => {
      setOnlineUsers(onlineUserIds);
    };

    socket.on('connect', handleReconnect);
    socket.on('receive-message', handleReceiveMessage);
    socket.on('messages-read', handleMessagesRead);
    socket.on('get-online-users', handleUserOnline);

    return () => {
      if (conversationId) socket.emit('leave-chat', conversationId);
      // The socket is a module-level singleton, so handlers registered here
      // outlive the component unless they are removed. Without these three
      // socket.off calls, every conversation you opened added another copy: after
      // N opens a single inbound message ran the handler N times, each firing two
      // invalidateQueries — 2N duplicate refetches on the busiest screen in the
      // app.
      socket.off('connect', handleReconnect);
      socket.off('receive-message', handleReceiveMessage);
      socket.off('messages-read', handleMessagesRead);
      socket.off('get-online-users', handleUserOnline);
    };
  }, [conversationId, userId, queryClient]);

  return {
    userId,
    user,
    onlineUsers,
    chatsQuery,
    activeChatQuery,
    sendMutation,
  };
};
