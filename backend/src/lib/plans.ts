/**
 * Pure plan/billing logic — no DB, so it's unit-testable. Used by the
 * RevenueCat webhook.
 */
import { PlanId } from '@/types';

/**
 * Map RevenueCat entitlement identifiers to our highest matching plan.
 *
 * Both the current identifiers (`starter`, `pro`) and the legacy ones
 * (`guard`, `elite`) are accepted: entitlements already configured in
 * RevenueCat, and subscriptions bought before the rename, must keep working.
 */
export function planFromEntitlements(ids: string[]): PlanId {
  if (ids.includes('pro') || ids.includes('elite')) return 'pro';
  if (ids.includes('starter') || ids.includes('guard')) return 'starter';
  return 'free';
}

/** The plan actually in force right now, accounting for expiry. */
export function effectivePlan(plan: PlanId, planExpiresAt: Date | null | undefined): PlanId {
  return planExpiresAt && planExpiresAt < new Date() ? 'free' : plan;
}
