import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PhantomState,
  AppUsageEvent,
  UnlockEvent,
  IntruderPhoto,
  PINLayer,
  User,
  SafeZone,
  GuardEvent,
} from '@/constants/types';

interface PhantomStore extends PhantomState {
  // Auth
  setUser: (user: User | null) => void;
  setAuthenticated: (v: boolean) => void;
  setAppUnlocked: (v: boolean) => void;
  unlockLayer: (layer: PINLayer) => void;
  lockLayer: (layer: PINLayer) => void;
  lockAllLayers: () => void;

  // Tracking
  setTrackingEnabled: (v: boolean) => void;
  addActivityEvent: (e: AppUsageEvent) => void;
  addUnlockEvent: (e: UnlockEvent) => void;
  addIntruderPhoto: (p: IntruderPhoto) => void;
  clearLogs: () => void;

  // Config
  setLocationEnabled: (v: boolean) => void;
  setIntruderSnapshotEnabled: (v: boolean) => void;

  // Guard Mode event log
  addGuardEvent: (e: GuardEvent) => void;
  clearGuardEvents: () => void;
  setGuardArmed: (v: boolean) => void;
  addSafeZone: (z: SafeZone) => void;
  removeSafeZone: (id: string) => void;
  updateSafeZone: (id: string, patch: Partial<SafeZone>) => void;
}

export const usePhantomStore = create<PhantomStore>()(
  persist(
    (set) => ({
      // ── Initial state ────────────────────────────────────────────────────
      user: null,
      isAuthenticated: false,
      // These two are intentionally NOT persisted (see partialize below)
      // so every app open requires biometric re-auth
      isAppUnlocked: false,
      unlockedLayers: [],

      trackingEnabled: false,   // off by default — user must explicitly enable
      recentActivity: [],
      unlockEvents: [],
      intruderPhotos: [],

      decoyPinSet: false,
      safeZones: [],
      locationEnabled: false,
      intruderSnapshotEnabled: true,
      autoWipeAfterAttempts: 10,
      guardEvents: [],
      guardArmed: false, // transient — never persisted (see partialize)

      devices: [],

      // ── Actions ──────────────────────────────────────────────────────────
      setUser:          (user)  => set({ user }),
      setAuthenticated: (v)     => set({ isAuthenticated: v }),
      setAppUnlocked:   (v)     => set({ isAppUnlocked: v }),

      unlockLayer: (layer) =>
        set((s) => ({
          unlockedLayers: s.unlockedLayers.includes(layer)
            ? s.unlockedLayers
            : [...s.unlockedLayers, layer],
        })),
      lockLayer: (layer) =>
        set((s) => ({ unlockedLayers: s.unlockedLayers.filter((l) => l !== layer) })),
      lockAllLayers: () => set({ unlockedLayers: [] }),

      setTrackingEnabled: (v) => set({ trackingEnabled: v }),

      addActivityEvent: (e) =>
        set((s) => ({
          // Keep latest 500 events — oldest drop off
          recentActivity: [e, ...s.recentActivity].slice(0, 500),
        })),

      addUnlockEvent: (e) =>
        set((s) => ({
          unlockEvents: [e, ...s.unlockEvents].slice(0, 200),
        })),

      addIntruderPhoto: (p) =>
        set((s) => ({ intruderPhotos: [p, ...s.intruderPhotos] })),

      clearLogs: () => set({ recentActivity: [], unlockEvents: [], intruderPhotos: [] }),

      setLocationEnabled:         (v) => set({ locationEnabled: v }),
      setIntruderSnapshotEnabled: (v) => set({ intruderSnapshotEnabled: v }),

      addGuardEvent: (e) =>
        set((s) => ({ guardEvents: [e, ...s.guardEvents].slice(0, 500) })),
      clearGuardEvents: () => set({ guardEvents: [] }),
      setGuardArmed: (v) => set({ guardArmed: v }),

      addSafeZone: (z) =>
        set((s) => ({ safeZones: [...s.safeZones, z] })),
      removeSafeZone: (id) =>
        set((s) => ({ safeZones: s.safeZones.filter((z) => z.id !== id) })),
      updateSafeZone: (id, patch) =>
        set((s) => ({
          safeZones: s.safeZones.map((z) => (z.id === id ? { ...z, ...patch } : z)),
        })),
    }),
    {
      name: 'phantomshield-v1',
      storage: createJSONStorage(() => AsyncStorage),
      // Bumped to 2 when PINs moved out of persisted state into the keychain.
      version: 2,
      // Strip legacy plaintext `pins` left in AsyncStorage by v1 builds.
      migrate: (persisted: any) => {
        if (persisted && 'pins' in persisted) delete persisted.pins;
        return persisted;
      },
      // isAppUnlocked and unlockedLayers are NEVER persisted —
      // every cold start requires biometric re-auth and fresh PIN entry.
      // guardArmed is transient too — a killed-while-armed session must not
      // resume as "armed" on next launch.
      partialize: (state) => {
        const { isAppUnlocked, unlockedLayers, guardArmed, ...rest } = state;
        return rest;
      },
    },
  ),
);
