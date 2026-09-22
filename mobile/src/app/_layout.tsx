import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus, StyleSheet } from 'react-native';
import { Stack, router, useSegments } from 'expo-router';
import { resetTo } from '@/services/navigation';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { usePhantomStore } from '@/stores/phantom';
import { getExpoPushToken, initNotificationChannel } from '@/services/notifications';
import { ensureIntruderDir } from '@/services/camera';
import { registerPushToken, getAccessToken, fetchCurrentPlan, getE2eState } from '@/services/api';
import { installQuickActions, onArmAction } from '@/services/shortcuts';
import { isPocketModeAvailable } from '@/services/guard';
import { pollAndApplyCommands } from '@/services/commands';
import { initRealtime } from '@/services/realtime';
import { syncLocationTrackingState, flushLocationQueue } from '@/services/locationTracking';
import { runTheftChecks } from '@/services/theftSignals';
import { configurePurchases } from '@/services/purchases';
import { initMonitoring, identify } from '@/services/monitoring';
import {
  track,
  identify as identifyAnalytics,
  resetAnalyticsIdentity,
  flushAnalytics,
  setPersonProperties,
} from '@/services/analytics';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export default function RootLayout() {
  const { isAuthenticated, isAppUnlocked, setAppUnlocked, user } = usePhantomStore();
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const gateQueued = useRef(false);
  const segments = useSegments();
  const currentRoute = useRef<string>('');
  currentRoute.current = segments[0] ?? '';

  // One-time cold-start setup
  useEffect(() => {
    initMonitoring();
    // Session/DAU signal — there was no app_opened event at all, which made
    // retention (D1/D7/D30) literally uncomputable.
    void track('app_opened');
    void flushAnalytics();
    ensureIntruderDir().catch(() => {});
    void initNotificationChannel();
    void isPocketModeAvailable().then(installQuickActions);
    // Quick action picked while the app is already running.
    return onArmAction((href) => router.push(href as never));
  }, []);

  // Register the push token and drain any queued remote commands once we have
  // an authenticated session.
  useEffect(() => {
    if (!isAuthenticated) {
      identify(null); // clear the Sentry user on sign-out
      resetAnalyticsIdentity();
      return;
    }
    (async () => {
      const token = await getAccessToken().catch(() => null);
      if (!token) return;
      if (user?.id) {
        identify(user.id); // associate crash reports with this user (id only, no PII)
        // Stitch the anonymous pre-sign-in funnel to the account, and set the
        // person properties the funnel is segmented by.
        void identifyAnalytics(user.id, { plan: user.plan, provider: user.provider });
        configurePurchases(user.id).catch(() => {});
      }
      // Encryption may have been turned on (or off) from another phone.
      const e2e = await getE2eState();
      if (e2e) usePhantomStore.getState().setE2eEnabled(e2e.enabled);
      const pushToken = await getExpoPushToken().catch(() => null);
      if (pushToken) await registerPushToken(pushToken).catch(() => {});
      await pollAndApplyCommands().catch(() => {});
    })();

    // Reconcile the OS background-location task with the user's setting: it
    // survives app restarts and reinstalls independently of our state, so the
    // two must be converged rather than assumed.
    void syncLocationTrackingState();

    // Hold a live socket so remote commands (lock / alarm / wipe / locate)
    // arrive the moment they're issued instead of waiting for the next
    // foreground poll — the difference between "lock my stolen phone" working
    // and silently doing nothing.
    const stopRealtime = initRealtime();
    return stopRealtime;
    // Re-run only when the signed-in account changes, not on every plan refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.id]);

  // Lock on every background → foreground cycle. We key on 'background' only,
  // NOT 'inactive': `inactive` fires for the notification shade, Control Center,
  // incoming calls, and the biometric prompt itself, so locking on it would
  // re-gate constantly (and can loop with the biometric prompt). `inactive` is
  // treated as a transient state that neither locks nor re-gates.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appState.current;
      appState.current = next;

      // An armed Guard session owns the screen (and its own PIN-protected stop),
      // so it is not re-locked underneath — that would tear it down.
      if (next === 'background' && !usePhantomStore.getState().guardArmed) {
        setAppUnlocked(false);
        gateQueued.current = false;
      }

      if (prev === 'background' && next === 'active') {
        if (isAuthenticated) {
          // Pick up any remote lock/wipe/alert commands issued while backgrounded.
          void pollAndApplyCommands();
          // Did the SIM change while we were away? This is the strongest
          // theft signal available without native code, and it fires whether
          // or not anyone opened the app.
          void runTheftChecks();
          // Send any position fixes buffered while offline.
          void flushLocationQueue();
          // Re-read the plan actually in force. A purchase made on another
          // device or an expiry was previously invisible
          // until the user signed out and back in.
          void fetchCurrentPlan().then((p) => {
            if (!p) return;
            const cur = usePhantomStore.getState().user;
            if (cur && cur.plan !== p.plan) {
              void setPersonProperties({ plan: p.plan });
              usePhantomStore.getState().setUser({ ...cur, plan: p.plan });
            }
          });
        }
        // Guard Mode owns the foreground while armed — don't yank the user to
        // the biometric gate (that would abandon an active watch session).
        if (usePhantomStore.getState().guardArmed) return;
        // Screens that ARE the gate, or that are public, need no re-gate.
        // A lost phone shows the owner's message first, to whoever is holding it.
        if (usePhantomStore.getState().lostMode && currentRoute.current !== 'lost') {
          resetTo('/lost');
          return;
        }
        const open = ['biometric-gate', 'pin-gate', '(auth)', 'decoy-dashboard', 'guard-mode', 'lost', ''];
        const st = usePhantomStore.getState();
        if (
          (st.isAuthenticated || st.onboarded) &&
          !usePhantomStore.getState().isAppUnlocked &&
          !gateQueued.current &&
          !open.includes(currentRoute.current)
        ) {
          gateQueued.current = true;
          setTimeout(() => {
            resetTo('/biometric-gate');
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
        <Stack.Screen name="pin-gate"        options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="permissions-intro" options={{ gestureEnabled: false }} />
        <Stack.Screen name="setup-pins" options={{ gestureEnabled: false }} />
        <Stack.Screen name="devices" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="guard-mode" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="paywall" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="decoy-dashboard" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="lost" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="guardians" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="encryption" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      </Stack>
      <StatusBar style="light" />
    </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const s = StyleSheet.create({ root: { flex: 1 } });
