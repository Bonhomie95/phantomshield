/**
 * Guard Mode sensors — the silent "watch my phone" engine.
 *
 * Unlike a loud alarm, Guard Mode records evidence quietly. It watches the
 * accelerometer and the charger and emits a typed event for each thing it
 * detects. The caller (guard-mode screen) decides what to capture (face snap,
 * location) and stores it; nothing is shown on screen while armed.
 *
 * What each level watches is intentionally different:
 *   • low    — tamper only (wrong PIN / stop attempts, handled by the screen)
 *   • medium — low + phone movement + charger plugged/unplugged
 *   • high   — medium + app switches, plus a hair-trigger on movement
 */
import { Accelerometer } from 'expo-sensors';
import * as Battery from 'expo-battery';
import { GuardLevel, GuardEventType } from '@/constants/types';

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

export interface GuardOptions {
  level: GuardLevel;
  onEvent: (type: GuardEventType) => void;
}

export function startGuard({ level, onEvent }: GuardOptions): GuardHandle {
  const cfg = GUARD_LEVELS[level];

  // Throttle each event type so a single continuous motion (or a bouncing
  // charger contact) doesn't record hundreds of entries.
  const COOLDOWN_MS = 4000;
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
      if (!isCharging(prev) && isCharging(batteryState)) emit('charger_connected');
      else if (isCharging(prev) && !isCharging(batteryState)) emit('charger_disconnected');
    });
  }

  return {
    watchesAppSwitch: cfg.watchAppSwitch,
    stop() {
      accSub?.remove();
      batterySub?.remove();
    },
  };
}
