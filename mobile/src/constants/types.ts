import type { PlanId, OAuthProvider } from '@phantomshield/shared';

// Re-use the shared contract's canonical types so the app and backend agree.
export type Plan = PlanId;
export type AuthProvider = OAuthProvider;
export type PINLayer = 'dashboard' | 'logs' | 'vault' | 'settings' | 'decoy';

export interface AppUsageEvent {
  id: string;
  appName: string;
  bundleId: string;
  openedAt: string;
  closedAt: string | null;
  durationSec: number;
  isAnomaly: boolean;
  anomalyReason?: string;
}

export interface UnlockEvent {
  id: string;
  timestamp: string;
  isAnomaly: boolean;
  anomalyReason?: string;
}

export type IntruderTrigger =
  | 'wrong_pin'
  | 'failed_biometric'
  | 'unauthorized_open'
  | 'motion'
  | 'charger_unplugged'
  | 'charger_connected'
  | 'charger_disconnected'
  | 'app_switch'
  | 'disarm_attempt';

export interface IntruderPhoto {
  id: string;
  timestamp: string;
  imageUri: string;
  trigger: IntruderTrigger;
  isAnomaly: boolean;       // always true — every intruder photo IS an anomaly
  anomalyReason?: string;
  latitude?: number;
  longitude?: number;
}

// ─── Guard Mode ───────────────────────────────────────────────────────────────

export type GuardLevel = 'low' | 'medium' | 'high';

export type GuardEventType =
  | 'motion'                // phone was moved
  | 'charger_connected'     // charger plugged in
  | 'charger_disconnected'  // charger unplugged
  | 'app_switch'            // someone left the app / opened another app
  | 'disarm_attempt'        // someone tried to stop Guard Mode
  | 'wrong_pin';            // wrong PIN entered while trying to stop

/**
 * One silently-recorded Guard Mode event. Captured without any on-screen
 * reaction and only revealed to the owner when Guard Mode is stopped.
 */
export interface GuardEvent {
  id: string;
  type: GuardEventType;
  timestamp: string;
  reason: string;
  /** Front-camera face snap, when one could be taken (app in foreground). */
  imageUri?: string;
  latitude?: number;
  longitude?: number;
}

export interface SafeZone {
  id: string;
  name: string;
  startHour: number;
  endHour: number;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  enabled: boolean;
}

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  platform: 'ios' | 'android';
  lastSeen: string;
  isCurrentDevice: boolean;
  trackingEnabled: boolean;
}

export interface User {
  id: string;
  email: string;
  name?: string;
  photo?: string;
  plan: Plan;
  provider: AuthProvider;
  createdAt: string;
}

export interface PhantomState {
  user: User | null;
  isAuthenticated: boolean;
  isAppUnlocked: boolean;
  unlockedLayers: PINLayer[];
  trackingEnabled: boolean;
  recentActivity: AppUsageEvent[];
  unlockEvents: UnlockEvent[];
  intruderPhotos: IntruderPhoto[];
  // PINs are NOT stored here — they live as salted hashes in the OS keychain
  // (see services/pinVault.ts). Only a "configured" flag is tracked in state.
  decoyPinSet: boolean;
  safeZones: SafeZone[];
  locationEnabled: boolean;
  intruderSnapshotEnabled: boolean;
  autoWipeAfterAttempts: number | null;
  devices: DeviceInfo[];
  // Silently-recorded Guard Mode events, persisted on-device and only surfaced
  // to the owner when Guard Mode is stopped with the correct PIN.
  guardEvents: GuardEvent[];
  // Transient (never persisted): true while Guard Mode is armed, so the root
  // layout doesn't force a biometric re-gate when the app returns to foreground.
  guardArmed: boolean;
}
