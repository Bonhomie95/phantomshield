/**
 * Location capture for intruder / anti-theft events.
 * Best-effort: returns null if permission is denied or lookup fails.
 */
import * as Location from 'expo-location';

export interface GeoFix {
  lat: number;
  lng: number;
  accuracy: number;
}

let permissionAsked = false;

/** Request foreground location permission once (lazily). */
export async function ensureLocationPermission(): Promise<boolean> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.granted) return true;
    if (permissionAsked && !current.canAskAgain) return false;
    permissionAsked = true;
    const req = await Location.requestForegroundPermissionsAsync();
    return req.granted;
  } catch {
    return false;
  }
}

/** Grab a single best-effort location fix, or null. */
export async function captureLocation(): Promise<GeoFix | null> {
  try {
    const granted = await ensureLocationPermission();
    if (!granted) return null;
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? 0,
    };
  } catch {
    return null;
  }
}
