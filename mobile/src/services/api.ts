/**
 * PhantomShield API client.
 * Handles OAuth sign-in, token storage, and authenticated requests.
 */

import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { API_URL } from '@/constants/config';
import { User } from '@/constants/types';
import type { IntruderUpload, DeviceCommand, Guardian } from '@phantomshield/shared';
import { ENCRYPTED_PHOTO_CONTENT_TYPE } from '@phantomshield/shared';
import { usePhantomStore } from '@/stores/phantom';

// ─── Storage keys ─────────────────────────────────────────────────────────────

const KEYS = {
  ACCESS_TOKEN:   'ps_access_token',
  REFRESH_TOKEN:  'ps_refresh_token',
  DEVICE_ID:      'ps_device_id',
} as const;

// ─── Token helpers ────────────────────────────────────────────────────────────

export async function storeTokens(access: string, refresh: string) {
  await SecureStore.setItemAsync(KEYS.ACCESS_TOKEN,  access);
  await SecureStore.setItemAsync(KEYS.REFRESH_TOKEN, refresh);
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.ACCESS_TOKEN);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.REFRESH_TOKEN);
}

export async function clearTokens() {
  await SecureStore.deleteItemAsync(KEYS.ACCESS_TOKEN);
  await SecureStore.deleteItemAsync(KEYS.REFRESH_TOKEN);
}

/** Stable device ID — created once, never changes. */
export async function getOrCreateDeviceId(): Promise<string> {
  let id = await SecureStore.getItemAsync(KEYS.DEVICE_ID);
  if (!id) {
    id = `dev_${Crypto.randomUUID()}`;
    await SecureStore.setItemAsync(KEYS.DEVICE_ID, id);
  }
  return id;
}

// ─── Base fetch with auth header + 401 auto-refresh ───────────────────────────

async function apiFetch(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<Response> {
  const token    = await getAccessToken();
  const deviceId = await getOrCreateDeviceId();

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': deviceId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  // Access token expired — refresh once and replay the request.
  if (res.status === 401 && retry && token) {
    const refreshed = await refreshAccessToken(deviceId).catch(() => null);
    if (refreshed) return apiFetch(path, options, false);
  }

  return res;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface OAuthSignInParams {
  provider: 'google' | 'apple';
  idToken: string;
  /** Apple only sends user data (name/email) on the very first sign-in */
  appleUserData?: { email?: string; name?: string };
  /** Apple only — lets the server revoke the Apple token on account deletion. */
  authorizationCode?: string;
  device: {
    deviceId: string;
    platform: 'ios' | 'android';
    model?: string;
    osVersion?: string;
    appVersion?: string;
  };
}

export interface AuthResult {
  isNewUser: boolean;
  accessToken: string;
  refreshToken: string;
  user: User;
}

/**
 * Send a verified Google or Apple ID token to the backend.
 * The backend verifies it with the provider, then returns our JWT pair.
 */
export async function oauthSignIn(params: OAuthSignInParams): Promise<AuthResult> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/oauth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch {
    throw new Error('Can’t reach PhantomShield. Check your internet connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Sign-in failed. Please try again.');
  return data as AuthResult;
}

/**
 * Attempt to refresh an expired access token using the stored refresh token.
 * Returns the new access token or null if the session is fully expired.
 */
// Single-flight: refresh tokens rotate on every use, and the server treats a
// second use of the same token as theft (it revokes the whole session). Several
// requests hitting 401 together must therefore share ONE refresh.
let refreshInFlight: Promise<string | null> | null = null;

export function refreshAccessToken(deviceId: string): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh(deviceId).finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function doRefresh(deviceId: string): Promise<string | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;

  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken, deviceId }),
  });
  if (res.status === 401) {
    // The session is over (expired, revoked, or this device was removed from
    // the web dashboard). Drop to the sign-in screen; local data stays put.
    await clearTokens();
    usePhantomStore.getState().setAuthenticated(false);
    return null;
  }
  if (!res.ok) return null; // transient (5xx / 429) — keep the session, retry later
  const { accessToken, refreshToken: newRefresh } = await res.json();
  await storeTokens(accessToken, newRefresh);
  return accessToken;
}

/** Revoke this device's session server-side. Local cleanup is session.ts. */
export async function signOut(): Promise<void> {
  const refreshToken = await getRefreshToken();
  await apiFetch('/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  }).catch(() => {}); // best-effort — local data is wiped regardless
}

/**
 * Permanently delete the account and all server-side data (App Store /
 * Play require in-app account deletion). Clears local tokens on success.
 */
export async function deleteAccount(): Promise<boolean> {
  const res = await apiFetch('/dashboard/me', {
    method: 'DELETE',
    body: JSON.stringify({ confirm: 'DELETE MY ACCOUNT' }),
  }).catch(() => null);
  return !!res?.ok;
}

// ─── Intruder events ──────────────────────────────────────────────────────────

/** Upload an intruder event (wrong-PIN capture) to the backend. Best-effort. */
export async function uploadIntruderEvent(payload: IntruderUpload) {
  const res = await apiFetch('/sync/intruder', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return res;
}

/**
 * Upload the intruder photo to the account and return the reference to attach
 * to the event. Returns null when it wasn't stored (offline, signed out, or the
 * plan's monthly photo quota is used up — which is recorded for the Vault).
 */
export async function uploadIntruderPhoto(id: string, fileUri: string): Promise<string | null> {
  const token = await getAccessToken();
  if (!token) return null;
  const deviceId = await getOrCreateDeviceId();

  // With end-to-end encryption on, only sealed bytes ever leave the phone. If
  // encryption is on for the account but this phone doesn't have the key yet,
  // the photo stays on the phone rather than going up readable.
  const { getPhotoKey, sealPhotoFile } = await import('@/services/e2e');
  const key = await getPhotoKey();
  if (usePhantomStore.getState().e2eEnabled && !key) return null;
  const body = key ? await sealPhotoFile(key, id, fileUri) : fileUri;
  const contentType = key ? ENCRYPTED_PHOTO_CONTENT_TYPE : 'image/jpeg';

  const put = async (bearer: string) =>
    FileSystem.uploadAsync(`${API_URL}/sync/intruder/${encodeURIComponent(id)}/photo`, body, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': contentType, Authorization: `Bearer ${bearer}`, 'X-Device-Id': deviceId },
    });

  try {
    let up = await put(token);
    if (up.status === 401) {
      const fresh = await refreshAccessToken(deviceId);
      if (!fresh) return null;
      up = await put(fresh);
    }
    if (up.status < 200 || up.status >= 300) return null;
    const res = JSON.parse(up.body || '{}') as { stored?: boolean; key?: string; photoQuotaReached?: boolean };
    usePhantomStore.getState().setPhotoQuotaReached(!!res.photoQuotaReached);
    return res.stored && res.key ? res.key : null;
  } catch {
    return null;
  } finally {
    if (body !== fileUri) void FileSystem.deleteAsync(body, { idempotent: true }).catch(() => {});
  }
}

// ─── Push token ────────────────────────────────────────────────────────────────

/** Register this device's Expo push token so the backend can send alerts. */
export async function registerPushToken(pushToken: string) {
  return apiFetch('/push/token', {
    method: 'POST',
    body: JSON.stringify({ pushToken }),
  });
}

// ─── Remote device commands ─────────────────────────────────────────────────────

export interface QueuedCommand {
  command: DeviceCommand;
  payload: unknown;
  ts: number;
}

/**
 * Mint a single-use, short-lived WebSocket ticket.
 * The raw access token never goes into a URL (it would end up in proxy and
 * server access logs); the ticket is consumed once at handshake.
 */
export async function requestWsTicket(): Promise<string | null> {
  const res = await apiFetch('/auth/ws-ticket', { method: 'POST' }).catch(() => null);
  if (!res || !res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.ticket ?? null;
}

/**
 * Report this device's current position — answers a remote "locate" request.
 * Recorded as a normal security event so it shows up in the web timeline.
 */
export async function reportLocation(): Promise<boolean> {
  const { captureLocation } = await import('@/services/location');
  const fix = await captureLocation().catch(() => null);
  if (!fix) return false;

  const res = await uploadIntruderEvent({
    id: `locate_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    pinLayer: 'locate',
    failedAttempt: 1,
    location: fix,
  }).catch(() => null);

  return !!res?.ok;
}

/**
 * Fetch the plan actually in force, server-side.
 * The client otherwise trusts whatever `user.plan` came back at sign-in — so a
 * purchase made on another device, or an expiry stayed
 * invisible until the user signed out and back in.
 */
export async function fetchCurrentPlan(): Promise<{
  plan: 'free' | 'starter' | 'pro';
  planExpiresAt: string | null;
} | null> {
  const res = await apiFetch('/billing/plan', { method: 'GET' }).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json().catch(() => null);
}

/** Poll and drain any remote commands queued for this device. */
export async function fetchDeviceCommands(): Promise<QueuedCommand[]> {
  const deviceId = await getOrCreateDeviceId();
  const res = await apiFetch(`/devices/${encodeURIComponent(deviceId)}/commands`, { method: 'GET' }).catch(() => null);
  if (!res?.ok) return [];
  const data = await res.json().catch(() => ({ commands: [] }));
  return (data.commands ?? []) as QueuedCommand[];
}

// ─── Activation signals ──────────────────────────────────────────────────────

/**
 * Report a completed Guard Mode session.
 * Guard runs entirely on-device, so this is the only way the server learns the
 * user actually used the product — it drives the activation metric.
 */
export async function reportGuardSession(): Promise<void> {
  await apiFetch('/sync/guard-session', { method: 'POST' }).catch(() => {});
}

// ─── Devices ─────────────────────────────────────────────────────────────────

export interface AccountDevice {
  deviceId: string;
  platform: 'ios' | 'android' | 'web';
  model: string;
  osVersion: string;
  lastSeenAt: string;
  isOnline: boolean;
}

export async function listDevices(): Promise<AccountDevice[] | null> {
  const res = await apiFetch('/devices', { method: 'GET' }).catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null);
  return (data?.devices ?? null) as AccountDevice[] | null;
}

export async function removeDevice(deviceId: string): Promise<boolean> {
  const res = await apiFetch(`/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' }).catch(() => null);
  return !!res?.ok;
}

// ─── Guardians ───────────────────────────────────────────────────────────────

export async function listGuardians(): Promise<{ guardians: Guardian[]; limit: number } | null> {
  const res = await apiFetch('/guardians', { method: 'GET' }).catch(() => null);
  if (!res?.ok) return null;
  return res.json().catch(() => null);
}

export async function addGuardian(
  name: string,
  email: string,
  alertOnGuard: boolean,
): Promise<{ ok: true; guardian: Guardian } | { ok: false; message: string; upgrade?: boolean }> {
  const res = await apiFetch('/guardians', {
    method: 'POST',
    body: JSON.stringify({ name, email, alertOnGuard }),
  }).catch(() => null);
  if (!res) return { ok: false, message: 'Can’t reach PhantomShield. Check your connection.' };
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, guardian: data.guardian };
  return { ok: false, message: data.message ?? data.error ?? 'Couldn’t add that guardian.', upgrade: res.status === 403 };
}

export async function setGuardianAlertOnGuard(id: string, alertOnGuard: boolean): Promise<boolean> {
  const res = await apiFetch(`/guardians/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ alertOnGuard }),
  }).catch(() => null);
  return !!res?.ok;
}

export async function removeGuardian(id: string): Promise<boolean> {
  const res = await apiFetch(`/guardians/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
  return !!res?.ok;
}

// ─── Lost mode ───────────────────────────────────────────────────────────────

/** The owner has the phone back: clear lost mode for this device. */
export async function clearLostMode(): Promise<boolean> {
  const deviceId = await getOrCreateDeviceId();
  const res = await apiFetch(`/devices/${encodeURIComponent(deviceId)}/lost-mode`, { method: 'DELETE' }).catch(() => null);
  return !!res?.ok;
}

// ─── End-to-end photo encryption ─────────────────────────────────────────────

export async function getE2eState(): Promise<{ enabled: boolean; keyCheck: string | null } | null> {
  const res = await apiFetch('/dashboard/e2e', { method: 'GET' }).catch(() => null);
  if (!res?.ok) return null;
  return res.json().catch(() => null);
}

/** 'conflict' = the account already uses a different key. */
export async function putE2eKeyCheck(keyCheck: string, replace = false): Promise<'ok' | 'conflict' | 'failed'> {
  const res = await apiFetch('/dashboard/e2e', {
    method: 'PUT',
    body: JSON.stringify({ keyCheck, replace }),
  }).catch(() => null);
  if (res?.ok) return 'ok';
  return res?.status === 409 ? 'conflict' : 'failed';
}

export async function disableE2eRemote(): Promise<boolean> {
  const res = await apiFetch('/dashboard/e2e', { method: 'DELETE' }).catch(() => null);
  return !!res?.ok;
}
