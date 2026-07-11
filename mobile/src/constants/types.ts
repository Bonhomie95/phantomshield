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
  | 'charger_unplugged';

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
  // Guard Mode: false = stealth (no notification, screen stays on, foreground only);
  // true = background (keeps running when backgrounded, but shows the OS-mandated
  // persistent notification — Android requires one for a foreground service).
  guardBackgroundMode: boolean;
}
