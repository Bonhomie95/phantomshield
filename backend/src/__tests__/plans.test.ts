import { describe, it, expect } from '@jest/globals';
import { planFromEntitlements, applyGuardBonus } from '@/lib/plans';

describe('planFromEntitlements', () => {
  it('picks the highest entitlement', () => {
    expect(planFromEntitlements(['guard', 'elite'])).toBe('elite');
    expect(planFromEntitlements(['guard'])).toBe('guard');
  });
  it('defaults to free when no known entitlement', () => {
    expect(planFromEntitlements([])).toBe('free');
    expect(planFromEntitlements(['random'])).toBe('free');
  });
});

describe('applyGuardBonus', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const days = (d: Date | null) => (d ? Math.round((d.getTime() - now.getTime()) / 86_400_000) : null);

  it('grants 30 days to a free user from now', () => {
    const next = applyGuardBonus({ plan: 'free', planExpiresAt: null }, 30, now);
    expect(next.plan).toBe('guard');
    expect(days(next.planExpiresAt)).toBe(30);
  });

  it('stacks on top of an existing future expiry', () => {
    const existing = new Date(now.getTime() + 10 * 86_400_000);
    const next = applyGuardBonus({ plan: 'free', planExpiresAt: existing }, 30, now);
    expect(days(next.planExpiresAt)).toBe(40);
  });

  it('never downgrades or shortens a paying user', () => {
    const elite = { plan: 'elite' as const, planExpiresAt: new Date(now.getTime() + 5 * 86_400_000) };
    expect(applyGuardBonus(elite, 30, now)).toEqual(elite);
    const guard = { plan: 'guard' as const, planExpiresAt: new Date(now.getTime() + 5 * 86_400_000) };
    expect(applyGuardBonus(guard, 30, now)).toEqual(guard);
  });

  it('ignores a stale (past) expiry and grants from now', () => {
    const past = new Date(now.getTime() - 100 * 86_400_000);
    const next = applyGuardBonus({ plan: 'free', planExpiresAt: past }, 30, now);
    expect(days(next.planExpiresAt)).toBe(30);
  });
});
