/**
 * Server-only auth helpers for the dashboard BFF.
 *
 * Tokens live in httpOnly cookies set here (never readable by browser JS, so
 * XSS can't steal them). The browser talks only to same-origin Next route
 * handlers, which attach the token and proxy to the real backend.
 *
 * Do NOT import this from client components — it uses next/headers cookies().
 */
import { cookies } from 'next/headers';

const isProd = process.env.NODE_ENV === 'production';

function resolveBackend(): string {
  const url = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  if (url) return url;
  if (isProd) {
    // Silently proxying to localhost in production hides a serious misconfig.
    throw new Error('API_URL (or NEXT_PUBLIC_API_URL) must be set in production.');
  }
  return 'http://localhost:3002/api';
}

export const BACKEND = resolveBackend();

export const ACCESS_COOKIE = 'ps_access_token';
export const REFRESH_COOKIE = 'ps_refresh_token';
export const DEVICE_COOKIE = 'ps_device_id';

const baseCookie = { httpOnly: true, secure: isProd, sameSite: 'lax' as const, path: '/' };

export function setAuthCookies(access: string, refresh: string): void {
  const jar = cookies();
  jar.set(ACCESS_COOKIE, access, { ...baseCookie, maxAge: 60 * 15 }); // 15 min
  jar.set(REFRESH_COOKIE, refresh, { ...baseCookie, maxAge: 60 * 60 * 24 * 7 }); // 7 days
}

/** Persist the deviceId server-side so token refresh doesn't trust client input. */
export function setDeviceCookie(deviceId: string): void {
  cookies().set(DEVICE_COOKIE, deviceId, { ...baseCookie, maxAge: 60 * 60 * 24 * 30 });
}

export function getDeviceId(): string | undefined {
  return cookies().get(DEVICE_COOKIE)?.value;
}

export function clearAuthCookies(): void {
  const jar = cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
  jar.delete(DEVICE_COOKIE);
}

export function getAccessToken(): string | undefined {
  return cookies().get(ACCESS_COOKIE)?.value;
}

/**
 * Exchange the httpOnly refresh token for a new pair, persist them, and return
 * the new access token. Returns null if the session is fully expired. The
 * deviceId is read from the server-side cookie set at login — never from the
 * caller — so the token binding can't be influenced by request headers.
 */
export async function refreshSession(_deviceIdIgnored?: string): Promise<string | null> {
  const refreshToken = cookies().get(REFRESH_COOKIE)?.value;
  const deviceId = cookies().get(DEVICE_COOKIE)?.value ?? '';
  if (!refreshToken || !deviceId) return null;

  const res = await fetch(`${BACKEND}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken, deviceId }),
    cache: 'no-store',
  }).catch(() => null);

  if (!res || !res.ok) {
    clearAuthCookies();
    return null;
  }
  const data = await res.json().catch(() => null);
  if (!data?.accessToken) return null;
  setAuthCookies(data.accessToken, data.refreshToken);
  return data.accessToken as string;
}
