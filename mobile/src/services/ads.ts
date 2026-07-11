/**
 * Interstitial ads via Google AdMob (react-native-google-mobile-ads).
 *
 * Guard Mode is free and needs no account, so it's monetised with a full-screen
 * interstitial when the user starts and stops it. Like purchases.ts, the native
 * module and ad-unit IDs are optional: this dynamically loads the SDK and no-ops
 * gracefully when it's absent or unconfigured, so the app builds and runs
 * without ads wired up.
 *
 * To enable: `npx expo install react-native-google-mobile-ads`, add the config
 * plugin + app IDs to app.json, set the env vars below, then rebuild.
 */
import { Platform } from 'react-native';

const IOS_UNIT = process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_IOS ?? '';
const ANDROID_UNIT = process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_ANDROID ?? '';

let mod: any = null;
let triedLoad = false;
let initialized = false;

async function load(): Promise<any | null> {
  if (triedLoad) return mod;
  triedLoad = true;
  try {
    // Static specifier — Metro only bundles modules it can resolve statically,
    // so a variable import() would silently exclude the SDK from the JS bundle
    // and ads would never load. The try/catch still degrades gracefully if the
    // native module isn't linked (e.g. Expo Go).
    mod = require('react-native-google-mobile-ads');
  } catch {
    mod = null;
  }
  return mod;
}

function unitId(M: any): string | null {
  const configured = Platform.OS === 'ios' ? IOS_UNIT : ANDROID_UNIT;
  if (configured) return configured;
  // Fall back to Google's test unit in development so ads can be exercised
  // without a real AdMob account.
  if (__DEV__ && M?.TestIds?.INTERSTITIAL) return M.TestIds.INTERSTITIAL;
  return null;
}

/** Optional one-time SDK init. Safe to call repeatedly. */
export async function initAds(): Promise<void> {
  const M = await load();
  if (!M || initialized) return;
  try {
    const mobileAds = M.default ?? M;
    await mobileAds().initialize();
    initialized = true;
  } catch {
    // ignore — ads simply stay disabled
  }
}

/**
 * Show one interstitial and resolve when it's dismissed (or immediately if ads
 * aren't available). Never throws — ad failures must not block Guard Mode.
 */
export async function showInterstitial(): Promise<void> {
  const M = await load();
  if (!M) return;

  const { InterstitialAd, AdEventType } = M;
  const adUnitId = unitId(M);
  if (!InterstitialAd || !AdEventType || !adUnitId) return;

  await initAds();

  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      const ad = InterstitialAd.createForAdRequest(adUnitId, {
        requestNonPersonalizedAdsOnly: true,
      });
      ad.addAdEventListener(AdEventType.LOADED, () => {
        ad.show().catch(done);
      });
      ad.addAdEventListener(AdEventType.CLOSED, done);
      ad.addAdEventListener(AdEventType.ERROR, done);
      ad.load();
      // Never block the flow if the ad is slow or never fills.
      setTimeout(done, 6000);
    } catch {
      done();
    }
  });
}
