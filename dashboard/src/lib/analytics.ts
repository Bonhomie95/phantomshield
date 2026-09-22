/**
 * Dashboard analytics.
 *
 * The web dashboard had NO instrumentation of any kind — and since every tier
 * can now reach it, it is the product's primary conversion surface: the moment
 * a free user sees their own evidence and understands what the paid tiers buy.
 * Measuring nothing there meant the funnel simply ended at sign-in.
 *
 * Same PostHog HTTP endpoint as the mobile client, and crucially the same
 * `distinct_id` (the backend user id), so a person's mobile and web behaviour
 * resolve to one identity instead of two.
 */
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '';
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

let distinctId: string | null = null;

/** Bind events to the account so web and mobile join up. */
export function identifyWeb(userId: string, props: Record<string, unknown> = {}): void {
  distinctId = userId;
  if (!KEY) return;
  void send('$identify', { $set: { ...props, last_seen_web: new Date().toISOString() } });
}

function send(event: string, properties: Record<string, unknown> = {}): Promise<void> {
  if (!KEY || !distinctId) return Promise.resolve();
  return fetch(`${HOST}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // keepalive so an event fired during navigation still leaves the browser.
    keepalive: true,
    body: JSON.stringify({
      api_key: KEY,
      event,
      distinct_id: distinctId,
      properties: { ...properties, $lib: 'phantomshield-dashboard' },
      timestamp: new Date().toISOString(),
    }),
  })
    .then(() => undefined)
    .catch(() => undefined);
}

export function trackWeb(event: string, properties: Record<string, unknown> = {}): void {
  if (!KEY) {
    if (process.env.NODE_ENV !== 'production') console.log('[analytics]', event, properties);
    return;
  }
  void send(event, properties);
}
