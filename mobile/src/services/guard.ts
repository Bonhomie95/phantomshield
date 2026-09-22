/**
 * Guard Mode sensors — the silent "watch my phone" engine.
 *
 * Unlike a loud alarm, Guard Mode records evidence quietly. It watches the
 * accelerometer and the charger and emits a typed event for each thing it
 * detects. The caller (guard-mode screen) decides what to capture (face snap,
 * location) and stores it; nothing is shown on screen while armed.
 *
 * Three modes, for the three places a phone gets taken from:
 *   • table   — left on a table or desk. What each level watches differs:
 *       low    — tamper only (wrong PIN / stop attempts, handled by the screen)
 *       medium — low + phone movement + charger plugged/unplugged
 *       high   — medium + app switches, plus a hair-trigger on movement
 *   • charger — charging in public. Only an unplug counts.
 *   • pocket  — in a pocket or bag (Android). The light sensor notices it being
 *               pulled out into the light. Motion is ignored: walking moves it.
 */
import { Platform } from 'react-native';
import { Accelerometer, LightSensor } from 'expo-sensors';
import * as Battery from 'expo-battery';
import { GuardLevel, GuardEventType, GuardMode } from '@/constants/types';

export interface GuardHandle {
  stop: () => void;
  /** Whether this level should also record app-switches (checked by the screen). */
  watchesAppSwitch: boolean;
}

export interface LevelConfig {
  watchMotion: boolean;
  /** Deviation (in g) from the 1g resting magnitude needed to count as motion. */
  motionThreshold: number;
  watchCharger: boolean;
  watchAppSwitch: boolean;
}

export const GUARD_LEVELS: Record<GuardLevel, LevelConfig> = {
  low:    { watchMotion: false, motionThreshold: 0.5,  watchCharger: false, watchAppSwitch: false },
  medium: { watchMotion: true,  motionThreshold: 0.35, watchCharger: true,  watchAppSwitch: false },
  high:   { watchMotion: true,  motionThreshold: 0.14, watchCharger: true,  watchAppSwitch: true  },
};

export const GUARD_LEVEL_SUMMARY: Record<GuardLevel, string> = {
  low:    'Records only tamper attempts (wrong PIN, stop attempts).',
  medium: 'Records movement, charger changes, and tamper attempts.',
  high:   'Records everything: movement, charger, app switches, and tampering.',
};

export const GUARD_MODE_SUMMARY: Record<GuardMode, { title: string; desc: string }> = {
  table:   { title: 'On a table', desc: 'Notices the phone being picked up or moved.' },
  charger: { title: 'Charging', desc: 'Notices the charger being pulled out.' },
  pocket:  { title: 'In a pocket or bag', desc: 'Notices the phone being taken out into the light.' },
};

/** Pocket mode needs the ambient light sensor, which only Android exposes. */
export async function isPocketModeAvailable(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  return LightSensor.isAvailableAsync().catch(() => false);
}

// Lux thresholds with a gap between them, so light hovering near one value
// can't flip the state back and forth. A pocket reads ~0–5 lx; indoors 100+.
const DARK_LUX = 8;
const LIGHT_LUX = 40;
const DARK_SETTLE_MS = 2_000;

export interface GuardOptions {
  level: GuardLevel;
  mode?: GuardMode;
  onEvent: (type: GuardEventType) => void;
  /** Pocket mode: called once the phone has been dark long enough to count as pocketed. */
  onPocketed?: () => void;
}

export function startGuard({ level, mode = 'table', onEvent, onPocketed }: GuardOptions): GuardHandle {
  const cfg: LevelConfig =
    mode === 'table' ? GUARD_LEVELS[level]
    : { watchMotion: false, motionThreshold: 1, watchCharger: mode === 'charger', watchAppSwitch: false };

  // Throttle each event type so a single continuous motion (or a bouncing
  // charger contact) doesn't record hundreds of entries.
  // Per-event-type throttle. `high` uses a hair-trigger motion threshold
  // (0.14g), so at a 4s cooldown one armed phone could emit ~15 motion events a
  // minute — each one a photo, an R2 object, a database row, a WebSocket
  // broadcast and a push job. An 8-hour session could produce thousands.
  const COOLDOWN_MS = level === 'high' ? 15_000 : 8_000;
  const lastFired: Partial<Record<GuardEventType, number>> = {};
  const emit = (t: GuardEventType) => {
    const now = Date.now();
    if (lastFired[t] && now - lastFired[t]! < COOLDOWN_MS) return;
    lastFired[t] = now;
    onEvent(t);
  };

  let accSub: { remove: () => void } | null = null;
  if (cfg.watchMotion) {
    Accelerometer.setUpdateInterval(180);
    accSub = Accelerometer.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      if (Math.abs(magnitude - 1) > cfg.motionThreshold) emit('motion');
    });
  }

  let batterySub: { remove: () => void } | null = null;
  if (cfg.watchCharger) {
    // The listener also fires with the *current* state (not just changes), and
    // "not charging" IS BatteryState.UNPLUGGED — so without seeding the previous
    // state, arming an unplugged phone records a phantom "charger unplugged".
    // Only genuine plugged↔unplugged transitions are evidence.
    let prevState: Battery.BatteryState | null = null;
    Battery.getBatteryStateAsync()
      .then((s) => { if (prevState === null) prevState = s; })
      .catch(() => {});

    const isCharging = (s: Battery.BatteryState) =>
      s === Battery.BatteryState.CHARGING || s === Battery.BatteryState.FULL;

    batterySub = Battery.addBatteryStateListener(({ batteryState }) => {
      if (batteryState === Battery.BatteryState.UNKNOWN) return;
      const prev = prevState;
      prevState = batteryState;
      if (prev === null || prev === batteryState) return; // first reading / no change
      if (!isCharging(prev) && isCharging(batteryState)) {
        if (mode !== 'charger') emit('charger_connected');
      }
      else if (isCharging(prev) && !isCharging(batteryState)) emit('charger_disconnected');
    });
  }

  // Pocket: wait until it has been dark for a moment (it's in the pocket), then
  // the first strong light means someone took it out.
  let lightSub: { remove: () => void } | null = null;
  if (mode === 'pocket') {
    let darkSince: number | null = null;
    let pocketed = false;
    LightSensor.setUpdateInterval(300);
    lightSub = LightSensor.addListener(({ illuminance }) => {
      const now = Date.now();
      if (!pocketed) {
        if (illuminance <= DARK_LUX) {
          darkSince ??= now;
          if (now - darkSince >= DARK_SETTLE_MS) {
            pocketed = true;
            onPocketed?.();
          }
        } else {
          darkSince = null;
        }
        return;
      }
      if (illuminance >= LIGHT_LUX) emit('pocket');
    });
  }

  return {
    watchesAppSwitch: cfg.watchAppSwitch,
    stop() {
      accSub?.remove();
      batterySub?.remove();
      lightSub?.remove();
    },
  };
}
