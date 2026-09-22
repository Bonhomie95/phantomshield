/**
 * Ending a session on this phone (sign-out, account deletion, or erasing a
 * phone that was used without an account).
 *
 * Everything PhantomShield keeps on the device goes with it: tokens, PINs,
 * intruder photos, logs, the photo key, and the background location task.
 * Leaving any of it behind would hand the next person to use this phone the
 * previous owner's evidence — or keep tracking a phone whose account no
 * longer exists.
 */
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { usePhantomStore } from '@/stores/phantom';
import { clearTokens } from '@/services/api';
import { clearAllIntruderPhotos } from '@/services/camera';
import { stopLocationTracking } from '@/services/locationTracking';
import { resetPurchases } from '@/services/purchases';
import { resetAnalyticsIdentity } from '@/services/analytics';
import { forgetPhotoKey } from '@/services/e2e';
import * as pinVault from '@/services/pinVault';

export async function wipeLocalSession(): Promise<void> {
  // Flip consent off FIRST so a location batch arriving mid-teardown is dropped.
  usePhantomStore.setState({ locationTrackingEnabled: false });

  await Promise.all([
    stopLocationTracking().catch(() => {}),
    clearAllIntruderPhotos().catch(() => {}),
    pinVault.clearAllPins().catch(() => {}),
    forgetPhotoKey().catch(() => {}),
    clearTokens().catch(() => {}),
    resetPurchases(),
    GoogleSignin.signOut().catch(() => {}),
  ]);
  resetAnalyticsIdentity();

  usePhantomStore.setState({
    user: null,
    isAuthenticated: false,
    onboarded: false,
    isAppUnlocked: false,
    guardArmed: false,
    photoQuotaReached: false,
    unlockEvents: [],
    intruderPhotos: [],
    guardEvents: [],
    decoyPinSet: false,
    locationEnabled: false,
    backgroundGuardEnabled: false,
    intruderSnapshotEnabled: false,
    lostMode: null,
    e2eEnabled: false,
  });
}
