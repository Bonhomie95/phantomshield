import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PhantomState,
  UnlockEvent,
  IntruderPhoto,
  User,
  GuardEvent,
  LostMode,
} from '@/constants/types';

/** Newest N intruder photos kept on-device; older ones are deleted from disk. */
const MAX_INTRUDER_PHOTOS = 200;

interface PhantomStore extends PhantomState {
  // Auth
  setUser: (user: User | null) => void;
  setAuthenticated: (v: boolean) => void;
  setOnboarded: (v: boolean) => void;
  setAppUnlocked: (v: boolean) => void;

  // Evidence
  setPhotoQuotaReached: (v: boolean) => void;
  addUnlockEvent: (e: UnlockEvent) => void;
  addIntruderPhoto: (p: IntruderPhoto) => void;
  clearLogs: () => void;

  // Config
  setLocationEnabled: (v: boolean) => void;
  setLocationTrackingEnabled: (v: boolean) => void;
  setBackgroundGuardEnabled: (v: boolean) => void;
  setIntruderSnapshotEnabled: (v: boolean) => void;
  setLostMode: (v: LostMode | null) => void;
  setE2eEnabled: (v: boolean) => void;

  // Guard Mode event log
  addGuardEvent: (e: GuardEvent) => void;
  clearGuardEvents: () => void;
  setGuardArmed: (v: boolean) => void;
}

export const usePhantomStore = create<PhantomStore>()(
  persist(
    (set) => ({
      // ── Initial state ────────────────────────────────────────────────────
      user: null,
      isAuthenticated: false,
      onboarded: false,
      // Intentionally NOT persisted (see partialize below) so every app open
      // requires biometric / PIN re-auth.
      isAppUnlocked: false,

      photoQuotaReached: false,
      unlockEvents: [],
      intruderPhotos: [],

      decoyPinSet: false,
      locationEnabled: false,
      locationTrackingEnabled: false,
      backgroundGuardEnabled: false,
      // Opt-in: the camera is only ever used after the owner switches this on
      // (onboarding or Settings), which is also when the OS permission is asked.
      intruderSnapshotEnabled: false,
      autoWipeAfterAttempts: 10,
      guardEvents: [],
      guardArmed: false, // transient — never persisted (see partialize)
      lostMode: null,
      e2eEnabled: false,

      devices: [],

      // ── Actions ──────────────────────────────────────────────────────────
      setUser:          (user)  => set({ user }),
      setAuthenticated: (v)     => set({ isAuthenticated: v }),
      setOnboarded:     (v)     => set({ onboarded: v }),
      setAppUnlocked:   (v)     => set({ isAppUnlocked: v }),

      setPhotoQuotaReached: (v) => set({ photoQuotaReached: v }),

      addUnlockEvent: (e) =>
        set((s) => ({
          unlockEvents: [e, ...s.unlockEvents].slice(0, 200),
        })),

      // Capped like every other list. Guard Mode appends to it per capture, and
      // zustand rewrites the whole persisted blob on every set — unbounded, it
      // crossed Android's ~2MB AsyncStorage value limit and persistence failed
      // silently. Evicted entries' files are cleaned off disk.
      addIntruderPhoto: (p) =>
        set((s) => {
          const next = [p, ...s.intruderPhotos];
          const evicted = next.slice(MAX_INTRUDER_PHOTOS);
          if (evicted.length) {
            void import('@/services/camera').then(({ deleteIntruderPhoto }) => {
              evicted.forEach((e) => {
                if (e.imageUri) void deleteIntruderPhoto(e.imageUri).catch(() => {});
              });
            });
          }
          return { intruderPhotos: next.slice(0, MAX_INTRUDER_PHOTOS) };
        }),

      clearLogs: () => set({ unlockEvents: [], intruderPhotos: [], guardEvents: [] }),

      setLocationEnabled:         (v) => set({ locationEnabled: v }),
      setLocationTrackingEnabled: (v) => set({ locationTrackingEnabled: v }),
      setBackgroundGuardEnabled:  (v) => set({ backgroundGuardEnabled: v }),
      setIntruderSnapshotEnabled: (v) => set({ intruderSnapshotEnabled: v }),
      setLostMode:                (v) => set({ lostMode: v }),
      setE2eEnabled:              (v) => set({ e2eEnabled: v }),

      addGuardEvent: (e) =>
        set((s) => ({ guardEvents: [e, ...s.guardEvents].slice(0, 500) })),
      clearGuardEvents: () => set({ guardEvents: [] }),
      setGuardArmed: (v) => set({ guardArmed: v }),
    }),
    {
      name: 'phantomshield-v1',
      storage: createJSONStorage(() => AsyncStorage),
      // 2: PINs moved out of persisted state into the keychain.
      // 3: activity logging, trusted hours and per-section PIN unlocks removed.
      version: 3,
      migrate: (persisted: any, version) => {
        if (persisted && 'pins' in persisted) delete persisted.pins;
        if (persisted && version < 3) {
          for (const k of ['recentActivity', 'trackingEnabled', 'lastSyncedAt', 'safeZones', 'unlockedLayers']) {
            delete persisted[k];
          }
          // Anyone upgrading already went through setup.
          persisted.onboarded = !!persisted.isAuthenticated;
        }
        return persisted;
      },
      // isAppUnlocked is NEVER persisted — every cold start requires fresh
      // verification. guardArmed is transient too — a killed-while-armed
      // session must not resume as "armed" on next launch.
      partialize: (state) => {
        const { isAppUnlocked, guardArmed, ...rest } = state;
        return rest;
      },
    },
  ),
);
