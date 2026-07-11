/**
 * In-app purchases via RevenueCat.
 *
 * The native module (react-native-purchases) and API keys are optional: this
 * loads the SDK dynamically and no-ops gracefully when it's absent or keys
 * aren't set, so the app builds and runs without billing configured. Set
 * EXPO_PUBLIC_REVENUECAT_IOS_KEY / _ANDROID_KEY and add the package to enable it.
 *
 * app_user_id is set to our backend user id so the RevenueCat webhook can map
 * a purchase back to the right account (see backend/src/routes/billing.ts).
 */
import { Platform } from 'react-native';

const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '';

function apiKey(): string {
  return Platform.OS === 'ios' ? IOS_KEY : ANDROID_KEY;
}

export function isPurchasesConfigured(): boolean {
  return apiKey().length > 0;
}

let mod: any = null;
let configured = false;

async function load(): Promise<any | null> {
  if (!isPurchasesConfigured()) return null;
  if (!mod) {
    try {
      // Non-literal specifier keeps TS from requiring the module at build time.
      const spec = 'react-native-purchases';
      const imported = await import(spec);
      mod = imported.default ?? imported;
    } catch {
      return null;
    }
  }
  return mod;
}

export async function configurePurchases(userId: string): Promise<boolean> {
  const P = await load();
  if (!P) return false;
  try {
    if (!configured) {
      P.configure({ apiKey: apiKey(), appUserID: userId });
      configured = true;
    } else {
      await P.logIn(userId);
    }
    return true;
  } catch {
    return false;
  }
}

export interface PlanOffer {
  id: string;
  title: string;
  price: string;
  pkg: unknown;
}

export async function getOffers(): Promise<PlanOffer[]> {
  const P = await load();
  if (!P) return [];
  try {
    const offerings = await P.getOfferings();
    const pkgs = offerings?.current?.availablePackages ?? [];
    return pkgs.map((pkg: any) => ({
      id: pkg.identifier,
      title: pkg.product?.title ?? pkg.identifier,
      price: pkg.product?.priceString ?? '',
      pkg,
    }));
  } catch {
    return [];
  }
}

export async function purchase(pkg: unknown): Promise<boolean> {
  const P = await load();
  if (!P) return false;
  try {
    await P.purchasePackage(pkg);
    return true;
  } catch {
    return false;
  }
}

export async function restorePurchases(): Promise<boolean> {
  const P = await load();
  if (!P) return false;
  try {
    await P.restorePurchases();
    return true;
  } catch {
    return false;
  }
}
