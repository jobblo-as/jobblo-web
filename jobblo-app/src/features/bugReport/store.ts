import { create } from 'zustand';

/** Screens whose report is about another screen: the report is opened from here. */
const isSettings = (path: string) => path.startsWith('/profile/settings');

/**
 * "Rapporter en feil": opened from Innstillinger or an error screen. The page reported is
 * the last screen before settings (where the problem was), fed by the root layout.
 */
export const useBugReport = create<{
  open: boolean;
  lastScreen: string | null;
  trackScreen: (path: string) => void;
  openBugReport: () => void;
  closeBugReport: () => void;
}>((set) => ({
  open: false,
  lastScreen: null,
  trackScreen: (path) => {
    if (path && !isSettings(path)) set({ lastScreen: path });
  },
  openBugReport: () => set({ open: true }),
  closeBugReport: () => set({ open: false }),
}));
