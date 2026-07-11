/**
 * PhantomShield API client.
 * Handles OAuth sign-in, token storage, and authenticated requests.
 */

import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import { API_URL } from '@/constants/config';
import { User } from '@/constants/types';
import type { IntruderUpload, SyncBatch, DeviceCommand } from '@phantomshield/shared';

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
    id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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
  if (res.status === 401 && retry) {
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
  const res = await fetch(`${API_URL}/auth/oauth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'OAuth sign-in failed');
  return data as AuthResult;
}

/**
 * Attempt to refresh an expired access token using the stored refresh token.
 * Returns the new access token or null if the session is fully expired.
 */
export async function refreshAccessToken(deviceId: string): Promise<string | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;

  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken, deviceId }),
  });
  if (!res.ok) {
    await clearTokens();
    return null;
  }
  const { accessToken, refreshToken: newRefresh } = await res.json();
  await storeTokens(accessToken, newRefresh);
  return accessToken;
}

export async function signOut(deviceId: string) {
  const refreshToken = await getRefreshToken();
  await apiFetch('/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  }).catch(() => {}); // best-effort — clear locally regardless
  await clearTokens();
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
  if (res?.ok) {
    await clearTokens();
    return true;
  }
  return false;
}

// ─── Activity sync ────────────────────────────────────────────────────────────

export async function syncEvents(payload: SyncBatch) {
  return apiFetch('/sync/events', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ─── Intruder events ──────────────────────────────────────────────────────────

/** Upload an intruder event (wrong-PIN capture) to the backend. Best-effort. */
export async function uploadIntruderEvent(payload: IntruderUpload) {
  return apiFetch('/sync/intruder', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Upload the intruder photo itself to R2 via a presigned PUT and return the
 * object key to attach to the event. Returns null if storage isn't configured
 * (free plan, or R2 not set up) — the photo then just stays on-device.
 */
export async function uploadIntruderPhoto(id: string, fileUri: string): Promise<string | null> {
  const res = await apiFetch('/sync/intruder/upload-url', {
    method: 'POST',
    body: JSON.stringify({ id }),
  }).catch(() => null);
  if (!res || !res.ok) return null;

  const { key, uploadUrl } = await res.json().catch(() => ({} as any));
  if (!key || !uploadUrl) return null;

  try {
    const up = await FileSystem.uploadAsync(uploadUrl, fileUri, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': 'image/jpeg' },
    });
    return up.status >= 200 && up.status < 300 ? key : null;
  } catch {
    return null;
  }
}

// ─── Push token ────────────────────────────────────────────────────────────────

/** Register this device's Expo push token so the backend can send alerts. */
export async function registerPushToken(pushToken: string) {
  const deviceId = await getOrCreateDeviceId();
  return apiFetch('/push/token', {
    method: 'POST',
    body: JSON.stringify({ pushToken, deviceId }),
  });
}

// ─── Remote device commands ─────────────────────────────────────────────────────

export interface QueuedCommand {
  command: DeviceCommand;
  payload: unknown;
  ts: number;
}

/** Poll and drain any remote commands queued for this device. */
export async function fetchDeviceCommands(): Promise<QueuedCommand[]> {
  const deviceId = await getOrCreateDeviceId();
  const res = await apiFetch(`/devices/${encodeURIComponent(deviceId)}/commands`, { method: 'GET' });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({ commands: [] }));
  return (data.commands ?? []) as QueuedCommand[];
}

// ─── Referrals ──────────────────────────────────────────────────────────────

export interface ReferralInfo {
  code: string;
  referralCount: number;
  shareUrl: string;
  alreadyReferred: boolean;
}

export async function getReferralInfo(): Promise<ReferralInfo | null> {
  const res = await apiFetch('/referrals/me', { method: 'GET' });
  if (!res.ok) return null;
  return res.json();
}

export async function redeemReferral(code: string): Promise<{ ok: boolean; message: string }> {
  const res = await apiFetch('/referrals/redeem', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, message: data.message ?? data.error ?? 'Something went wrong.' };
}
