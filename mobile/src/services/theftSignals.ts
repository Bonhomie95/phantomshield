/**
 * OS-level theft signals.
 *
 * Intruder capture only ever fired inside PhantomShield's own PIN pad, so a
 * thief who unlocked the phone normally and never opened the app triggered
 * nothing at all. These are the signals that fire *without* the app being
 * touched — the ones that actually indicate a phone has changed hands.
 *
 * WHAT IS ACHIEVABLE, HONESTLY:
 *
 *  ✓ SIM / carrier change — the classic theft tell. Detected by comparing the
 *    current carrier identity against a baseline stored in the keychain. Uses
 *    only the network-operator fields, which need no extra Android permission;
 *    the SIM *serial* would require READ_PHONE_STATE (and is restricted on
 *    Android 10+ anyway), which is not worth the store-review scrutiny.
 *  ✓ SIM removed — carrier identity disappears entirely.
 *  ✓ "Went dark" — inferred SERVER-side from presence loss, which is the only
 *    place it can be observed once the phone is off.
 *
 *  ✗ Reboot / power-off detection needs a native BroadcastReceiver on Android
 *    (RECEIVE_BOOT_COMPLETED + ACTION_SHUTDOWN) and is simply unavailable on
 *    iOS. There is no reliable JS-only proxy — an earlier attempt here inferred
 *    it from process uptime and was wrong often enough to be worse than nothing.
 *  ✗ Failed *device* passcode attempts need a DeviceAdmin receiver (Android)
 *    and are impossible on iOS.
 *  ✗ Uninstall protection needs device-owner privileges.
 *
 * Those are noted rather than faked. A security product must never claim a
 * protection it does not have, and a detector that fires wrongly trains the
 * owner to ignore the one that matters.
 */
import * as Cellular from 'expo-cellular';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { TheftSignalType } from '@phantomshield/shared';
import { API_URL } from '@/constants/config';
import { getAccessToken, getOrCreateDeviceId } from '@/services/api';
import { captureLocation } from '@/services/location';
import { usePhantomStore } from '@/stores/phantom';
import { captureError } from '@/services/monitoring';
import { track } from '@/services/analytics';

/** Baseline lives in the keychain: a thief clearing app data shouldn't reset it. */
const CARRIER_KEY = 'ps_carrier_baseline';

interface CarrierIdentity {
  carrier: string | null;
  mcc: string | null;
  mnc: string | null;
  iso: string | null;
}

async function readCarrier(): Promise<CarrierIdentity> {
  const [carrier, mcc, mnc, iso] = await Promise.all([
    Cellular.getCarrierNameAsync().catch(() => null),
    Cellular.getMobileCountryCodeAsync().catch(() => null),
    Cellular.getMobileNetworkCodeAsync().catch(() => null),
    Cellular.getIsoCountryCodeAsync().catch(() => null),
  ]);
  return { carrier, mcc, mnc, iso };
}

/** A SIM is "present" when the network identifies itself at all. */
const hasSim = (c: CarrierIdentity): boolean => Boolean(c.mcc || c.mnc || c.carrier);

/** Compare on MCC/MNC first — carrier NAME changes for benign reasons (roaming, rebrands). */
function isDifferentSim(a: CarrierIdentity, b: CarrierIdentity): boolean {
  if (a.mcc && b.mcc && a.mnc && b.mnc) return a.mcc !== b.mcc || a.mnc !== b.mnc;
  // Fall back to the name only when numeric identity is unavailable on both.
  if (a.carrier && b.carrier) return a.carrier !== b.carrier;
  return false;
}

async function loadBaseline(): Promise<CarrierIdentity | null> {
  try {
    const raw = await SecureStore.getItemAsync(CARRIER_KEY);
    return raw ? (JSON.parse(raw) as CarrierIdentity) : null;
  } catch {
    return null;
  }
}

async function saveBaseline(c: CarrierIdentity): Promise<void> {
  await SecureStore.setItemAsync(CARRIER_KEY, JSON.stringify(c)).catch(() => {});
}

/** Report a signal to the backend, with a location fix when consent allows. */
export async function reportTheftSignal(
  type: TheftSignalType,
  detail?: string,
): Promise<boolean> {
  const token = await getAccessToken();
  if (!token) return false;

  const deviceId = await getOrCreateDeviceId();

  // A theft signal is exactly when a position is most valuable — but consent
  // still governs whether we may take one.
  const consented = usePhantomStore.getState().locationEnabled;
  const fix = consented ? await captureLocation().catch(() => null) : null;

  try {
    const res = await fetch(`${API_URL}/devices/${encodeURIComponent(deviceId)}/theft-signal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': deviceId,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ type, detail, location: fix ?? undefined }),
    });
    track('theft_signal_reported', { signal: type, delivered: res.ok });
    return res.ok;
  } catch (err) {
    captureError(err, { scope: 'reportTheftSignal', type });
    return false;
  }
}

/**
 * Check for a SIM change and report it.
 *
 * Called on every foreground. The first run only records a baseline — a fresh
 * install must never fire a theft alert at its own owner.
 */
export async function checkSimChange(): Promise<TheftSignalType | null> {
  // expo-cellular reports nothing meaningful on a simulator or a wifi-only
  // tablet; treating that as "SIM removed" would alert constantly.
  if (Platform.OS === 'web') return null;

  const current = await readCarrier();
  const baseline = await loadBaseline();

  if (!baseline) {
    // Only take a baseline when there is a real SIM to baseline against.
    if (hasSim(current)) await saveBaseline(current);
    return null;
  }

  if (hasSim(baseline) && !hasSim(current)) {
    await reportTheftSignal('sim_removed', 'The SIM card is no longer present.');
    // Don't overwrite the baseline: if the original SIM returns we want to
    // recognise it rather than treat it as another change.
    return 'sim_removed';
  }

  if (hasSim(current) && isDifferentSim(baseline, current)) {
    const detail = current.carrier
      ? `Now on ${current.carrier}${current.iso ? ` (${current.iso.toUpperCase()})` : ''}.`
      : 'A different SIM is in the phone.';
    await reportTheftSignal('sim_changed', detail);
    // The new SIM becomes the baseline so the owner isn't alerted repeatedly
    // for the same swap.
    await saveBaseline(current);
    return 'sim_changed';
  }

  return null;
}

/** Run every OS-level check. Safe to call on each foreground. */
export async function runTheftChecks(): Promise<void> {
  const store = usePhantomStore.getState();
  if (!store.isAuthenticated) return;

  await checkSimChange().catch((err) => captureError(err, { scope: 'checkSimChange' }));
}

/**
 * Re-baseline the carrier identity.
 * Called after the owner confirms a SIM change was theirs, so the alert doesn't
 * keep firing for a legitimate swap.
 */
export async function acknowledgeSimChange(): Promise<void> {
  const current = await readCarrier();
  if (hasSim(current)) await saveBaseline(current);
}
