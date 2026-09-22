import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Platform, Image } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePhantomStore } from '@/stores/phantom';
import { ShieldLogo } from '@/components/ShieldLogo';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { GuardMode } from '@/constants/types';
import { armHref } from '@/services/shortcuts';
import { isPocketModeAvailable, GUARD_MODE_SUMMARY } from '@/services/guard';
import { listGuardians } from '@/services/api';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const MODE_ICON: Record<GuardMode, IconName> = {
  table: 'phone-portrait-outline',
  charger: 'flash-outline',
  pocket: 'walk-outline',
};

export default function HomeScreen() {
  const {
    user,
    isAuthenticated,
    intruderSnapshotEnabled,
    locationTrackingEnabled,
    e2eEnabled,
    intruderPhotos,
    guardEvents,
  } = usePhantomStore();
  const [pocket, setPocket] = useState(false);
  const [guardianCount, setGuardianCount] = useState<number | null>(null);

  useEffect(() => { void isPocketModeAvailable().then(setPocket); }, []);

  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated) return;
      void listGuardians().then((r) => r && setGuardianCount(r.guardians.length));
    }, [isAuthenticated]),
  );

  const modes: GuardMode[] = pocket ? ['table', 'charger', 'pocket'] : ['table', 'charger'];

  const checks: { key: string; label: string; on: boolean; detail: string; icon: IconName; go: () => void }[] = [
    {
      key: 'account',
      label: 'Cloud backup',
      on: isAuthenticated,
      detail: isAuthenticated ? 'Evidence reaches your account' : 'Sign in so evidence survives a stolen phone',
      icon: 'cloud-upload-outline',
      go: () => (isAuthenticated ? router.push('/(tabs)/settings') : router.push('/(auth)/welcome')),
    },
    {
      key: 'photos',
      label: 'Intruder photos',
      on: intruderSnapshotEnabled,
      detail: intruderSnapshotEnabled ? 'Photo on a wrong PIN or Guard Mode trigger' : 'Off',
      icon: 'camera-outline',
      go: () => router.push('/(tabs)/settings'),
    },
    {
      key: 'find',
      label: 'Find My Phone',
      on: isAuthenticated && locationTrackingEnabled,
      detail: locationTrackingEnabled ? 'Location trail on the web dashboard' : 'Off',
      icon: 'navigate-outline',
      go: () => router.push('/(tabs)/settings'),
    },
    {
      key: 'guardians',
      label: 'Guardians',
      on: isAuthenticated && (guardianCount ?? 0) > 0,
      detail:
        guardianCount && isAuthenticated
          ? `${guardianCount} ${guardianCount === 1 ? 'person' : 'people'} alerted if it's stolen`
          : 'Someone who gets a live location link if it’s stolen',
      icon: 'people-outline',
      go: () => router.push('/guardians'),
    },
    {
      key: 'e2e',
      label: 'Private photo backup',
      on: isAuthenticated && e2eEnabled,
      detail: e2eEnabled ? 'End-to-end encrypted' : 'Encrypt photos so only you can see them',
      icon: 'key-outline',
      go: () => router.push('/encryption'),
    },
  ];
  const onCount = checks.filter((c) => c.on).length;

  const recent = [...intruderPhotos.map((p) => ({ id: p.id, at: p.timestamp, text: p.anomalyReason ?? 'Intruder photo', uri: p.imageUri as string | undefined })),
    ...guardEvents.filter((g) => !g.imageUri).map((g) => ({ id: g.id, at: g.timestamp, text: g.reason, uri: undefined }))]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 3);

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
      {/* ── Header ── */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <ShieldLogo size={32} />
          <View>
            <Text style={s.brand}>PhantomShield</Text>
            <Text style={s.email} numberOfLines={1}>{isAuthenticated ? user?.email ?? 'Signed in' : 'On this phone only'}</Text>
          </View>
        </View>
        {isAuthenticated && (
          <View style={[s.planBadge, user?.plan === 'pro' && s.planBadgePro]}>
            <Text style={[s.planText, user?.plan === 'pro' && { color: Colors.accent }]}>
              {user?.plan?.toUpperCase() ?? 'FREE'}
            </Text>
          </View>
        )}
      </View>

      {/* ── Guard Mode (hero) ── */}
      <View style={s.hero}>
        <TouchableOpacity
          style={s.heroTop}
          activeOpacity={0.85}
          onPress={() => router.push('/guard-mode')}
          accessibilityRole="button"
          accessibilityLabel="Open Guard Mode"
        >
          <View style={s.heroIcon}>
            <Ionicons name="shield-half-outline" size={30} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.heroTitle}>Guard Mode</Text>
            <Text style={s.heroSub}>Leaving your phone for a moment? Arm it — you’ll know if anyone touches it.</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Colors.primary} />
        </TouchableOpacity>
        <View style={s.modeRow}>
          {modes.map((m) => (
            <TouchableOpacity
              key={m}
              style={s.modeChip}
              activeOpacity={0.8}
              onPress={() => router.push(armHref(m) as never)}
              accessibilityRole="button"
              accessibilityLabel={`Arm now: ${GUARD_MODE_SUMMARY[m].title}`}
            >
              <Ionicons name={MODE_ICON[m]} size={18} color={Colors.textPrimary} />
              <Text style={s.modeText} numberOfLines={1}>{GUARD_MODE_SUMMARY[m].title}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── Protection checklist ── */}
      <View style={s.section}>
        <View style={s.sectionHeader}>
          <Text style={s.sectionLabel}>YOUR PROTECTION</Text>
          <Text style={s.score}>{onCount} of {checks.length} on</Text>
        </View>
        <View style={s.card}>
          {checks.map((c, i) => (
            <TouchableOpacity
              key={c.key}
              style={[s.checkRow, i > 0 && s.checkDivider]}
              onPress={c.go}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${c.label}: ${c.on ? 'on' : 'off'}. ${c.detail}`}
            >
              <Ionicons name={c.icon} size={20} color={c.on ? Colors.success : Colors.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={s.checkLabel}>{c.label}</Text>
                <Text style={s.checkDetail} numberOfLines={2}>{c.detail}</Text>
              </View>
              <Ionicons
                name={c.on ? 'checkmark-circle' : 'add-circle-outline'}
                size={22}
                color={c.on ? Colors.success : Colors.primary}
              />
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── Recent evidence ── */}
      <View style={s.section}>
        <View style={s.sectionHeader}>
          <Text style={s.sectionLabel}>RECENT EVENTS</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/vault')} accessibilityRole="button">
            <Text style={s.sectionAction}>See all</Text>
          </TouchableOpacity>
        </View>
        {recent.length === 0 ? (
          <View style={[s.card, s.emptyCard]}>
            <Ionicons name="checkmark-done-outline" size={26} color={Colors.success} />
            <Text style={s.emptyText}>Nothing has happened. When something does, it shows up here.</Text>
          </View>
        ) : (
          <View style={s.card}>
            {recent.map((r, i) => (
              <View key={r.id} style={[s.eventRow, i > 0 && s.checkDivider]}>
                {r.uri ? (
                  <Image source={{ uri: r.uri }} style={s.eventThumb} />
                ) : (
                  <View style={[s.eventThumb, s.eventThumbEmpty]}>
                    <Ionicons name="alert-circle-outline" size={20} color={Colors.accent} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={s.checkLabel} numberOfLines={1}>{r.text}</Text>
                  <Text style={s.checkDetail}>{new Date(r.at).toLocaleString()}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* ── Arm from anywhere ── */}
      <View style={[s.card, s.tip]}>
        <Ionicons name="flash-outline" size={18} color={Colors.primary} />
        <Text style={s.tipText}>
          {Platform.OS === 'ios'
            ? 'Arm in one step: long-press the PhantomShield icon, say “Arm PhantomShield” to Siri, or add it to the Action Button in Settings.'
            : 'Arm in one step: long-press the PhantomShield icon on your home screen.'}
        </Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  container: { padding: Spacing.lg, paddingTop: 60, paddingBottom: 32, gap: Spacing.md },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  brand: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  email: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 1 },
  planBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full,
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: Colors.primary + '44',
  },
  planBadgePro: { backgroundColor: Colors.accentGlow, borderColor: Colors.accent + '44' },
  planText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: Colors.primary },

  card: {
    backgroundColor: Colors.bgCard, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.bgBorder, padding: Spacing.md,
  },

  hero: {
    backgroundColor: Colors.primaryGlow, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.primary + '55', padding: Spacing.md, gap: Spacing.md,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroIcon: {
    width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.primary + '55',
  },
  heroTitle: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.primary },
  heroSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2, lineHeight: 17 },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeChip: {
    flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.bgCard, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.bgBorder,
    paddingHorizontal: 8, paddingVertical: 10,
  },
  modeText: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textPrimary, flexShrink: 1 },

  section: { gap: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1.2 },
  sectionAction: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  score: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '600' },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 48 },
  checkDivider: { borderTopWidth: 1, borderTopColor: Colors.bgBorder },
  checkLabel: { fontSize: FontSize.md, fontWeight: '600', color: Colors.textPrimary },
  checkDetail: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },

  emptyCard: { alignItems: 'center', gap: 8, paddingVertical: Spacing.lg },
  emptyText: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  eventThumb: { width: 44, height: 44, borderRadius: Radius.sm, backgroundColor: Colors.bgBorder },
  eventThumbEmpty: { alignItems: 'center', justifyContent: 'center' },

  tip: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  tipText: { flex: 1, fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 18 },
});
