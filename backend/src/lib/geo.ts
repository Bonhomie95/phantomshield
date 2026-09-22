/**
 * Pure geo helpers for the location trail.
 *
 * Kept free of I/O so the rules that decide what enters the most sensitive
 * series this product holds can be tested exhaustively.
 */

export interface RawPing {
  lat: number;
  lng: number;
  accuracy: number;
  recordedAt: number;
}

/**
 * Whether a reported fix is plausible enough to store.
 *
 * The device is the only source of these values, so a buggy build — or a
 * tampered one — can otherwise write a trail claiming the phone was at the
 * north pole next Tuesday, and that trail is what someone might take to the
 * police.
 */
export function isPlausiblePing(p: RawPing, now: number = Date.now()): boolean {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
  if (p.lat < -90 || p.lat > 90) return false;
  if (p.lng < -180 || p.lng > 180) return false;
  if (!Number.isFinite(p.accuracy) || p.accuracy < 0) return false;
  // A fix "accurate" to more than 100km tells you nothing and is usually a
  // failed lookup rather than a position.
  if (p.accuracy > 100_000) return false;
  if (!Number.isFinite(p.recordedAt) || p.recordedAt <= 0) return false;
  // Allow a minute of clock skew, but never accept the future.
  if (p.recordedAt > now + 60_000) return false;
  return true;
}

/** Great-circle distance in metres. */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Drop fixes that add nothing: a stationary phone reporting the same spot
 * repeatedly costs storage and makes the map trail unreadable, without telling
 * the owner anything they don't already know.
 */
export function thinTrail<T extends RawPing>(pings: T[], minMeters = 25): T[] {
  const sorted = [...pings].sort((a, b) => a.recordedAt - b.recordedAt);
  const kept: T[] = [];
  for (const p of sorted) {
    const last = kept[kept.length - 1];
    if (!last || distanceMeters(last, p) >= minMeters) kept.push(p);
  }
  return kept;
}
