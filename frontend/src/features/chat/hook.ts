import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { getMyChats, getChatById, sendMessage } from '../../api/chatAPI';
import { getErrorMessage } from '../../utils/getErrorMessage';
import { applyIncomingMessage, refreshChats } from './refreshChats';

export const useChatQueries = (conversationId?: string) => {
  const queryClient = useQueryClient();

  const chatsQuery = useQuery({
    queryKey: ['chats'],
    queryFn: getMyChats,
    refetchOnWindowFocus: false,
  });

  const activeChatQuery = useQuery({
    queryKey: ['chat', conversationId],
    queryFn: () => getChatById(conversationId!),
    enabled: !!conversationId,
    refetchOnWindowFocus: false,
  });

  const sendMutation = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => sendMessage(id, text),
    // The response is the saved message: put it in the caches, no refetch (the socket echo
    // that follows is the same message and is skipped).
    onSuccess: (message, { id }) => {
      if (!applyIncomingMessage(queryClient, id, message)) refreshChats(queryClient, id);
    },
    // A failed send produced nothing at all: no toast, no retry, no failed state.
    // The message simply vanished and the user believed it had been delivered.
    onError: (err) => {
      toast.error(getErrorMessage(err, 'Meldingen ble ikke sendt. Prøv igjen.'));
    },
  });

  return { chatsQuery, activeChatQuery, sendMutation };
};
