import { useState } from 'react';

export type ListingView = 'grid' | 'list';

const KEY = 'jobblo-listing-view';

const read = (): ListingView => {
  try {
    return localStorage.getItem(KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
};

/**
 * The job list's grid/list choice. A per-viewer convenience, so it lives in this browser
 * only; grid when storage is blocked or nothing was chosen yet.
 */
export function useListingView() {
  const [view, setView] = useState<ListingView>(read);
  const change = (next: ListingView) => {
    setView(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage blocked: the choice lasts until the page is left */
    }
  };
  return [view, change] as const;
}
