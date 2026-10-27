import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'jobblo.ai-consent';

/**
 * May the post-job flow send photos and answers to the AI (OpenAI)? App Store 5.1.2(i): asked
 * once, before the first photo, and changeable on the text step. Per device, kept across logout.
 * `null` = not asked yet; `loaded` = the saved answer has been read.
 */
export const useAiConsent = create<{ value: boolean | null; loaded: boolean; set: (value: boolean) => void }>((set) => ({
  value: null,
  loaded: false,
  set: (value) => {
    set({ value });
    void AsyncStorage.setItem(KEY, value ? 'yes' : 'no').catch(() => undefined);
  },
}));

void AsyncStorage.getItem(KEY)
  .then((saved) => useAiConsent.setState({ value: saved === 'yes' ? true : saved === 'no' ? false : null, loaded: true }))
  .catch(() => useAiConsent.setState({ loaded: true }));
