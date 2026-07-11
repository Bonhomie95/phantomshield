import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { usePhantomStore } from '@/stores/phantom';
import { getOffers, purchase, restorePurchases, isPurchasesConfigured, PlanOffer } from '@/services/purchases';
import { track } from '@/services/analytics';

// Fallback display prices, shown when RevenueCat offerings aren't available
// (keys unset, store not reachable, first launch). KEEP IN SYNC with the
// actual product prices configured in App Store Connect / Play Console —
// the store sheet at purchase time always shows the real charge.
const TIERS = [
  {
    id: 'guard',
    name: 'Phantom Guard',
    tagline: 'For everyday protection',
    fallbackPrice: '$4.99 / month',
    highlight: false,
    features: [
      'Guard Mode anti-theft alarm',
      'Intruder snapshots + location',
      '30-day activity history',
      'Remote lock & wipe from the web',
      'Up to 2 devices',
    ],
  },
  {
    id: 'elite',
    name: 'Phantom Elite',
    tagline: 'Maximum security',
    fallbackPrice: '$9.99 / month',
    highlight: true,
    features: [
      'Everything in Guard',
      'Unlimited intruder snapshots',
      'Unlimited safe zones',
      '90-day history + export',
      'Up to 5 devices',
    ],
  },
];

export default function PaywallScreen() {
  const { user, setUser } = usePhantomStore();
  const [offers, setOffers] = useState<PlanOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    track('paywall_viewed');
    getOffers().then((o) => setOffers(o)).finally(() => setLoading(false));
  }, []);

  // Live store price when RevenueCat has offerings; fallback list price otherwise.
  const priceFor = (tier: (typeof TIERS)[number]) => {
    const live = offers.find((o) => o.id.toLowerCase().includes(tier.id))?.price;
    return live ? `${live} / month` : tier.fallbackPrice;
  };

  const handlePurchase = async (tierId: string) => {
    const offer = offers.find((o) => o.id.toLowerCase().includes(tierId));
    if (!isPurchasesConfigured() || !offer) {
      Alert.alert('Coming soon', 'In-app purchases aren’t available yet on this build.');
      return;
    }
    setBusy(tierId);
    track('purchase_started', { tier: tierId });
    const ok = await purchase(offer.pkg);
    setBusy(null);
    if (ok) {
      track('purchase_completed', { tier: tierId });
      if (user) setUser({ ...user, plan: tierId as typeof user.plan });
      Alert.alert('You’re upgraded!', 'Your new plan is active.');
      router.back();
    } else {
      Alert.alert('Purchase not completed', 'No charge was made. Please try again.');
    }
  };

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
      <TouchableOpacity style={s.close} onPress={() => router.back()}>
        <Text style={s.closeText}>✕</Text>
      </TouchableOpacity>

      <Text style={s.title}>Protect your phone like a pro</Text>
      <Text style={s.subtitle}>Unlock Guard Mode, intruder evidence, and remote control.</Text>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
      ) : (
        TIERS.map((tier) => (
          <View key={tier.id} style={[s.card, tier.highlight && s.cardHighlight]}>
            {tier.highlight && <View style={s.badge}><Text style={s.badgeText}>MOST POPULAR</Text></View>}
            <Text style={s.tierName}>{tier.name}</Text>
            <Text style={s.tierTag}>{tier.tagline}</Text>
            <Text style={s.price}>{priceFor(tier)}</Text>
            <View style={s.features}>
              {tier.features.map((f) => (
                <View key={f} style={s.featureRow}>
                  <Text style={s.check}>✓</Text>
                  <Text style={s.featureText}>{f}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity
              style={[s.cta, tier.highlight && s.ctaHighlight]}
              onPress={() => handlePurchase(tier.id)}
              disabled={busy !== null}
              activeOpacity={0.85}
            >
              {busy === tier.id
                ? <ActivityIndicator color={Colors.bg} />
                : <Text style={[s.ctaText, !tier.highlight && s.ctaTextAlt]}>Choose {tier.name}</Text>}
            </TouchableOpacity>
          </View>
        ))
      )}

      <TouchableOpacity onPress={async () => { if (await restorePurchases()) router.back(); }} style={s.restore}>
        <Text style={s.restoreText}>Restore purchases</Text>
      </TouchableOpacity>

      <Text style={s.legal}>
        Payment is charged to your app store account. Subscriptions renew unless cancelled at least 24h before the period ends.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  container: { padding: Spacing.lg, paddingTop: 60, paddingBottom: 40, gap: Spacing.md },
  close: { position: 'absolute', top: 52, right: 20, zIndex: 2 },
  closeText: { fontSize: 22, color: Colors.textSecondary },
  title: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginBottom: Spacing.md },
  card: { backgroundColor: Colors.bgCard, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.bgBorder, padding: Spacing.lg, gap: 6 },
  cardHighlight: { borderColor: Colors.primary, backgroundColor: Colors.primaryGlow },
  badge: { alignSelf: 'flex-start', backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 4 },
  badgeText: { fontSize: 9, fontWeight: '800', color: Colors.bg, letterSpacing: 1 },
  tierName: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.textPrimary },
  tierTag: { fontSize: FontSize.xs, color: Colors.textSecondary },
  price: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.primary, marginTop: 4 },
  features: { gap: 8, marginVertical: Spacing.md },
  featureRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  check: { color: Colors.success, fontWeight: '800', fontSize: FontSize.sm },
  featureText: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary },
  cta: { backgroundColor: Colors.bgElevated, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: Colors.primary + '55' },
  ctaHighlight: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  ctaText: { fontSize: FontSize.md, fontWeight: '800', color: Colors.bg },
  ctaTextAlt: { color: Colors.primary },
  restore: { alignItems: 'center', paddingVertical: Spacing.md },
  restoreText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  legal: { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center', lineHeight: 16 },
});
