/**
 * @phantomshield/shared — the canonical API contract shared by the backend,
 * the mobile app, and the web dashboard.
 *
 * This package is framework-agnostic on purpose: no fastify, mongoose, react,
 * or expo imports. It is the single source of truth for the wire format so the
 * three services can't drift out of sync (which is exactly how the mobile app
 * ended up POSTing to a route the backend didn't expose).
 */

// ─── Plans ──────────────────────────────────────────────────────────────────

export type PlanId = 'free' | 'guard' | 'elite';

export interface PlanLimits {
  historyDays:       number;
  /** -1 means unlimited */
  intruderSnapshots: number;
  /** -1 means unlimited */
  safeZones:         number;
  devices:           number;
  remoteDashboard:   boolean;
  export:            boolean;
}

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free:  { historyDays: 7,  intruderSnapshots: 0,  safeZones: 0,  devices: 1, remoteDashboard: false, export: false },
  guard: { historyDays: 30, intruderSnapshots: 10, safeZones: 2,  devices: 2, remoteDashboard: true,  export: true  },
  elite: { historyDays: 90, intruderSnapshots: -1, safeZones: -1, devices: 5, remoteDashboard: true,  export: true  },
};

// ─── OAuth / Auth ─────────────────────────────────────────────────────────────

export type OAuthProvider = 'google' | 'apple';

export type DevicePlatform = 'ios' | 'android' | 'web';

export interface DeviceInfo {
  deviceId:    string;
  platform:    DevicePlatform;
  model?:      string;
  osVersion?:  string;
  appVersion?: string;
  pushToken?:  string;
}

/** POST /api/auth/oauth request body. */
export interface OAuthRequest {
  provider:      OAuthProvider;
  idToken:       string;
  /** Apple only returns user data on the very first authentication. */
  appleUserData?: { email?: string; name?: string };
  device:        DeviceInfo;
}

export interface AuthUser {
  id:        string;
  email:     string;
  name?:     string | null;
  photo?:    string | null;
  plan:      PlanId;
  provider:  OAuthProvider;
  createdAt: string;
}

/** POST /api/auth/oauth response body. */
export interface AuthResponse {
  accessToken:  string;
  refreshToken: string;
  isNewUser:    boolean;
  user:         AuthUser;
}

/** POST /api/auth/refresh request/response. */
export interface RefreshRequest {
  refreshToken: string;
  deviceId:     string;
}
export interface RefreshResponse {
  accessToken:  string;
  refreshToken: string;
}

// ─── Activity sync ──────────────────────────────────────────────────────────

export type ActivityEventType =
  | 'app_opened' | 'app_closed'
  | 'screen_unlocked' | 'screen_locked'
  | 'phantom_opened' | 'anomaly_detected';

/** One event as sent by the client in a sync batch. */
export interface SyncEvent {
  id:                string;
  type:              string;
  appName?:          string;
  /** epoch milliseconds */
  timestamp:         number;
  duration?:         number;
  isAnomalous:       boolean;
  anomalyReason?:    string;
  encryptedPayload?: string;
}

/** POST /api/sync/events request body. */
export interface SyncBatch {
  deviceId: string;
  events:   SyncEvent[];
  /** Optional sha256 over JSON.stringify(events) — a corruption guard, not auth. */
  checksum?: string;
}

// ─── Intruder ───────────────────────────────────────────────────────────────

export interface GeoLocation {
  lat:      number;
  lng:      number;
  accuracy: number;
}

/** POST /api/sync/intruder request body. */
export interface IntruderUpload {
  id:                 string;
  timestamp:          number;
  pinLayer:           string;
  failedAttempt:      number;
  /** Encrypted on the client before upload. */
  photoBase64?:       string;
  encryptedPhotoKey?: string;
  location?:          GeoLocation;
}

// ─── Remote device commands ───────────────────────────────────────────────────

export type DeviceCommand = 'lock_app' | 'wipe_logs' | 'send_alert';

// ─── WebSocket ────────────────────────────────────────────────────────────────

export type WSMessageType =
  | 'connected'
  | 'activity_event' | 'intruder_alert' | 'anomaly_alert'
  | 'device_locked'  | 'device_wipe_logs'
  | 'ping' | 'pong';

export interface WSMessage<T = unknown> {
  type:      WSMessageType;
  payload:   T;
  timestamp: number;
}
