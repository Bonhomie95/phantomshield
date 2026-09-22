/**
 * PhantomShield local notification service.
 * Guards against Expo Go, which removed push/background notification support in SDK 53.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const isExpoGo =
  Constants.executionEnvironment === 'storeClient' ||
  (Constants.appOwnership === 'expo');

let Notifications: typeof import('expo-notifications') | null = null;

async function getNotifications() {
  if (isExpoGo) return null;
  if (!Notifications) {
    Notifications = await import('expo-notifications');
    // SDK 54 requires shouldShowBanner + shouldShowList instead of shouldShowAlert
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  }
  return Notifications;
}

/**
 * Fetch this device's Expo push token (for server-sent alerts). Returns null in
 * Expo Go or when permission is denied / no projectId is configured.
 */
export async function getExpoPushToken(): Promise<string | null> {
  const N = await getNotifications();
  if (!N) return null;

  const granted = await requestNotificationPermissions();
  if (!granted) return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as any).easConfig?.projectId;
  if (!projectId) return null;

  try {
    const { data } = await N.getExpoPushTokenAsync({ projectId });
    return data ?? null;
  } catch {
    return null;
  }
}

/** Android channel id — the backend's pushes use the same id (pushService.ts). */
export const ALERT_CHANNEL = 'phantom-alerts';

/** Create the Android alert channel. Safe to call at every launch; asks nothing. */
export async function initNotificationChannel(): Promise<void> {
  const N = await getNotifications();
  if (!N || Platform.OS !== 'android') return;
  await N.setNotificationChannelAsync(ALERT_CHANNEL, {
    name: 'Security alerts',
    description: 'Intruder attempts, Guard Mode and Find My Phone alerts',
    importance: N.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#00D4FF',
  }).catch(() => {});
}

/** Local notifications land on the alert channel on Android. */
const now = () => (Platform.OS === 'android' ? { channelId: ALERT_CHANNEL } : null);

export async function requestNotificationPermissions(): Promise<boolean> {
  const N = await getNotifications();
  if (!N) return false;

  await initNotificationChannel();

  const { status: existing } = await N.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await N.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Lost mode on the lock screen. Local, so it shows even if the server's push
 * didn't arrive; sticky on Android so a finder can't just swipe it away.
 */
export async function presentLostModeNotification(message: string, contact: string): Promise<void> {
  const N = await getNotifications();
  if (!N) return;
  await N.scheduleNotificationAsync({
    identifier: 'lost-mode',
    content: {
      title: 'This phone is lost',
      body: contact ? `${message}\nContact: ${contact}` : message,
      sticky: true,
      sound: true,
      data: { type: 'lost_mode' },
    },
    trigger: now(),
  });
}

export async function dismissLostModeNotification(): Promise<void> {
  const N = await getNotifications();
  if (!N) return;
  await N.dismissNotificationAsync('lost-mode').catch(() => {});
}

export async function sendIntruderAlert(layerName: string, attemptNumber: number): Promise<void> {
  const N = await getNotifications();
  if (!N) return;
  await N.scheduleNotificationAsync({
    content: {
      title: 'Wrong PIN entered',
      body: `Wrong PIN entered for ${layerName} (attempt ${attemptNumber}). Details are in the Vault.`,
      sound: true,
      data: { type: 'intruder' },
    },
    trigger: now(),
  });
}

/**
 * Show a visible "armed" notification while Guard Mode is active, so the user
 * trusts protection is running. Returns the notification id to dismiss later.
 */
export async function presentArmedNotification(): Promise<string | null> {
  const N = await getNotifications();
  if (!N) return null;
  try {
    return await N.scheduleNotificationAsync({
      content: {
        title: 'Guard Mode is on',
        body: 'Open PhantomShield and enter your PIN to stop it.',
        sticky: true,
        data: { type: 'armed' },
      },
      trigger: now(),
    });
  } catch {
    return null;
  }
}

export async function dismissNotification(id: string | null): Promise<void> {
  if (!id) return;
  const N = await getNotifications();
  if (!N) return;
  await N.dismissNotificationAsync(id).catch(() => {});
}

export async function sendTamperAlert(): Promise<void> {
  const N = await getNotifications();
  if (!N) return;
  await N.scheduleNotificationAsync({
    content: {
      title: 'Find My Phone alert',
      body: 'An alarm was triggered on this phone from your PhantomShield dashboard.',
      sound: true,
      data: { type: 'tamper' },
    },
    trigger: now(),
  });
}
