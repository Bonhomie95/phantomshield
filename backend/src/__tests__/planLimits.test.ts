import { describe, it, expect } from '@jest/globals';
import { PLAN_LIMITS, PLAN_META, PlanId, normalizePlan } from '@phantomshield/shared';

describe('PLAN_LIMITS contract', () => {
  const plans: PlanId[] = ['free', 'starter', 'pro'];

  it('defines every plan', () => {
    for (const p of plans) {
      expect(PLAN_LIMITS[p]).toBeDefined();
      expect(PLAN_META[p]).toBeDefined();
    }
  });

  it('grows history retention with tier', () => {
    expect(PLAN_LIMITS.free.historyDays).toBeLessThan(PLAN_LIMITS.starter.historyDays);
    expect(PLAN_LIMITS.starter.historyDays).toBeLessThan(PLAN_LIMITS.pro.historyDays);
  });

  it('grows device and snapshot allowances with tier', () => {
    expect(PLAN_LIMITS.free.devices).toBeLessThan(PLAN_LIMITS.starter.devices);
    expect(PLAN_LIMITS.starter.devices).toBeLessThan(PLAN_LIMITS.pro.devices);
    expect(PLAN_LIMITS.free.intruderSnapshots).toBeLessThan(PLAN_LIMITS.starter.intruderSnapshots);
  });

  /**
   * The safety guarantee. If the phone is gone, the web dashboard is the only
   * surface the owner has left — so seeing your own evidence is never paywalled,
   * on any tier. Locking this down in a test makes it a deliberate decision to
   * change rather than an accident during a pricing experiment.
   */
  it('gives EVERY tier access to the web dashboard', () => {
    for (const p of plans) expect(PLAN_LIMITS[p].remoteDashboard).toBe(true);
  });

  /**
   * Same reasoning as the dashboard guarantee: a phone you cannot find is the
   * exact failure this product exists to prevent, so locating your own device
   * is never the paywalled part. Plans differ on history depth.
   */
  it('lets EVERY tier find its own phone', () => {
    for (const p of plans) expect(PLAN_LIMITS[p].findMyPhone).toBe(true);
  });

  it('gives every tier some cloud-stored evidence', () => {
    for (const p of plans) {
      const snaps = PLAN_LIMITS[p].intruderSnapshots;
      expect(snaps === -1 || snaps > 0).toBe(true);
    }
  });

  it('gates remote commands, export and ad-free behind paid tiers', () => {
    expect(PLAN_LIMITS.free.remoteCommands).toBe(false);
    expect(PLAN_LIMITS.free.export).toBe(false);
    expect(PLAN_LIMITS.free.ads).toBe(true);

    for (const p of ['starter', 'pro'] as PlanId[]) {
      expect(PLAN_LIMITS[p].remoteCommands).toBe(true);
      expect(PLAN_LIMITS[p].export).toBe(true);
      expect(PLAN_LIMITS[p].ads).toBe(false);
    }
  });

  it('uses -1 to mean unlimited on pro', () => {
    expect(PLAN_LIMITS.pro.intruderSnapshots).toBe(-1);
    expect(PLAN_LIMITS.pro.guardians).toBeGreaterThan(PLAN_LIMITS.free.guardians);
  });
});

describe('legacy plan normalisation', () => {
  // Rows in Mongo, RevenueCat entitlements and unexpired JWTs can still carry
  // the pre-rename identifiers. Losing this mapping would silently downgrade
  // every existing paying customer to free.
  it('maps legacy tiers onto their replacements', () => {
    expect(normalizePlan('guard')).toBe('starter');
    expect(normalizePlan('elite')).toBe('pro');
  });

  it('passes current tiers through unchanged', () => {
    expect(normalizePlan('free')).toBe('free');
    expect(normalizePlan('starter')).toBe('starter');
    expect(normalizePlan('pro')).toBe('pro');
  });

  it('fails closed to free on anything unrecognised', () => {
    expect(normalizePlan(undefined)).toBe('free');
    expect(normalizePlan(null)).toBe('free');
    expect(normalizePlan('platinum')).toBe('free');
    expect(normalizePlan(42)).toBe('free');
  });
});
