/**
 * PhantomShield Core Tracking Service
 *
 * What this tracks (within Expo managed workflow limits):
 *   ✅ Screen unlock events  — every time the app comes to foreground from background
 *   ✅ App session duration  — how long the app itself is in the foreground
 *   ✅ Anomaly detection     — unlock outside configured safe-zone hours
 *   ✅ Background sync       — periodic task (dev/prod builds only, not Expo Go)
 *
 * What requires a bare/dev-client build:
 *   ⚠️  Other app usage — requires UsageStatsManager (Android) or Screen Time (iOS)
 */

import { AppState, AppStateStatus } from 'react-native';
import Constants from 'expo-constants';
import { usePhantomStore } from '@/stores/phantom';
import { checkTimeAnomaly } from '@/services/anomaly';
import { sendAnomalyAlert } from '@/services/notifications';
import { getOrCreateDeviceId, getAccessToken, syncEvents } from '@/services/api';

// ─── Expo Go detection ────────────────────────────────────────────────────────

const isExpoGo =
  Constants.executionEnvironment === 'storeClient' ||
  (Constants.appOwnership === 'expo');

// ─── Shared sync routine ──────────────────────────────────────────────────────

/**
 * Push recent activity to the backend. Used by both the periodic background
 * task and the foreground AppState handler. Best-effort — never throws.
 */
export async function syncRecentActivity(): Promise<'synced' | 'skipped' | 'failed'> {
  const store = usePhantomStore.getState();
  if (!store.isAuthenticated || !store.trackingEnabled) return 'skipped';

  const token = await getAccessToken();
  if (!token) return 'skipped';

  const unsynced = store.recentActivity.slice(0, 50);
  if (unsynced.length === 0) return 'skipped';

  try {
    const deviceId = await getOrCreateDeviceId();
    await syncEvents({
      deviceId,
      events: unsynced.map((e) => ({
        id: e.id,
        type: 'app_opened' as const,
        appName: e.appName,
        timestamp: new Date(e.openedAt).getTime(),
        duration: e.durationSec,
        isAnomalous: e.isAnomaly,
        anomalyReason: e.anomalyReason,
      })),
    });
    return 'synced';
  } catch {
    return 'failed';
  }
}

// ─── Background task (only registered in real builds) ────────────────────────

const BACKGROUND_SYNC_TASK = 'phantom-background-sync';

async function registerBackgroundSync() {
  if (isExpoGo) return;

  // Dynamic imports — expo-background-task has native code, crashes Expo Go at import
  const [BackgroundTask, TaskManager] = await Promise.all([
    import('expo-background-task'),
    import('expo-task-manager'),
  ]);

  // Define the task before registering it
  if (!TaskManager.isTaskDefined(BACKGROUND_SYNC_TASK)) {
    TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
      // expo-background-task only reports Success | Failed (unlike the old
      // BackgroundFetch API, which had NoData/NewData). "Nothing to do" is a
      // successful run, so those cases also return Success.
      const result = await syncRecentActivity();
      return result === 'failed'
        ? BackgroundTask.BackgroundTaskResult.Failed
        : BackgroundTask.BackgroundTaskResult.Success;
    });
  }

  const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
  if (!isRegistered) {
    await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      minimumInterval: 15 * 60, // seconds
    });
  }
}

// ─── Session state ────────────────────────────────────────────────────────────

let sessionStartMs: number | null = null;
let prevAppState: AppStateStatus = AppState.currentState;
let subscription: ReturnType<typeof AppState.addEventListener> | null = null;

// ─── AppState handler ─────────────────────────────────────────────────────────

async function handleAppStateChange(nextState: AppStateStatus) {
  const store = usePhantomStore.getState();

  if (prevAppState.match(/inactive|background/) && nextState === 'active' && store.trackingEnabled) {
    sessionStartMs = Date.now();
    const now = new Date();
    const anomaly = checkTimeAnomaly(now, store.safeZones);

    store.addUnlockEvent({
      id: `unlock_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: now.toISOString(),
      isAnomaly: anomaly.isAnomaly,
      anomalyReason: anomaly.reason,
    });

    if (anomaly.isAnomaly && anomaly.reason) {
      sendAnomalyAlert(anomaly.reason).catch(() => {});
    }
  }

  if (prevAppState === 'active' && nextState.match(/inactive|background/)) {
    if (sessionStartMs && store.trackingEnabled) {
      const durationSec = Math.round((Date.now() - sessionStartMs) / 1000);
      if (durationSec >= 1) {
        store.addActivityEvent({
          id: `ps_${sessionStartMs}`,
          appName: 'PhantomShield',
          bundleId:
            Constants.expoConfig?.android?.package ??
            Constants.expoConfig?.ios?.bundleIdentifier ??
            'dev.bonhomieinc.phantomshield',
          openedAt: new Date(sessionStartMs).toISOString(),
          closedAt: new Date().toISOString(),
          durationSec,
          isAnomaly: false,
        });
      }
      sessionStartMs = null;
    }
    // Flush recent activity to the backend on backgrounding (best-effort).
    void syncRecentActivity();
  }

  prevAppState = nextState;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function initTracker(): () => void {
  subscription?.remove();
  subscription = AppState.addEventListener('change', handleAppStateChange);
  registerBackgroundSync().catch(() => {});
  return () => {
    subscription?.remove();
    subscription = null;
  };
}

export function recordAppEvent(params: {
  appName: string;
  bundleId: string;
  openedAt: Date;
  closedAt: Date;
}) {
  const store = usePhantomStore.getState();
  if (!store.trackingEnabled) return;
  const durationSec = Math.round((params.closedAt.getTime() - params.openedAt.getTime()) / 1000);
  const anomaly = checkTimeAnomaly(params.openedAt, store.safeZones);
  store.addActivityEvent({
    id: `ext_${params.openedAt.getTime()}_${Math.random().toString(36).slice(2, 5)}`,
    appName: params.appName,
    bundleId: params.bundleId,
    openedAt: params.openedAt.toISOString(),
    closedAt: params.closedAt.toISOString(),
    durationSec,
    isAnomaly: anomaly.isAnomaly,
    anomalyReason: anomaly.reason,
  });
}
