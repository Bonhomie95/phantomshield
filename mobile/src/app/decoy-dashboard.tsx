import React, { useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, BackHandler } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { ShieldLogo } from '@/components/ShieldLogo';
import { usePhantomStore } from '@/stores/phantom';

/**
 * Shown when the decoy PIN is entered under duress. It looks like a freshly
 * installed PhantomShield with nothing recorded — believable, and a dead end:
 * no evidence, no settings, no way back into the real app.
 */
export default function DecoyDashboardScreen() {
  useEffect(() => {
    usePhantomStore.getState().setAppUnlocked(false);
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.container}>
      <View style={s.header}>
        <ShieldLogo size={32} />
        <Text style={s.appName}>PhantomShield</Text>
      </View>

      <View style={s.hero}>
        <Ionicons name="shield-half-outline" size={30} color={Colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={s.heroTitle}>Guard Mode</Text>
          <Text style={s.heroSub}>Not set up yet.</Text>
        </View>
      </View>

      <Text style={s.sectionLabel}>RECENT EVENTS</Text>
      <View style={s.card}>
        <Ionicons name="checkmark-done-outline" size={26} color={Colors.success} />
        <Text style={s.emptyText}>Nothing has happened. When something does, it shows up here.</Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll:    { flex: 1, backgroundColor: Colors.bg },
  container: { padding: Spacing.lg, paddingTop: 60, gap: Spacing.md },
  header:    { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: Spacing.sm },
  appName:   { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.primaryGlow, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.primary + '55', padding: Spacing.md,
  },
  heroTitle: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.primary },
  heroSub:   { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  sectionLabel: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1.2, marginTop: Spacing.sm },
  card: {
    alignItems: 'center', gap: 8, backgroundColor: Colors.bgCard, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.bgBorder, paddingVertical: Spacing.lg, paddingHorizontal: Spacing.md,
  },
  emptyText: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
});
