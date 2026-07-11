/**
 * Stable per-browser device identifier for the web dashboard.
 *
 * The backend binds every access token to a deviceId and checks it against the
 * `X-Device-Id` header on each request, so the dashboard needs one stable id per
 * browser. A random id (rather than a shared literal like "dashboard") means two
 * browsers don't clobber each other's rotating refresh tokens.
 */
const KEY = 'ps_device_id';

export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'dashboard';
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    const rand =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    id = `web_${rand}`;
    window.localStorage.setItem(KEY, id);
  }
  return id;
}
