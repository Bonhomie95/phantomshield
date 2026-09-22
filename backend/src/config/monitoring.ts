/**
 * Backend error tracking.
 *
 * Until now the API had none: `setErrorHandler` logged to stdout and returned a
 * bare "Internal server error", so every 500 in production was unattributable —
 * no stack retained, no grouping, no notification, and nothing the user could
 * quote to support. This module adds Sentry when a DSN is configured and is a
 * no-op otherwise, so local and test runs are unaffected.
 */
import * as Sentry from '@sentry/node';

let enabled = false;

export const initMonitoring = (): void => {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.warn('[Monitoring] SENTRY_DSN not set — backend error tracking is DISABLED.');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    // Tie every event to the exact build. Set SENTRY_RELEASE (or GIT_SHA) in CI.
    release: process.env.SENTRY_RELEASE ?? process.env.GIT_SHA,
    // Traces are opt-in: sampling costs money and this is a small service.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),
    // This service handles PINs, tokens and photographs of people. Never let
    // Sentry auto-attach request bodies, headers, or cookies.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
      }
      return event;
    },
  });

  enabled = true;
  console.log('[Monitoring] Sentry initialised.');
};

/** Report an exception. Safe to call when Sentry isn't configured. */
export const captureError = (
  err: unknown,
  context: Record<string, unknown> = {},
): string | undefined => {
  if (!enabled) return undefined;
  return Sentry.captureException(err, { extra: context });
};

/** Flush buffered events on shutdown so a SIGTERM doesn't drop the last errors. */
export const flushMonitoring = async (timeoutMs = 2000): Promise<void> => {
  if (!enabled) return;
  await Sentry.flush(timeoutMs).catch(() => {});
};

export const isMonitoringEnabled = (): boolean => enabled;
