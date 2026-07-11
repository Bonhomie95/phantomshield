/**
 * Crash & error reporting via Sentry.
 *
 * Gated on EXPO_PUBLIC_SENTRY_DSN: with no DSN set it initialises nothing and
 * every call no-ops, so dev builds don't ship noise and the app runs fine
 * without monitoring configured. Set the DSN to turn it on.
 *
 * Privacy: this is a security app, so PII scrubbing is on and we never attach
 * screenshots or view hierarchies (which could contain intruder photos/PINs).
 */
import * as Sentry from '@sentry/react-native';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

let started = false;

export function initMonitoring(): void {
  if (started || !DSN) return;
  started = true;
  try {
    Sentry.init({
      dsn: DSN,
      // Don't send default PII; scrub anything that slips through.
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      tracesSampleRate: 0.1,
      environment: __DEV__ ? 'development' : 'production',
    });
  } catch {
    // Never let monitoring setup break app startup.
    started = false;
  }
}

/** Associate reports with a user id (no email/name — PII stays out of Sentry). */
export function identify(userId: string | null): void {
  if (!started) return;
  try {
    Sentry.setUser(userId ? { id: userId } : null);
  } catch {
    /* ignore */
  }
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!started) {
    if (__DEV__) console.error('[monitoring]', error, context);
    return;
  }
  try {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    /* ignore */
  }
}
