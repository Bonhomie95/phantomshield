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

export async function requestNotificationPermissions(): Promise<boolean> {
  const N = await getNotifications();
  if (!N) return false;

  if (Platform.OS === 'android') {
    await N.setNotificationChannelAsync('phantom-alerts', {
      name: 'PhantomShield Alerts',
      importance: N.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#00D4FF',
    });
  }

  const { status: existing } = await N.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await N.requestPermissionsAsync();
  return status === 'granted';
}

export async function sendAnomalyAlert(reason: string): Promise<void> {
  const N = await getNotifications();
  if (!N) return;
  await N.scheduleNotificationAsync({
    content: {
      title: '⚠️ PhantomShield Alert',
      body: reason,
      sound: true,
      data: { type: 'anomaly' },
    },
    trigger: null,
  });
}

export async function sendIntruderAlert(layerName: string, attemptNumber: number): Promise<void> {
  const N = await getNotifications();
  if (!N) return;
  await N.scheduleNotificationAsync({
    content: {
      title: '🚨 Unauthorized Access Attempt',
      body: `Wrong PIN entered for ${layerName} (attempt ${attemptNumber}). Photo captured and saved to Vault.`,
      sound: true,
      data: { type: 'intruder' },
    },
    trigger: null,
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
        title: '🛡 PhantomShield is armed',
        body: 'Guard Mode is watching your phone. Tap the app to disarm.',
        sticky: true,
        data: { type: 'armed' },
      },
      trigger: null,
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
      title: '🛡️ PhantomShield Warning',
      body: 'Tracking was interrupted. Open the app to review what happened.',
      sound: true,
      data: { type: 'tamper' },
    },
    trigger: null,
  });
}
