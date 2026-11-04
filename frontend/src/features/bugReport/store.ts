import { create } from 'zustand';

/**
 * "Rapporter en feil" opens on the page you are on, from anywhere (footer, menu, settings):
 * one dialog mounted in App reads this. `errorRef` is the ErrorLog reference of an error screen.
 */
export const useBugReport = create<{
  open: boolean;
  errorRef: string | null;
  openBugReport: (errorRef?: string | null) => void;
  closeBugReport: () => void;
}>((set) => ({
  open: false,
  errorRef: null,
  openBugReport: (errorRef = null) => set({ open: true, errorRef }),
  closeBugReport: () => set({ open: false, errorRef: null }),
}));
