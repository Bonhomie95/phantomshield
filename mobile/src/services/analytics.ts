/**
 * Lightweight product analytics — dependency-free.
 *
 * Uses PostHog's HTTP capture endpoint when EXPO_PUBLIC_POSTHOG_KEY is set, so
 * there's no native SDK to add. No-ops (dev console only) when unconfigured, so
 * it never blocks the app and costs nothing until you wire a key.
 *
 * Three things were structurally broken here and are fixed below:
 *
 *  1. NO IDENTITY. `distinct_id` was the device id and `$identify` was never
 *     called, so one person on two devices counted as two people and a
 *     server-side purchase could never be joined to a client-side funnel.
 *  2. NO PERSON PROPERTIES, so the funnel could not be segmented by plan,
 *     platform or version — "does the paywall convert in India?" was
 *     unanswerable.
 *  3. NO BUFFER. One fetch per event, dropped silently on failure — and events
 *     fired during a theft (poor connectivity) are exactly the ones that matter.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { getOrCreateDeviceId } from '@/services/api';

const KEY  = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '';
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

const QUEUE_KEY = 'ps_analytics_queue';
const MAX_QUEUED = 200;

/** Set once we know the backend user id, so events join across devices. */
let identifiedUserId: string | null = null;

interface QueuedEvent {
  event: string;
  properties: Record<string, unknown>;
  distinct_id: string;
  timestamp: string;
}

const baseProperties = () => ({
  $lib: 'phantomshield-mobile',
  platform: Platform.OS,
  app_version: Constants.expoConfig?.version ?? 'unknown',
});

async function readQueue(): Promise<QueuedEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedEvent[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(events: QueuedEvent[]): Promise<void> {
  try {
    // Keep the NEWEST events when over the cap.
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(events.slice(-MAX_QUEUED)));
  } catch {
    /* storage full — dropping analytics is always the right trade */
  }
}

async function post(path: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(`${HOST}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Send anything buffered from earlier failures. Safe to call often. */
export async function flushAnalytics(): Promise<void> {
  if (!KEY) return;
  const queued = await readQueue();
  if (queued.length === 0) return;

  const ok = await post('/batch/', {
    api_key: KEY,
    batch: queued.map((e) => ({ ...e, properties: e.properties })),
  });
  if (ok) await writeQueue([]);
}

export async function track(
  event: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  if (!KEY) {
    if (__DEV__) console.log('[analytics]', event, properties);
    return;
  }

  const distinctId = identifiedUserId ?? (await getOrCreateDeviceId());
  const payload: QueuedEvent = {
    event,
    distinct_id: distinctId,
    properties: { ...baseProperties(), ...properties },
    timestamp: new Date().toISOString(),
  };

  const ok = await post('/capture/', { api_key: KEY, ...payload });
  if (!ok) {
    // Buffer and retry on the next flush rather than losing the event.
    const queued = await readQueue();
    await writeQueue([...queued, payload]);
    return;
  }
  // A successful send is a good moment to drain anything held from before.
  void flushAnalytics();
}

/**
 * Bind the anonymous device identity to the real account.
 *
 * `$anon_distinct_id` is what lets PostHog stitch the pre-sign-in funnel to the
 * user, so install → permissions → PIN → first Guard session → purchase is one
 * continuous journey instead of two unrelated ones.
 */
export async function identify(
  userId: string,
  personProperties: Record<string, unknown> = {},
): Promise<void> {
  if (!KEY) {
    if (__DEV__) console.log('[analytics] identify', userId, personProperties);
    identifiedUserId = userId;
    return;
  }

  const deviceId = await getOrCreateDeviceId();
  await post('/capture/', {
    api_key: KEY,
    event: '$identify',
    distinct_id: userId,
    properties: {
      ...baseProperties(),
      $anon_distinct_id: deviceId,
      $set: personProperties,
    },
    timestamp: new Date().toISOString(),
  });
  identifiedUserId = userId;
}

/** Update person-level properties (plan changes, etc.) without an event. */
export async function setPersonProperties(props: Record<string, unknown>): Promise<void> {
  if (!KEY || !identifiedUserId) return;
  await post('/capture/', {
    api_key: KEY,
    event: '$set',
    distinct_id: identifiedUserId,
    properties: { $set: props },
    timestamp: new Date().toISOString(),
  });
}

/** Clear identity on sign-out so the next user isn't merged into this one. */
export function resetAnalyticsIdentity(): void {
  identifiedUserId = null;
}
