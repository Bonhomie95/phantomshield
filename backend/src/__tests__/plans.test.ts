import { describe, it, expect } from '@jest/globals';
import { planFromEntitlements } from '@/lib/plans';

describe('planFromEntitlements', () => {
  it('picks the highest entitlement', () => {
    expect(planFromEntitlements(['starter', 'pro'])).toBe('pro');
    expect(planFromEntitlements(['starter'])).toBe('starter');
  });
  it('defaults to free when no known entitlement', () => {
    expect(planFromEntitlements([])).toBe('free');
    expect(planFromEntitlements(['random'])).toBe('free');
  });
});
