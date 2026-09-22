import type { PlanId, OAuthProvider } from '@phantomshield/shared';

// Re-use the shared contract's canonical types so the app and backend agree.
export type Plan = PlanId;
export type AuthProvider = OAuthProvider;

/** One app PIN, plus an optional decoy PIN that opens a harmless fake screen. */
export type PINLayer = 'app' | 'decoy';

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
  | 'disarm_attempt'
  | 'pocket';

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

/** Guard Mode presets. `pocket` needs the Android light sensor. */
export type GuardMode = 'table' | 'pocket' | 'charger';

export type GuardEventType =
  | 'motion'                // phone was moved
  | 'charger_connected'     // charger plugged in
  | 'charger_disconnected'  // charger unplugged
  | 'app_switch'            // someone left the app / opened another app
  | 'disarm_attempt'        // someone tried to stop Guard Mode
  | 'wrong_pin'             // wrong PIN entered while trying to stop
  | 'pocket';               // taken out of a pocket or bag

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

/** Lost mode, set from the web: the owner's message to whoever finds the phone. */
export interface LostMode {
  message: string;
  contact: string;
  since: string;
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
  /**
   * First-run setup finished (a PIN exists). An account is optional: without
   * one, everything on the phone works and cloud features ask you to sign in.
   */
  onboarded: boolean;
  isAppUnlocked: boolean;
  /** True when the server declined to store the last photo (monthly cap hit). */
  photoQuotaReached: boolean;
  /** Right and wrong attempts on PhantomShield's own PIN pad. */
  unlockEvents: UnlockEvent[];
  intruderPhotos: IntruderPhoto[];
  // PINs are NOT stored here — they live as salted hashes in the OS keychain
  // (see services/pinVault.ts). Only a "configured" flag is tracked in state.
  decoyPinSet: boolean;
  locationEnabled: boolean;
  /**
   * Continuous background location tracking ("find my phone"). Separate from
   * `locationEnabled`, which only governs tagging a position onto a security
   * event — this one is far more invasive and gets its own explicit consent.
   */
  locationTrackingEnabled: boolean;
  /** Keep Guard Mode watching after the app leaves the foreground. */
  backgroundGuardEnabled: boolean;
  intruderSnapshotEnabled: boolean;
  autoWipeAfterAttempts: number | null;
  devices: DeviceInfo[];
  // Silently-recorded Guard Mode events, persisted on-device and only surfaced
  // to the owner when Guard Mode is stopped with the correct PIN.
  guardEvents: GuardEvent[];
  // Transient (never persisted): true while Guard Mode is armed, so the root
  // layout doesn't force a biometric re-gate when the app returns to foreground.
  guardArmed: boolean;
  /** Set while the owner has marked this phone lost from the web dashboard. */
  lostMode: LostMode | null;
  /** Photos are end-to-end encrypted before backup (the key is in the keychain). */
  e2eEnabled: boolean;
}
