import { describe, it, expect } from '@jest/globals';
import { PLAN_LIMITS, PlanId } from '@phantomshield/shared';

describe('PLAN_LIMITS contract', () => {
  const plans: PlanId[] = ['free', 'guard', 'elite'];

  it('defines every plan', () => {
    for (const p of plans) expect(PLAN_LIMITS[p]).toBeDefined();
  });

  it('grows history retention with tier', () => {
    expect(PLAN_LIMITS.free.historyDays).toBeLessThan(PLAN_LIMITS.guard.historyDays);
    expect(PLAN_LIMITS.guard.historyDays).toBeLessThan(PLAN_LIMITS.elite.historyDays);
  });

  it('gates remote dashboard + export behind paid tiers', () => {
    expect(PLAN_LIMITS.free.remoteDashboard).toBe(false);
    expect(PLAN_LIMITS.free.export).toBe(false);
    expect(PLAN_LIMITS.guard.remoteDashboard).toBe(true);
    expect(PLAN_LIMITS.elite.remoteDashboard).toBe(true);
  });

  it('uses -1 to mean unlimited on elite', () => {
    expect(PLAN_LIMITS.elite.intruderSnapshots).toBe(-1);
    expect(PLAN_LIMITS.elite.safeZones).toBe(-1);
  });

  it('gives free tier no intruder snapshots and exactly one device', () => {
    expect(PLAN_LIMITS.free.intruderSnapshots).toBe(0);
    expect(PLAN_LIMITS.free.devices).toBe(1);
  });
});
