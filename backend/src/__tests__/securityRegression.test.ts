/**
 * Security regression tests.
 *
 * Each case here corresponds to a vulnerability that was found and fixed in the
 * audit (docs/AUDIT.md). They exist so that a future refactor cannot quietly
 * reintroduce the same hole: before this file, every one of these fixes sat in
 * a file with zero test coverage.
 *
 * Scope note: these cover the pure, dependency-free security predicates. The
 * route-level equivalents need an API harness with a real Mongo/Redis, which is
 * tracked separately in the roadmap.
 */
import { describe, it, expect } from '@jest/globals';
import { bearerMatches, effectivePlan } from '../routes/billing';
import { intruderKey, isJpeg } from '../services/storage';
import { planFromEntitlements } from '../lib/plans';

// ─── RevenueCat webhook auth ──────────────────────────────────────────────────
// Regression: the webhook previously skipped auth entirely when the secret was
// unset (`if (secret && auth !== ...)`), letting anyone grant themselves any
// plan. The route now refuses to run without a secret; this locks the
// comparison itself.

describe('webhook bearer authentication', () => {
  const SECRET = 'a-real-webhook-secret-value';

  it('accepts only the exact bearer secret', () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it('rejects a missing Authorization header', () => {
    expect(bearerMatches(undefined, SECRET)).toBe(false);
    expect(bearerMatches('', SECRET)).toBe(false);
  });

  it('rejects a wrong secret of identical length (not just a length check)', () => {
    const sameLengthWrong = 'a-real-webhook-secret-valuX';
    expect(sameLengthWrong.length).toBe(SECRET.length);
    expect(bearerMatches(`Bearer ${sameLengthWrong}`, SECRET)).toBe(false);
  });

  it('rejects a prefix, a suffix, and a missing scheme', () => {
    expect(bearerMatches(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
    expect(bearerMatches(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(bearerMatches(SECRET, SECRET)).toBe(false);
  });

  it('rejects a differently-cased scheme', () => {
    expect(bearerMatches(`bearer ${SECRET}`, SECRET)).toBe(false);
  });
});

// ─── Plan expiry ──────────────────────────────────────────────────────────────
// Regression: GET /billing/plan returned the raw DB plan, so a lapsed paid plan
// (or an expired referral grant) still reported as active.

describe('effective plan honours expiry', () => {
  const past = new Date(Date.now() - 60_000);
  const future = new Date(Date.now() + 60_000);

  it('downgrades an expired paid plan to free', () => {
    expect(effectivePlan('starter', past)).toBe('free');
    expect(effectivePlan('pro', past)).toBe('free');
  });

  it('keeps an unexpired paid plan', () => {
    expect(effectivePlan('starter', future)).toBe('starter');
    expect(effectivePlan('pro', future)).toBe('pro');
  });

  it('treats a null expiry as non-expiring', () => {
    expect(effectivePlan('pro', null)).toBe('pro');
  });
});

// ─── Intruder photo object keys (IDOR) ────────────────────────────────────────
// Regression: the client-supplied R2 key was stored verbatim and later signed
// for download, so a caller could request a signed URL for another user's photo.
// Keys are now derived server-side and namespaced by user id.

describe('intruder photo object keys are user-scoped and sanitised', () => {
  it('namespaces every key under the owning user', () => {
    expect(intruderKey('user-a', 'evt1')).toBe('intruder/user-a/evt1.jpg');
    expect(intruderKey('user-b', 'evt1')).toBe('intruder/user-b/evt1.jpg');
  });

  it('never lets two users collide on the same object', () => {
    expect(intruderKey('user-a', 'evt1')).not.toBe(intruderKey('user-b', 'evt1'));
  });

  it('strips traversal and separators out of the event id', () => {
    // A crafted id must not be able to climb out of the user's prefix.
    // Dots and slashes are stripped; `-` and `_` are legal id characters and
    // survive, so the crafted id collapses to a harmless leaf name.
    const key = intruderKey('user-a', '../../user-b/evt1');
    expect(key).toBe('intruder/user-a/user-bevt1.jpg');
    expect(key.startsWith('intruder/user-a/')).toBe(true);
    expect(key).not.toContain('..');
    expect(key.split('/')).toHaveLength(3);
  });

  it('keeps the prefix intact for ids made entirely of illegal characters', () => {
    const key = intruderKey('user-a', '../..');
    expect(key.startsWith('intruder/user-a/')).toBe(true);
    expect(key).not.toContain('..');
  });
});

// ─── Photo upload content ─────────────────────────────────────────────────────
// Regression: uploads must be constrained to JPEG so the photo route can't be
// used to store (and later serve from our origin) arbitrary content.

describe('photo uploads are constrained to JPEG', () => {
  it('accepts a JPEG header', () => {
    expect(isJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xdb]))).toBe(true);
  });
  it('rejects HTML/SVG payloads', () => {
    expect(isJpeg(Buffer.from('<html><script>x</script>'))).toBe(false);
  });
});

// ─── Entitlements ─────────────────────────────────────────────────────────────
// Regression: entitlement mapping must pick the highest tier.

describe('entitlement mapping', () => {
  it('maps entitlements to the highest tier', () => {
    expect(planFromEntitlements(['starter', 'pro'])).toBe('pro');
    expect(planFromEntitlements(['starter'])).toBe('starter');
    expect(planFromEntitlements([])).toBe('free');
    expect(planFromEntitlements(['bogus'])).toBe('free');
  });

  // Subscriptions bought before the free/starter/pro rename must keep the
  // access they paid for; the legacy entitlement ids stay mapped.
  it('still honours legacy guard/elite entitlements', () => {
    expect(planFromEntitlements(['elite'])).toBe('pro');
    expect(planFromEntitlements(['guard'])).toBe('starter');
    expect(planFromEntitlements(['guard', 'elite'])).toBe('pro');
  });
});
