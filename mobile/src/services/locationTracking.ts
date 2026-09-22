/**
 * Background location tracking — "where is my phone".
 *
 * This is the feature the product was missing entirely: `location.ts` only ever
 * took a single foreground fix when an intruder event fired, so a stolen phone
 * had no trail and the owner had nothing to follow.
 *
 * Design constraints that shape everything here:
 *
 *  • CONSENT IS THE GATE. Background location is the most invasive permission
 *    this app asks for. It is never started implicitly — the user must turn
 *    tracking on, and turning it off stops the OS task immediately.
 *  • BATTERY IS THE BUDGET. `Balanced` accuracy with a distance filter and
 *    deferred updates means the OS wakes us on meaningful movement rather than
 *    on a timer. A phone sitting still costs almost nothing.
 *  • THE NETWORK IS UNRELIABLE, especially in the exact scenario that matters.
 *    Fixes are queued to disk and flushed in batches, so a phone in a pocket
 *    with no signal still reports its whole trail once it reconnects.
 *
 * Platform reality, stated plainly: iOS only permits sustained background
 * location with the `location` background mode and "Always" authorisation, and
 * it shows the user a periodic reminder. Android needs ACCESS_BACKGROUND_LOCATION
 * plus a foreground service with a visible notification. Both are deliberate —
 * a security app that tracks a phone invisibly is a stalkerware app.
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Battery from 'expo-battery';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type { LocationPingUpload } from '@phantomshield/shared';
import { API_URL } from '@/constants/config';
import { getAccessToken, getOrCreateDeviceId } from '@/services/api';
import { usePhantomStore } from '@/stores/phantom';
import { captureError } from '@/services/monitoring';

export const LOCATION_TASK = 'phantom-location-tracking';

const QUEUE_KEY = 'ps_location_queue';
/** Server accepts 200 per batch; stay under it. */
const MAX_BATCH = 150;
/** Hard cap on the disk queue so a long offline stretch can't grow unbounded. */
const MAX_QUEUED = 600;

// ─── Disk queue ───────────────────────────────────────────────────────────────

async function readQueue(): Promise<LocationPingUpload[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as LocationPingUpload[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(pings: LocationPingUpload[]): Promise<void> {
  try {
    // Keep the NEWEST fixes when over the cap — a recent trail is worth more
    // than a complete but stale one.
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(pings.slice(-MAX_QUEUED)));
  } catch {
    /* storage pressure — dropping location history is the right trade */
  }
}

/**
 * Send queued fixes. Runs from the background task, so it must be fast, must
 * never throw, and must leave the queue intact if the upload fails.
 */
export async function flushLocationQueue(): Promise<boolean> {
  const queued = await readQueue();
  if (queued.length === 0) return true;

  const token = await getAccessToken();
  if (!token) return false;

  const deviceId = await getOrCreateDeviceId();
  const batch = queued.slice(0, MAX_BATCH);

  try {
    const res = await fetch(`${API_URL}/devices/${encodeURIComponent(deviceId)}/location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': deviceId,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ pings: batch }),
    });

    // 4xx other than auth means this batch will never be accepted; drop it so
    // one malformed fix can't wedge the queue forever.
    if (!res.ok && res.status !== 401 && res.status < 500) {
      captureError(new Error(`location batch rejected: ${res.status}`), {
        scope: 'flushLocationQueue',
        size: batch.length,
      });
      await writeQueue(queued.slice(batch.length));
      return false;
    }
    if (!res.ok) return false;

    await writeQueue(queued.slice(batch.length));
    return true;
  } catch {
    // Offline: keep everything and try again on the next fix.
    return false;
  }
}

// ─── The OS background task ───────────────────────────────────────────────────

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    captureError(error, { scope: 'locationTask' });
    return;
  }

  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
  if (!locations?.length) return;

  // Respect consent even here: the OS can deliver a final batch just after the
  // user switches tracking off, and that batch must not be stored. The task
  // runs for Find My Phone, or for an armed Guard session with background
  // tracking switched on.
  const st = usePhantomStore.getState();
  if (!st.locationTrackingEnabled && !(st.guardArmed && st.backgroundGuardEnabled)) return;

  // Battery level explains a trail that goes cold — worth one read per batch.
  const battery = await Battery.getBatteryLevelAsync().catch(() => undefined);

  const pings: LocationPingUpload[] = locations.map((l) => ({
    lat: l.coords.latitude,
    lng: l.coords.longitude,
    accuracy: l.coords.accuracy ?? 0,
    altitude: l.coords.altitude ?? undefined,
    speed: l.coords.speed ?? undefined,
    heading: l.coords.heading ?? undefined,
    battery: typeof battery === 'number' && battery >= 0 ? battery : undefined,
    recordedAt: l.timestamp,
    source: 'background',
  }));

  const queued = await readQueue();
  await writeQueue([...queued, ...pings]);
  await flushLocationQueue();
});

// ─── Permissions ──────────────────────────────────────────────────────────────

export interface LocationPermissionResult {
  granted: boolean;
  /** True when foreground was granted but the user declined "Always". */
  foregroundOnly: boolean;
  canAskAgain: boolean;
}

/**
 * Request what background tracking needs, in the order the platforms require:
 * foreground first, then background. Asking for both at once fails on iOS.
 */
export async function requestTrackingPermissions(): Promise<LocationPermissionResult> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) {
    return { granted: false, foregroundOnly: false, canAskAgain: fg.canAskAgain };
  }

  let bg = await Location.requestBackgroundPermissionsAsync();
  // iOS: expo-location resolves as the "Change to Always Allow" prompt closes,
  // a beat before CoreLocation reports the new authorisation — so a user who
  // just allowed "Always" reads as denied. Poll briefly for the real answer.
  for (let i = 0; i < 10 && !bg.granted && Platform.OS === 'ios'; i++) {
    await new Promise((r) => setTimeout(r, 250));
    bg = await Location.getBackgroundPermissionsAsync();
  }
  return {
    granted: bg.granted,
    foregroundOnly: !bg.granted,
    canAskAgain: bg.canAskAgain,
  };
}

// ─── Start / stop ─────────────────────────────────────────────────────────────

export async function isTrackingActive(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

/**
 * Begin background tracking. Returns false when permission is missing, so the
 * caller can show the real reason rather than silently doing nothing.
 */
export async function startLocationTracking(): Promise<boolean> {
  const perms = await requestTrackingPermissions();
  if (!perms.granted) return false;

  if (await isTrackingActive()) return true;

  try {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      // Balanced (~100m) is the right trade for theft recovery: it is served by
      // wifi/cell rather than the GPS radio, so it costs a fraction of the
      // battery and is still far more than accurate enough to find a phone.
      accuracy: Location.Accuracy.Balanced,
      // Wake on movement, not on a clock. A stationary phone reports nothing.
      distanceInterval: 75,
      timeInterval: 5 * 60 * 1000,
      // Let the OS batch fixes while we're backgrounded rather than waking the
      // app for each one — the single biggest battery lever here.
      deferredUpdatesInterval: 5 * 60 * 1000,
      deferredUpdatesDistance: 150,
      // iOS: never let the OS silently pause updates. A paused tracker on a
      // stolen phone is worse than no tracker, because the owner believes it
      // is running.
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.Other,
      // iOS shows the blue status bar indicator while tracking. Deliberately
      // left ON: this app must never be able to follow someone invisibly.
      showsBackgroundLocationIndicator: true,
      // Android requires a visible, persistent notification for a foreground
      // service. That visibility is a feature, not a cost.
      foregroundService: {
        notificationTitle: 'PhantomShield is protecting this phone',
        notificationBody: 'Location tracking is on so you can find it if it goes missing.',
        notificationColor: '#00D4FF',
      },
    });
    return true;
  } catch (err) {
    captureError(err, { scope: 'startLocationTracking', platform: Platform.OS });
    return false;
  }
}

export async function stopLocationTracking(): Promise<void> {
  try {
    if (await isTrackingActive()) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch (err) {
    captureError(err, { scope: 'stopLocationTracking' });
  }
  // Send anything already recorded before going quiet.
  await flushLocationQueue().catch(() => {});
}

/**
 * Reconcile the OS task with the user's setting.
 * Called at startup and whenever the toggle changes, so a task that survived a
 * reinstall or a setting that changed while the app was closed converge.
 */
export async function syncLocationTrackingState(): Promise<void> {
  const enabled = usePhantomStore.getState().locationTrackingEnabled;
  const active = await isTrackingActive();

  if (enabled && !active) {
    await startLocationTracking();
  } else if (!enabled && active) {
    await stopLocationTracking();
  } else if (enabled) {
    // Already running — just drain anything the last session couldn't send.
    await flushLocationQueue().catch(() => {});
  }
}
