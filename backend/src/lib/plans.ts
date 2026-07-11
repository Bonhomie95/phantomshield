/**
 * Pure plan/billing logic — no DB, so it's unit-testable. Used by the
 * RevenueCat webhook and the referral reward flow.
 */
import { PlanId } from '@/types';

/** Map RevenueCat entitlement identifiers to our highest matching plan. */
export function planFromEntitlements(ids: string[]): PlanId {
  if (ids.includes('elite')) return 'elite';
  if (ids.includes('guard')) return 'guard';
  return 'free';
}

export interface PlanState {
  plan: PlanId;
  planExpiresAt: Date | null;
}

/**
 * Grant `days` of Guard on top of the current state — but never downgrade or
 * shorten a user who already has a paid plan. Extends from the later of "now"
 * and the existing expiry so stacked referrals add up.
 */
export function applyGuardBonus(current: PlanState, days: number, now: Date = new Date()): PlanState {
  if (current.plan === 'elite' || current.plan === 'guard') return current;
  const base = current.planExpiresAt && current.planExpiresAt > now ? current.planExpiresAt : now;
  return {
    plan: 'guard',
    planExpiresAt: new Date(base.getTime() + days * 86_400_000),
  };
}
