/**
 * Guard Mode sensors — the anti-theft "don't touch my phone" engine.
 *
 * Watches the accelerometer for movement and the battery for a charger
 * unplug, and fires onTrigger once armed. The caller (guard-mode screen)
 * owns the camera, siren, and disarm flow.
 */
import { Accelerometer } from 'expo-sensors';
import * as Battery from 'expo-battery';

export type GuardTrigger = 'motion' | 'charger_unplugged';

export interface GuardHandle {
  stop: () => void;
}

export interface GuardOptions {
  /** 0 (relaxed) … 1 (hair-trigger). */
  sensitivity: number;
  /** Also trip the alarm if the charging cable is pulled. */
  watchCharger?: boolean;
  onTrigger: (trigger: GuardTrigger) => void;
}

export function startGuard({ sensitivity, watchCharger = true, onTrigger }: GuardOptions): GuardHandle {
  let fired = false;
  const fire = (t: GuardTrigger) => {
    if (fired) return;
    fired = true;
    onTrigger(t);
  };

  // Deviation (in g) from the 1g resting magnitude needed to trip.
  // Sensitive → small threshold, relaxed → larger.
  const threshold = 0.14 + (1 - clamp01(sensitivity)) * 0.46;

  Accelerometer.setUpdateInterval(180);
  const accSub = Accelerometer.addListener(({ x, y, z }) => {
    const magnitude = Math.sqrt(x * x + y * y + z * z);
    if (Math.abs(magnitude - 1) > threshold) fire('motion');
  });

  let batterySub: { remove: () => void } | null = null;
  if (watchCharger) {
    batterySub = Battery.addBatteryStateListener(({ batteryState }) => {
      if (batteryState === Battery.BatteryState.UNPLUGGED) fire('charger_unplugged');
    });
  }

  return {
    stop() {
      accSub.remove();
      batterySub?.remove();
    },
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
