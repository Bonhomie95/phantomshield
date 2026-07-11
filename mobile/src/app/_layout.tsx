import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import 'react-native-reanimated';
import { usePhantomStore } from '@/stores/phantom';
import { initTracker } from '@/services/tracker';
import { requestNotificationPermissions, getExpoPushToken } from '@/services/notifications';
import { ensureIntruderDir } from '@/services/camera';
import { registerPushToken, getAccessToken } from '@/services/api';
import { pollAndApplyCommands } from '@/services/commands';
import { configurePurchases } from '@/services/purchases';
import { initMonitoring, identify } from '@/services/monitoring';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export default function RootLayout() {
  const { isAuthenticated, isAppUnlocked, setAppUnlocked, user } = usePhantomStore();
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const gateQueued = useRef(false);

  // One-time cold-start setup
  useEffect(() => {
    initMonitoring();
    ensureIntruderDir().catch(() => {});
    const stopTracker = initTracker();
    return stopTracker;
  }, []);

  // Register the push token and drain any queued remote commands once we have
  // an authenticated session.
  useEffect(() => {
    if (!isAuthenticated) return;
    (async () => {
      const token = await getAccessToken().catch(() => null);
      if (!token) return;
      if (user?.id) configurePurchases(user.id).catch(() => {});
      const pushToken = await getExpoPushToken().catch(() => null);
      if (pushToken) await registerPushToken(pushToken).catch(() => {});
      await pollAndApplyCommands().catch(() => {});
    })();
  }, [isAuthenticated, user?.id]);

  // Lock on every background → foreground cycle
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appState.current;
      appState.current = next;

      if (prev === 'active' && (next === 'background' || next === 'inactive')) {
        setAppUnlocked(false);
        gateQueued.current = false;
      }

      if ((prev === 'background' || prev === 'inactive') && next === 'active') {
        if (isAuthenticated) {
          // Pick up any remote lock/wipe/alert commands issued while backgrounded.
          void pollAndApplyCommands();
        }
        // Guard Mode owns the foreground while armed — don't yank the user to
        // the biometric gate (that would abandon an active watch session).
        if (usePhantomStore.getState().guardArmed) return;
        if (isAuthenticated && !isAppUnlocked && !gateQueued.current) {
          gateQueued.current = true;
          setTimeout(() => {
            router.replace('/biometric-gate');
            gateQueued.current = false;
          }, 150);
        }
      }
    });
    return () => sub.remove();
  }, [isAuthenticated, isAppUnlocked, setAppUnlocked]);

  return (
    <ErrorBoundary>
    <GestureHandlerRootView style={s.root}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#080C12' } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="biometric-gate" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="pin-gate"        options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="permissions-intro" options={{ gestureEnabled: false }} />
        <Stack.Screen name="setup-pins" />
        <Stack.Screen name="guard-mode" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="paywall" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="invite" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="decoy-dashboard" options={{ animation: 'fade', gestureEnabled: false }} />
      </Stack>
      <StatusBar style="light" />
    </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const s = StyleSheet.create({ root: { flex: 1 } });
