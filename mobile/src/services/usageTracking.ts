/**
 * App-usage tracking via Android UsageStats (privacy-safe replacement for the
 * screen-recording idea). Reads which apps were foregrounded and when — never
 * any screen content — and feeds them into the same activity sync pipeline.
 *
 * Plan-gated: detailed per-app usage is a paid feature. Free users get only
 * their own-app activity (from tracker.ts); Guard/Elite get full app-open logs.
 * iOS has no equivalent API, so this no-ops there.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePhantomStore } from '@/stores/phantom';
import { getOrCreateDeviceId, getAccessToken, syncEvents } from '@/services/api';
import * as UsageStats from '../../modules/usage-stats';

const LAST_SYNC_KEY = 'ps_usage_last_sync';
const MAX_LOOKBACK_MS = 24 * 60 * 60 * 1000; // never scan more than a day back
const BATCH = 200; // backend caps a sync batch at 200 events

export function usageSupported(): boolean {
  return UsageStats.isSupported();
}

export function usageGranted(): boolean {
  return UsageStats.hasUsagePermission();
}

export function openUsageAccessSettings(): void {
  UsageStats.openUsageAccessSettings();
}

/**
 * Collect foreground app-open events since the last run and sync them.
 * Best-effort — never throws.
 */
export async function collectAndSyncUsage(): Promise<'synced' | 'skipped' | 'failed'> {
  const store = usePhantomStore.getState();
  if (!store.trackingEnabled) return 'skipped';

  // Plan gate: full app-usage logging is a Guard/Elite feature.
  const plan = store.user?.plan ?? 'free';
  if (plan === 'free') return 'skipped';

  if (!UsageStats.isSupported() || !UsageStats.hasUsagePermission()) return 'skipped';

  const now = Date.now();
  const lastRaw = await AsyncStorage.getItem(LAST_SYNC_KEY);
  const start = lastRaw
    ? Math.max(Number(lastRaw), now - MAX_LOOKBACK_MS)
    : now - MAX_LOOKBACK_MS;

  const events = await UsageStats.queryForegroundEvents(start, now);
  if (events.length === 0) {
    await AsyncStorage.setItem(LAST_SYNC_KEY, String(now));
    return 'skipped';
  }

  // Mirror into the local Activity tab.
  for (const e of events) {
    store.addActivityEvent({
      id: usageId(e.timestamp, e.packageName),
      appName: e.packageName,
      bundleId: e.packageName,
      openedAt: new Date(e.timestamp).toISOString(),
      closedAt: null,
      durationSec: 0,
      isAnomaly: false,
    });
  }

  const token = await getAccessToken();
  if (!token) {
    await AsyncStorage.setItem(LAST_SYNC_KEY, String(now));
    return 'skipped';
  }

  const mapped = events.map((e) => ({
    id: usageId(e.timestamp, e.packageName),
    type: 'app_opened' as const,
    appName: e.packageName,
    timestamp: e.timestamp,
    isAnomalous: false,
  }));

  try {
    const deviceId = await getOrCreateDeviceId();
    for (let i = 0; i < mapped.length; i += BATCH) {
      await syncEvents({ deviceId, events: mapped.slice(i, i + BATCH) });
    }
    await AsyncStorage.setItem(LAST_SYNC_KEY, String(now));
    return 'synced';
  } catch {
    return 'failed';
  }
}

// Stable, deduplicable id kept within the backend's 64-char limit.
function usageId(timestamp: number, pkg: string): string {
  return `u_${timestamp}_${pkg}`.slice(0, 64);
}
