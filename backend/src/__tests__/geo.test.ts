/**
 * Location trail rules.
 *
 * The device is the sole source of these values, and the resulting trail is
 * what an owner might hand to police or an insurer — so what gets stored has to
 * be defensible.
 */
import { describe, it, expect } from '@jest/globals';
import { isPlausiblePing, distanceMeters, thinTrail } from '@/lib/geo';

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
const valid = { lat: 51.5074, lng: -0.1278, accuracy: 20, recordedAt: NOW - 1000 };

describe('ping plausibility', () => {
  it('accepts a normal fix', () => {
    expect(isPlausiblePing(valid, NOW)).toBe(true);
  });

  it('rejects coordinates outside the world', () => {
    expect(isPlausiblePing({ ...valid, lat: 91 }, NOW)).toBe(false);
    expect(isPlausiblePing({ ...valid, lat: -91 }, NOW)).toBe(false);
    expect(isPlausiblePing({ ...valid, lng: 181 }, NOW)).toBe(false);
    expect(isPlausiblePing({ ...valid, lng: -181 }, NOW)).toBe(false);
  });

  it('rejects NaN and Infinity', () => {
    expect(isPlausiblePing({ ...valid, lat: NaN }, NOW)).toBe(false);
    expect(isPlausiblePing({ ...valid, lng: Infinity }, NOW)).toBe(false);
    expect(isPlausiblePing({ ...valid, accuracy: NaN }, NOW)).toBe(false);
  });

  // A trail that claims the phone was somewhere next week is worse than no
  // trail: it discredits the whole record.
  it('rejects timestamps from the future', () => {
    expect(isPlausiblePing({ ...valid, recordedAt: NOW + 5 * 60_000 }, NOW)).toBe(false);
  });

  it('tolerates small clock skew', () => {
    expect(isPlausiblePing({ ...valid, recordedAt: NOW + 30_000 }, NOW)).toBe(true);
  });

  it('rejects a fix so imprecise it means nothing', () => {
    expect(isPlausiblePing({ ...valid, accuracy: 250_000 }, NOW)).toBe(false);
    expect(isPlausiblePing({ ...valid, accuracy: -1 }, NOW)).toBe(false);
  });

  it('rejects a missing or zero timestamp', () => {
    expect(isPlausiblePing({ ...valid, recordedAt: 0 }, NOW)).toBe(false);
  });

  it('accepts the null island rather than special-casing it', () => {
    // 0,0 is a real (if unlikely) coordinate; rejecting it would be a bug.
    expect(isPlausiblePing({ ...valid, lat: 0, lng: 0 }, NOW)).toBe(true);
  });
});

describe('distance', () => {
  it('is zero for the same point', () => {
    expect(distanceMeters({ lat: 51.5, lng: -0.12 }, { lat: 51.5, lng: -0.12 })).toBe(0);
  });

  it('matches a known separation (London ↔ Paris ≈ 344km)', () => {
    const d = distanceMeters({ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 });
    expect(d).toBeGreaterThan(330_000);
    expect(d).toBeLessThan(360_000);
  });

  it('handles a short hop accurately', () => {
    // ~111m of latitude at 0.001 degrees.
    const d = distanceMeters({ lat: 51.5, lng: 0 }, { lat: 51.501, lng: 0 });
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(125);
  });
});

describe('trail thinning', () => {
  const at = (lat: number, lng: number, t: number) => ({ lat, lng, accuracy: 10, recordedAt: t });

  it('collapses a stationary phone to a single point', () => {
    const pings = [at(51.5, -0.12, 1), at(51.5, -0.12, 2), at(51.5, -0.12, 3)];
    expect(thinTrail(pings)).toHaveLength(1);
  });

  it('keeps genuine movement', () => {
    const pings = [at(51.5, -0.12, 1), at(51.51, -0.12, 2), at(51.52, -0.12, 3)];
    expect(thinTrail(pings)).toHaveLength(3);
  });

  it('orders output oldest-first regardless of input order', () => {
    const pings = [at(51.52, -0.12, 3), at(51.5, -0.12, 1), at(51.51, -0.12, 2)];
    const out = thinTrail(pings);
    expect(out.map((p) => p.recordedAt)).toEqual([1, 2, 3]);
  });

  it('handles an empty trail', () => {
    expect(thinTrail([])).toEqual([]);
  });
});
