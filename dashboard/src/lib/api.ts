import type { Guardian, LostModeState, PlanId } from '@phantomshield/shared';
import { getDeviceId } from './deviceId';

// All API traffic goes through the same-origin BFF proxy, which attaches the
// httpOnly access token server-side and refreshes transparently. The browser
// never holds a token, so XSS can't steal the session.
const BASE_URL = '/api/backend';

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Core Fetch ───────────────────────────────────────────────────────────────

const request = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': getDeviceId(),
      ...options.headers,
    },
  });

  // The proxy already tried to refresh; a 401 here means the session is gone.
  if (res.status === 401) {
    if (typeof window !== 'undefined') window.location.href = '/auth/login';
    throw new ApiError(401, 'Session expired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new ApiError(res.status, body.error ?? body.message ?? 'Request failed');
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
};

// ─── Typed API Methods ────────────────────────────────────────────────────────

const enc = encodeURIComponent;

/** Same-origin URL for an intruder photo (served through the authenticated proxy). */
export const intruderPhotoUrl = (eventId: string) => `${BASE_URL}/sync/intruder/${enc(eventId)}/photo`;

export const api = {
  // Auth — handled by the BFF route handlers, which set httpOnly cookies.
  auth: {
    oauth: async (idToken: string, provider: 'google' | 'apple' = 'google') => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, provider, deviceId: getDeviceId() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, data.error ?? 'Sign-in failed');
      return data as { isNewUser: boolean; user: UserProfile };
    },
    logout: () =>
      fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).then(() => undefined),
  },

  // Dashboard
  dashboard: {
    overview: () => request<DashboardOverview>('/dashboard/overview'),
    me: () => request<{ user: UserProfile }>('/dashboard/me'),
    deleteAccount: () =>
      request<{ message: string }>('/dashboard/me', {
        method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE MY ACCOUNT' }),
      }),
    health: () => request<{ status: string; wsConnections: number; uptime: number }>('/dashboard/health'),
    /** keyCheck = hex SHA-256 of the raw photo key, to verify a typed recovery key. */
    e2e: () => request<{ enabled: boolean; keyCheck: string | null }>('/dashboard/e2e'),
  },

  // Sync
  sync: {
    intruder: () => request<{ events: IntruderEvent[] }>('/sync/intruder'),
  },

  // Devices
  devices: {
    /** Phones only — the browser session is not a device you can lock or locate. */
    list: () =>
      request<{ devices: Device[] }>('/devices').then((r) => ({
        devices: r.devices.filter((d) => d.platform !== 'web'),
      })),
    remove: (deviceId: string) => request<void>(`/devices/${enc(deviceId)}`, { method: 'DELETE' }),
    lock: (deviceId: string) => request<{ message: string }>(`/devices/${enc(deviceId)}/lock`, { method: 'POST' }),
    unlock: (deviceId: string) => request<{ message: string }>(`/devices/${enc(deviceId)}/unlock`, { method: 'POST' }),
    alert: (deviceId: string) => request<{ message: string }>(`/devices/${enc(deviceId)}/alert`, { method: 'POST' }),
    locate: (deviceId: string) => request<{ message: string }>(`/devices/${enc(deviceId)}/locate`, { method: 'POST' }),
    locations: (deviceId: string, hours = 24, limit = 500) =>
      request<{ pings: LocationPing[]; count: number; windowHours: number; planHistoryDays: number }>(
        `/devices/${enc(deviceId)}/locations?hours=${hours}&limit=${limit}`,
      ),
    lostModeOn: (deviceId: string, message: string, contact: string) =>
      request<{ lostMode: LostModeState; pushed: boolean }>(`/devices/${enc(deviceId)}/lost-mode`, {
        method: 'PUT', body: JSON.stringify({ message, contact }),
      }),
    lostModeOff: (deviceId: string) =>
      request<{ lostMode: LostModeState }>(`/devices/${enc(deviceId)}/lost-mode`, { method: 'DELETE' }),
  },

  // Guardians — people emailed a live-location link when the phone looks stolen
  guardians: {
    list: () => request<{ guardians: Guardian[]; limit: number }>('/guardians'),
    add: (name: string, email: string, alertOnGuard: boolean) =>
      request<{ guardian: Guardian }>('/guardians', { method: 'POST', body: JSON.stringify({ name, email, alertOnGuard }) }),
    update: (id: string, alertOnGuard: boolean) =>
      request<{ guardian: Guardian }>(`/guardians/${enc(id)}`, { method: 'PATCH', body: JSON.stringify({ alertOnGuard }) }),
    remove: (id: string) => request<{ removed: true }>(`/guardians/${enc(id)}`, { method: 'DELETE' }),
    /** Server-throttled per device, so `sent` may be 0. */
    alert: (deviceId: string) =>
      request<{ sent: number }>('/guardians/alert', { method: 'POST', body: JSON.stringify({ deviceId }) }),
    revokeLinks: () => request<{ revoked: number }>('/share-links', { method: 'DELETE' }),
  },

  // Push
  push: {
    test: () => request<{ message: string }>('/push/test', { method: 'POST' }),
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserProfile {
  _id: string;
  email?: string | null;
  name?: string | null;
  photo?: string | null;
  provider: 'google' | 'apple';
  plan: PlanId;
  planExpiresAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  planLimits: Record<string, unknown>;
}

export interface DashboardOverview {
  totals: { totalIntruders: number; deviceCount: number };
  recentIntruders: IntruderEvent[];
  plan: { current: string; limits: Record<string, unknown> };
}

export interface IntruderEvent {
  eventId: string;
  timestamp: string;
  pinLayer: string;
  failedAttempt: number;
  hasPhoto?: boolean;
  /** Present on overview rows; only its truthiness is meaningful. */
  photoUrl?: string;
  location?: { lat: number; lng: number; accuracy: number };
}

export interface Device {
  deviceId: string;
  platform: 'ios' | 'android' | 'web';
  model: string;
  osVersion: string;
  appVersion: string;
  isActive: boolean;
  isOnline: boolean;
  isLocked: boolean;
  trackingEnabled: boolean;
  lastSeenAt: string;
  lostMode?: LostModeState;
}

export interface LocationPing {
  lat: number;
  lng: number;
  accuracy: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  /** 0–1 */
  battery?: number;
  source?: 'background' | 'event' | 'locate' | 'theft_signal';
  recordedAt: string;
}

export { ApiError };
