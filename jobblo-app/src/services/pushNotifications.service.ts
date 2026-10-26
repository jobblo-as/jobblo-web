import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../api/client';

const TOKEN_KEY = 'jobblo.push-token';
/**
 * Set by "Deaktiver på denne enheten", cleared by "Aktiver push-varsler". Per device and kept
 * across logout: the choice was about this phone. Without it the automatic registration on
 * every cold start undid the opt-out.
 */
const OPTED_OUT_KEY = 'jobblo.push-opted-out';
type NotificationModule = typeof import('expo-notifications');
let pushTokenSubscription: { remove: () => void } | null = null;
let notificationBootstrapPromise: Promise<boolean> | null = null;

let staleBuildWarned = false;

function loadNotifications(): NotificationModule | null {
  // A native build made before the Expo SDK 58 upgrade lacks expo-notifications' newer native
  // module, and importing the JS package then throws during module init (a red error on every
  // start). Check first and switch push off with one clear warning: rebuild the app to fix.
  const { requireOptionalNativeModule } = require('expo-modules-core') as typeof import('expo-modules-core');
  if (Platform.OS !== 'web' && !requireOptionalNativeModule('ExpoTopicSubscriptionModule')) {
    if (!staleBuildWarned) {
      staleBuildWarned = true;
      console.warn('[push] This app build is older than its code (Expo SDK 58): push is off. Rebuild with `npx expo prebuild --clean` + `npx expo run:android` (or a new EAS build).');
    }
    return null;
  }
  try {
    return require('expo-notifications') as NotificationModule;
  } catch {
    return null;
  }
}

function isExpoGo() {
  return (Constants as unknown as { appOwnership?: string }).appOwnership === 'expo';
}

/**
 * The backend delivers through FCM only (backend/services/pushNotifications.js), and on iOS
 * `getDevicePushTokenAsync` returns a raw APNs token that FCM rejects. So iOS cannot be
 * registered yet, and asking for the permission there anyway (App Store 5.1.1) is worse than
 * not offering push. Remove the iOS clause once the build carries Firebase iOS messaging (FCM
 * token) or the backend sends to APNs.
 */
function pushUnsupported() {
  return Platform.OS === 'web' || Platform.OS === 'ios' || isExpoGo();
}

export function configurePushNotifications() {
  if (notificationBootstrapPromise) return notificationBootstrapPromise;
  notificationBootstrapPromise = (async () => {
    if (Platform.OS === 'web' || isExpoGo()) return false;
    const notifications = loadNotifications();
    if (!notifications) return false;

    notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    if (Platform.OS === 'android') {
      await notifications.setNotificationChannelAsync('messages', {
        name: 'Meldinger',
        importance: 5,
        // No `sound`: expo-notifications reads it as a bundled file name, so 'default' failed
        // with "Custom sound 'default' not found". Left out, the channel uses the system sound.
        enableVibrate: true,
      });
    }
    return true;
  })();
  return notificationBootstrapPromise;
}

export async function getPushPermission(): Promise<'granted' | 'denied' | 'undetermined' | 'unavailable'> {
  if (pushUnsupported()) return 'unavailable';
  const notifications = loadNotifications();
  if (!notifications) return 'unavailable';
  const result = await notifications.getPermissionsAsync();
  return result.status;
}

/** `automatic`: the app-start registration, which respects an opt-out. The settings button does not. */
export async function registerPushNotifications({ automatic = false }: { automatic?: boolean } = {}) {
  if (pushUnsupported()) return { status: 'unavailable' as const, registered: false };
  if (automatic && (await AsyncStorage.getItem(OPTED_OUT_KEY))) return { status: 'undetermined' as const, registered: false };
  if (!automatic) await AsyncStorage.removeItem(OPTED_OUT_KEY);
  const notifications = loadNotifications();
  if (!notifications) return { status: 'unavailable' as const, registered: false };

  await configurePushNotifications();

  let permission = await notifications.getPermissionsAsync();
  if (permission.status === 'undetermined') permission = await notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') return { status: permission.status, registered: false };

  const registerNativeToken = async (token: string) => {
    const masked = token.length > 10 ? `${token.slice(0, 6)}...${token.slice(-4)}` : 'short';
    console.log('[push] native FCM token obtained:', masked);
    try {
      await apiClient.post('/push-tokens', {
        token,
        platform: Platform.OS,
        deviceId: Constants.deviceId || undefined,
      });
      await AsyncStorage.setItem(TOKEN_KEY, token);
      console.log('[push] backend token registration succeeded');
    } catch (error) {
      console.error('[push] backend token registration failed:', error instanceof Error ? error.message : error);
      throw error;
    }
  };

  const token = (await notifications.getDevicePushTokenAsync()).data;
  await registerNativeToken(String(token));
  pushTokenSubscription?.remove();
  pushTokenSubscription = notifications.addPushTokenListener(({ data }) => {
    void registerNativeToken(String(data)).catch(() => undefined);
  });
  return { status: 'granted' as const, registered: true };
}

/**
 * `optOut`: the person switched push off here (settings), so app start must not re-register
 * (for any account on this phone, until someone taps "Aktiver" again). Logout does not opt out.
 */
export async function deactivateRegisteredPushToken({ optOut = false }: { optOut?: boolean } = {}) {
  pushTokenSubscription?.remove();
  pushTokenSubscription = null;
  if (optOut) await AsyncStorage.setItem(OPTED_OUT_KEY, '1');
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return;
  await apiClient.delete('/push-tokens/current', { data: { token } });
  // Only once the server confirmed: a kept key lets the next logout or tap retry, where
  // dropping it on a failed call left the device receiving pushes with no way to stop them.
  await AsyncStorage.removeItem(TOKEN_KEY);
}

/** Clears this app's notifications from the system tray, so the next person on the phone does not see them. */
export async function dismissDeliveredNotifications() {
  if (Platform.OS === 'web') return;
  await loadNotifications()?.dismissAllNotificationsAsync();
}

export async function getRegisteredPushToken() {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export type PushNotificationData = {
  notificationId?: string;
  type?: string;
  chatId?: string;
  serviceId?: string;
  jobId?: string;
  requestId?: string;
  applicationId?: string;
};

export function subscribeToPushResponses(onNotification: (data: PushNotificationData) => void) {
  if (Platform.OS === 'web' || isExpoGo()) return () => undefined;
  const notifications = loadNotifications();
  if (!notifications) return () => undefined;
  const subscription = notifications.addNotificationResponseReceivedListener((response) => {
    const data = {
      ...(response.notification.request.content.data as PushNotificationData),
      notificationId: response.notification.request.identifier,
    };
    if (!data || typeof data.type !== 'string') return;
    onNotification(data);
  });
  void notifications.getLastNotificationResponseAsync().then((response) => {
    if (!response) return;
    const data = {
      ...(response.notification.request.content.data as PushNotificationData),
      notificationId: response.notification.request.identifier,
    };
    if (data && typeof data.type === 'string') onNotification(data);
  });
  return () => subscription.remove();
}
