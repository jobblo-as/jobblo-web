import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ListingView = 'grid' | 'list';

const KEY = 'jobblo.listing-view';

/**
 * Utforsk's grid/list choice (the toggle beside "Nyeste først", "Jobs without photos" task 4).
 * Per device; grid until the saved choice is read, and when storage fails.
 */
export const useListingView = create<{ view: ListingView; setView: (view: ListingView) => void }>(
  (set) => ({
    view: 'grid',
    setView: (view) => {
      set({ view });
      void AsyncStorage.setItem(KEY, view).catch(() => undefined);
    },
  })
);

void AsyncStorage.getItem(KEY)
  .then((saved) => {
    if (saved === 'list') useListingView.setState({ view: 'list' });
  })
  .catch(() => undefined);
