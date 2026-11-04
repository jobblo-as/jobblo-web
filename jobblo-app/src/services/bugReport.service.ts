import { Platform, Dimensions } from 'react-native';
import Constants from 'expo-constants';
import apiClient from '../api/client';

export type BugScreenshot = { uri: string; name: string; type: string };

/** "Rapporter en feil" → POST /api/support/tickets (kind bug), lands in the developer dashboard. */
export async function sendBugReport(input: {
  message: string;
  pageUrl: string | null;
  screenshots: BugScreenshot[];
}) {
  const { width, height } = Dimensions.get('window');
  const form = new FormData();
  form.append('kind', 'bug');
  form.append('message', input.message);
  if (input.pageUrl) form.append('pageUrl', input.pageUrl);
  form.append('platform', Platform.OS === 'ios' ? 'ios' : 'android');
  form.append('appVersion', Constants.expoConfig?.version ?? '');
  form.append('screen', `${Math.round(width)}x${Math.round(height)}`);
  // React Native's FormData takes { uri, name, type } for a file.
  input.screenshots.forEach((s) => form.append('screenshots', s as unknown as Blob));
  return (
    await apiClient.post('/support/tickets', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 90_000,
    })
  ).data;
}
