/**
 * In-app subscriptions via RevenueCat.
 *
 * app_user_id is our backend user id, so the RevenueCat webhook can map a
 * purchase back to the right account (see backend/src/routes/billing.ts).
 * Entitlement identifiers in RevenueCat must be `starter` and `pro`.
 */
import { Platform, Linking } from 'react-native';
import Purchases, {
  type PurchasesPackage,
  type CustomerInfo,
  PURCHASES_ERROR_CODE,
} from 'react-native-purchases';
import type { PlanId } from '@phantomshield/shared';

const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '';

const apiKey = () => (Platform.OS === 'ios' ? IOS_KEY : ANDROID_KEY);

export const isPurchasesConfigured = (): boolean => apiKey().length > 0;

let configured = false;

/** Configure once, then switch identity on later sign-ins. */
export async function configurePurchases(userId: string): Promise<boolean> {
  if (!isPurchasesConfigured()) return false;
  try {
    if (!configured) {
      Purchases.configure({ apiKey: apiKey(), appUserID: userId });
      configured = true;
    } else {
      await Purchases.logIn(userId);
    }
    return true;
  } catch {
    return false;
  }
}

/** Forget the signed-in customer (sign-out / account deletion). */
export async function resetPurchases(): Promise<void> {
  if (!configured) return;
  await Purchases.logOut().catch(() => {});
}

/** Highest plan the customer's active entitlements grant. */
export function planFromCustomer(info: CustomerInfo | null | undefined): PlanId {
  const active = Object.keys(info?.entitlements.active ?? {});
  if (active.includes('pro') || active.includes('elite')) return 'pro';
  if (active.includes('starter') || active.includes('guard')) return 'starter';
  return 'free';
}

export interface PlanOffer {
  tier: 'starter' | 'pro';
  title: string;
  /** Localised store price, e.g. "$2.99". */
  price: string;
  /** e.g. "month", "year". */
  period: string;
  pkg: PurchasesPackage;
}

const PERIOD: Record<string, string> = {
  P1W: 'week', P1M: 'month', P3M: '3 months', P6M: '6 months', P1Y: 'year',
};

/** The current offering's packages mapped to our tiers by product/package id. */
export async function getOffers(): Promise<PlanOffer[] | null> {
  if (!configured) return null;
  try {
    const offerings = await Purchases.getOfferings();
    const pkgs = offerings.current?.availablePackages ?? [];
    const out: PlanOffer[] = [];
    for (const pkg of pkgs) {
      const id = `${pkg.identifier} ${pkg.product.identifier}`.toLowerCase();
      const tier = id.includes('pro') ? 'pro' : id.includes('starter') ? 'starter' : null;
      if (!tier || out.some((o) => o.tier === tier)) continue;
      out.push({
        tier,
        title: pkg.product.title,
        price: pkg.product.priceString,
        period: PERIOD[pkg.product.subscriptionPeriod ?? ''] ?? 'month',
        pkg,
      });
    }
    return out;
  } catch {
    return null;
  }
}

export type PurchaseResult =
  | { status: 'ok'; plan: PlanId }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export async function purchase(pkg: PurchasesPackage): Promise<PurchaseResult> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { status: 'ok', plan: planFromCustomer(customerInfo) };
  } catch (err: any) {
    if (err?.userCancelled || err?.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
      return { status: 'cancelled' };
    }
    return { status: 'error', message: err?.message ?? 'The purchase could not be completed.' };
  }
}

/** Restore; resolves to the plan the restored entitlements grant (or null on failure). */
export async function restorePurchases(): Promise<PlanId | null> {
  if (!configured) return null;
  try {
    return planFromCustomer(await Purchases.restorePurchases());
  } catch {
    return null;
  }
}

/** Open the platform's own subscription management screen. */
export async function manageSubscription(): Promise<void> {
  const url =
    Platform.OS === 'ios'
      ? 'https://apps.apple.com/account/subscriptions'
      : 'https://play.google.com/store/account/subscriptions';
  await Linking.openURL(url).catch(() => {});
}
