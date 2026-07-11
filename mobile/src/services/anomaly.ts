/**
 * Anomaly detection — pure logic, no side effects.
 * Called by the tracker every time an unlock or app-open event fires.
 */
import { SafeZone } from '@/constants/types';

export interface AnomalyResult {
  isAnomaly: boolean;
  reason?: string;
}

/**
 * Check whether `now` falls outside every enabled safe zone.
 * If all zones are disabled or none are configured → no anomaly.
 */
export function checkTimeAnomaly(now: Date, safeZones: SafeZone[]): AnomalyResult {
  const activeZones = safeZones.filter((z) => z.enabled);
  if (activeZones.length === 0) return { isAnomaly: false };

  const hour = now.getHours();

  const inAnyZone = activeZones.some((zone) => {
    // Handle overnight ranges e.g. 22:00 – 06:00
    if (zone.startHour <= zone.endHour) {
      return hour >= zone.startHour && hour < zone.endHour;
    } else {
      return hour >= zone.startHour || hour < zone.endHour;
    }
  });

  if (inAnyZone) return { isAnomaly: false };

  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return {
    isAnomaly: true,
    reason: `Phone accessed at ${timeStr}, outside your trusted hours`,
  };
}

/** Check whether a PIN failure count crosses a notification threshold. */
export function shouldAlertOnAttempts(attempts: number): boolean {
  return attempts === 3 || attempts === 5 || attempts % 10 === 0;
}
