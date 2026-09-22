import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { openFromModal } from '@/services/navigation';
import * as WebBrowser from 'expo-web-browser';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { usePhantomStore } from '@/stores/phantom';
import {
  getOffers, purchase, restorePurchases, manageSubscription, isPurchasesConfigured, PlanOffer,
} from '@/services/purchases';
import { fetchCurrentPlan } from '@/services/api';
import { track } from '@/services/analytics';
import { LEGAL } from '@/constants/config';

const TIERS: { id: 'starter' | 'pro'; name: string; tagline: string; highlight: boolean; features: string[] }[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'Full evidence and remote control',
    highlight: false,
    features: [
      '50 intruder photos backed up each month',
      '30 days of history',
      'Remote lock, alarm and locate from the web',
      'PDF evidence report for insurance or police',
      'Up to 5 guardians',
      'Up to 3 phones',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Everything, for every phone you own',
    highlight: true,
    features: [
      'Everything in Starter',
      'Unlimited intruder photo backup',
      'A full year of history',
      'Up to 10 phones',
    ],
  },
];

// Shown above the tiers so the free plan never reads as "unprotected".
const FREE_INCLUDES = [
  'Guard Mode, pocket and charger alarms, intruder photos',
  'Find My Phone, lost mode and 1 guardian',
  '5 photos backed up to your account each month',
  '7 days of history · 1 phone',
];

export default function PaywallScreen() {
  const { user, setUser } = usePhantomStore();
  const [offers, setOffers] = useState<PlanOffer[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const { source } = useLocalSearchParams<{ source?: string }>();
  const isPaid = user?.plan === 'starter' || user?.plan === 'pro';

  const load = useCallback(async () => {
    setLoading(true);
    setOffers(await getOffers());
    setLoading(false);
  }, []);

  useEffect(() => {
    track('paywall_viewed', { source: source ?? 'unknown' });
    void load();
  }, [load, source]);

  const applyPlan = async (fallback: 'free' | 'starter' | 'pro') => {
    // The server is the source of truth (webhook); fall back to what the store
    // just told us if the webhook hasn't landed yet.
    const server = await fetchCurrentPlan();
    const plan = server && server.plan !== 'free' ? server.plan : fallback;
    const cur = usePhantomStore.getState().user;
    if (cur) setUser({ ...cur, plan });
  };

  // Plans live on an account (they cover cloud backup and the web dashboard),
  // so a phone used without one signs in first.
  const needsAccount = () => {
    if (usePhantomStore.getState().isAuthenticated) return false;
    Alert.alert('Sign in first', 'Plans are attached to your PhantomShield account, so they work on every phone you sign in on.', [
      { text: 'Not now', style: 'cancel' },
      { text: 'Sign in', onPress: () => openFromModal('/(auth)/welcome') },
    ]);
    return true;
  };

  const handlePurchase = async (offer: PlanOffer) => {
    if (needsAccount()) return;
    setBusy(offer.tier);
    track('purchase_started', { tier: offer.tier, source: source ?? 'unknown' });
    const result = await purchase(offer.pkg);
    setBusy(null);
    if (result.status === 'ok') {
      track('purchase_completed', { tier: offer.tier });
      await applyPlan(result.plan);
      Alert.alert('You’re upgraded', 'Your new plan is active on this account.');
      router.back();
    } else if (result.status === 'error') {
      track('purchase_failed', { tier: offer.tier, source: source ?? 'unknown' });
      Alert.alert('Purchase not completed', `${result.message}\n\nYou have not been charged.`);
    }
  };

  const handleRestore = async () => {
    if (needsAccount()) return;
    setBusy('restore');
    const plan = await restorePurchases();
    setBusy(null);
    if (plan === null) {
      Alert.alert('Couldn’t restore', 'Check your connection and try again.');
    } else if (plan === 'free') {
      Alert.alert('Nothing to restore', 'No active subscription was found for your store account.');
    } else {
      await applyPlan(plan);
      Alert.alert('Purchases restored', 'Your subscription is active on this account.');
      router.back();
    }
  };

  const offerFor = (tier: 'starter' | 'pro') => offers?.find((o) => o.tier === tier);
  const storeReady = !!offers && offers.length > 0;

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
      <TouchableOpacity
        style={s.close}
        onPress={() => {
          track('paywall_dismissed', { source: source ?? 'unknown' });
          router.back();
        }}
        accessibilityRole="button"
        accessibilityLabel="Close"
        hitSlop={12}
      >
        <Text style={s.closeText}>✕</Text>
      </TouchableOpacity>

      <Text style={s.title} accessibilityRole="header">
        {isPaid ? 'Your plan' : 'Get more protection'}
      </Text>
      <Text style={s.subtitle}>
        {isPaid
          ? `You’re on ${user?.plan === 'pro' ? 'Pro' : 'Starter'}. Change or cancel it anytime in your store account.`
          : 'More evidence, longer history, and remote control when it matters.'}
      </Text>

      <View style={s.freeCard}>
        <Text style={s.freeTitle}>Always free</Text>
        {FREE_INCLUDES.map((f) => (
          <View key={f} style={s.featureRow}>
            <Text style={s.check}>✓</Text>
            <Text style={s.featureText}>{f}</Text>
          </View>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
      ) : (
        <>
          {!storeReady && (
            <View style={s.unavailable}>
              <Text style={s.unavailableText}>
                {isPurchasesConfigured()
                  ? 'Plans couldn’t be loaded from the store. Check your connection and try again.'
                  : 'Subscriptions aren’t available in this version of the app.'}
              </Text>
              {isPurchasesConfigured() && (
                <TouchableOpacity style={s.retry} onPress={load} accessibilityRole="button">
                  <Text style={s.retryText}>Try again</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {TIERS.map((tier) => {
            const offer = offerFor(tier.id);
            const current = user?.plan === tier.id;
            return (
              <View key={tier.id} style={[s.card, tier.highlight && s.cardHighlight]}>
                {tier.highlight && <View style={s.badge}><Text style={s.badgeText}>MOST POPULAR</Text></View>}
                <Text style={s.tierName}>{tier.name}</Text>
                <Text style={s.tierTag}>{tier.tagline}</Text>
                {offer && (
                  <Text style={s.price}>
                    {offer.price} <Text style={s.per}>/ {offer.period}</Text>
                  </Text>
                )}
                <View style={s.features}>
                  {tier.features.map((f) => (
                    <View key={f} style={s.featureRow}>
                      <Text style={s.check}>✓</Text>
                      <Text style={s.featureText}>{f}</Text>
                    </View>
                  ))}
                </View>
                {current ? (
                  <View style={[s.cta, s.ctaCurrent]}>
                    <Text style={s.ctaTextAlt}>Current plan</Text>
                  </View>
                ) : offer ? (
                  <TouchableOpacity
                    style={[s.cta, tier.highlight && s.ctaHighlight, busy !== null && s.ctaDisabled]}
                    onPress={() => handlePurchase(offer)}
                    disabled={busy !== null}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={`Subscribe to ${tier.name} for ${offer.price} per ${offer.period}`}
                  >
                    {busy === tier.id
                      ? <ActivityIndicator color={tier.highlight ? Colors.bg : Colors.primary} />
                      : <Text style={[s.ctaText, !tier.highlight && s.ctaTextAlt]}>Subscribe to {tier.name}</Text>}
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
        </>
      )}

      <View style={s.links}>
        <TouchableOpacity onPress={handleRestore} disabled={busy !== null} accessibilityRole="button" style={s.linkBtn}>
          {busy === 'restore'
            ? <ActivityIndicator color={Colors.textSecondary} />
            : <Text style={s.restoreText}>Restore purchases</Text>}
        </TouchableOpacity>
        {isPaid && (
          <TouchableOpacity onPress={manageSubscription} accessibilityRole="button" style={s.linkBtn}>
            <Text style={s.restoreText}>Manage subscription</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={s.legal}>
        Subscriptions renew automatically at the price shown for each period until cancelled.
        Payment is charged to your {`App Store or Google Play`} account at confirmation. Cancel at
        least 24 hours before the end of the current period to avoid renewal; manage or cancel
        anytime in your store account settings.
      </Text>

      {/* App Store Guideline 3.1.2 requires Terms (EULA) and Privacy links on the purchase screen. */}
      <View style={s.legalLinks}>
        <TouchableOpacity onPress={() => WebBrowser.openBrowserAsync(LEGAL.terms)} accessibilityRole="link">
          <Text style={s.legalLink}>Terms of Use (EULA)</Text>
        </TouchableOpacity>
        <Text style={s.legalSep}>·</Text>
        <TouchableOpacity onPress={() => WebBrowser.openBrowserAsync(LEGAL.privacy)} accessibilityRole="link">
          <Text style={s.legalLink}>Privacy Policy</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  container: { padding: Spacing.lg, paddingTop: 60, paddingBottom: 40, gap: Spacing.md },
  close: { position: 'absolute', top: 52, right: 20, zIndex: 2, padding: 4 },
  closeText: { fontSize: 22, color: Colors.textSecondary },
  title: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center', paddingHorizontal: 32 },
  subtitle: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginBottom: Spacing.md },
  freeCard: {
    backgroundColor: Colors.bgCard, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.bgBorder, padding: Spacing.md, gap: 6, marginBottom: Spacing.sm,
  },
  freeTitle: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.textSecondary, marginBottom: 2 },
  unavailable: { backgroundColor: Colors.bgCard, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.bgBorder, padding: Spacing.md, gap: Spacing.sm, alignItems: 'center' },
  unavailableText: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center' },
  retry: { paddingVertical: 8, paddingHorizontal: 20, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.primary + '55' },
  retryText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  card: { backgroundColor: Colors.bgCard, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.bgBorder, padding: Spacing.lg, gap: 6 },
  cardHighlight: { borderColor: Colors.primary, backgroundColor: Colors.primaryGlow },
  badge: { alignSelf: 'flex-start', backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 4 },
  badgeText: { fontSize: 10, fontWeight: '800', color: Colors.bg, letterSpacing: 1 },
  tierName: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.textPrimary },
  tierTag: { fontSize: FontSize.xs, color: Colors.textSecondary },
  price: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.primary, marginTop: 4 },
  per: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  features: { gap: 8, marginVertical: Spacing.md },
  featureRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  check: { color: Colors.success, fontWeight: '800', fontSize: FontSize.sm },
  featureText: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary },
  cta: { backgroundColor: Colors.bgElevated, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: Colors.primary + '55', minHeight: 48, justifyContent: 'center' },
  ctaHighlight: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  ctaCurrent: { borderColor: Colors.success + '66' },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { fontSize: FontSize.md, fontWeight: '800', color: Colors.bg },
  ctaTextAlt: { fontSize: FontSize.md, fontWeight: '800', color: Colors.primary },
  links: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.lg },
  linkBtn: { paddingVertical: Spacing.md, minHeight: 44, justifyContent: 'center' },
  restoreText: { fontSize: FontSize.sm, color: Colors.textSecondary, textDecorationLine: 'underline' },
  legal: { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center', lineHeight: 16 },
  legalLinks: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, paddingTop: 4 },
  legalLink: { fontSize: FontSize.xs, color: Colors.textSecondary, textDecorationLine: 'underline', paddingVertical: 8 },
  legalSep: { fontSize: FontSize.xs, color: Colors.textMuted },
});
