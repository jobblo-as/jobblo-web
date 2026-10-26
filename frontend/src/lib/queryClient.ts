import { QueryClient } from '@tanstack/react-query';

/** The app's one query cache. A module so the user store can clear it on every logout. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
