/**
 * Lightweight product analytics — dependency-free.
 *
 * Uses PostHog's HTTP capture endpoint when EXPO_PUBLIC_POSTHOG_KEY is set, so
 * there's no native SDK to add. No-ops (dev console only) when unconfigured, so
 * it never blocks the app and costs nothing until you wire a key.
 *
 * You NEED this before spending on user acquisition: without activation and
 * retention events you can't tell which install sources actually convert.
 */
import { getOrCreateDeviceId } from '@/services/api';

const KEY  = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '';
const HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

export async function track(event: string, properties: Record<string, unknown> = {}): Promise<void> {
  if (!KEY) {
    if (__DEV__) console.log('[analytics]', event, properties);
    return;
  }
  try {
    const distinctId = await getOrCreateDeviceId();
    await fetch(`${HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: KEY,
        event,
        distinct_id: distinctId,
        properties: { ...properties, $lib: 'phantomshield-mobile' },
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // Analytics must never throw into product code.
  }
}
