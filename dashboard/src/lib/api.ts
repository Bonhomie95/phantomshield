import Cookies from 'js-cookie';
import type { PlanId } from '@phantomshield/shared';
import { getDeviceId } from './deviceId';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3002/api';

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Core Fetch ───────────────────────────────────────────────────────────────

const request = async <T>(
  path: string,
  options: RequestInit = {},
  retry = true
): Promise<T> => {
  const token = Cookies.get('ps_access_token');

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Device-Id': getDeviceId(),
      ...options.headers,
    },
  });

  // Auto-refresh on 401
  if (res.status === 401 && retry) {
    const refreshed = await attemptRefresh();
    if (refreshed) return request<T>(path, options, false);
    // Redirect to login
    window.location.href = '/auth/login';
    throw new ApiError(401, 'Session expired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new ApiError(res.status, body.error ?? body.message ?? 'Request failed');
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
};

const attemptRefresh = async (): Promise<boolean> => {
  const refreshToken = Cookies.get('ps_refresh_token');
  const deviceId = getDeviceId();
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken, deviceId }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    Cookies.set('ps_access_token',  data.accessToken,  { secure: true, sameSite: 'strict', expires: 1/96 });
    Cookies.set('ps_refresh_token', data.refreshToken, { secure: true, sameSite: 'strict', expires: 7 });
    return true;
  } catch {
    return false;
  }
};

// ─── Typed API Methods ────────────────────────────────────────────────────────

export const api = {
  // Auth — the dashboard signs in with the same Google OAuth flow as mobile.
  auth: {
    oauth: (idToken: string) =>
      request<{ accessToken: string; refreshToken: string; isNewUser: boolean; user: UserProfile }>(
        '/auth/oauth',
        {
          method: 'POST',
          body: JSON.stringify({
            provider: 'google',
            idToken,
            device: { deviceId: getDeviceId(), platform: 'web' },
          }),
        }
      ),
    logout: (refreshToken: string) =>
      request<void>('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
  },

  // Dashboard
  dashboard: {
    overview: () => request<DashboardOverview>('/dashboard/overview'),
    activity: (params?: Record<string, string>) => {
      const q = params ? '?' + new URLSearchParams(params).toString() : '';
      return request<{ events: ActivityEvent[]; pagination: Pagination }>(`/dashboard/activity${q}`);
    },
    me: () => request<{ user: UserProfile }>('/dashboard/me'),
    deleteAccount: () =>
      request<{ message: string }>('/dashboard/me', {
        method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE MY ACCOUNT' }),
      }),
    health: () => request<{ status: string; wsConnections: number; uptime: number }>('/dashboard/health'),
  },

  // Sync
  sync: {
    stats: (days = 7) => request<{ stats: DailyStat[] }>(`/sync/stats?days=${days}`),
    intruder: () => request<{ events: IntruderEvent[] }>('/sync/intruder'),
  },

  // Devices
  devices: {
    list: () => request<{ devices: Device[] }>('/devices'),
    remove: (deviceId: string) => request<void>(`/devices/${deviceId}`, { method: 'DELETE' }),
    lock: (deviceId: string) => request<{ message: string }>(`/devices/${deviceId}/lock`, { method: 'POST' }),
    unlock: (deviceId: string) => request<{ message: string }>(`/devices/${deviceId}/unlock`, { method: 'POST' }),
    wipeLogs: (deviceId: string) => request<{ message: string; deletedCount: number }>(`/devices/${deviceId}/wipe-logs`, { method: 'POST' }),
    alert: (deviceId: string) => request<{ message: string }>(`/devices/${deviceId}/alert`, { method: 'POST' }),
  },

  // Push
  push: {
    test: () => request<{ message: string }>('/push/test', { method: 'POST' }),
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserProfile {
  _id: string;
  email: string;
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
  totals: { totalEvents: number; totalAnomalies: number; totalIntruders: number; deviceCount: number };
  today: { unlocks: number; anomalies: number; screenTime: number; totalEvents: number };
  weekTrend: DailyStat[];
  recentAnomalies: ActivityEvent[];
  recentIntruders: IntruderEvent[];
  plan: { current: string; limits: Record<string, unknown> };
}

export interface DailyStat {
  _id: string; // YYYY-MM-DD
  events: number;
  anomalies: number;
  unlocks: number;
  screenTime?: number;
}

export interface ActivityEvent {
  eventId: string;
  type: string;
  appName?: string;
  timestamp: string;
  duration?: number;
  isAnomalous: boolean;
  anomalyReason?: string;
  deviceId: string;
}

export interface IntruderEvent {
  eventId: string;
  timestamp: string;
  pinLayer: string;
  failedAttempt: number;
  photoUrl?: string;
  location?: { lat: number; lng: number; accuracy: number };
}

export interface Device {
  deviceId: string;
  platform: 'ios' | 'android';
  model: string;
  osVersion: string;
  appVersion: string;
  isActive: boolean;
  isOnline: boolean;
  isLocked: boolean;
  trackingEnabled: boolean;
  lastSeenAt: string;
}

export interface Pagination {
  page: number; limit: number; total: number; pages: number;
}

export { ApiError };
