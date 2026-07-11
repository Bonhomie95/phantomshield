import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { router } from 'expo-router';
import { usePhantomStore } from '@/stores/phantom';
import { ShieldLogo } from '@/components/ShieldLogo';
import { ActivityCard } from '@/components/ActivityCard';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';

export default function HomeScreen() {
  const {
    user,
    trackingEnabled,
    setTrackingEnabled,
    recentActivity,
    intruderPhotos,
    unlockedLayers,
  } = usePhantomStore();

  const anomalies = recentActivity.filter((e) => e.isAnomaly);
  const recentThree = recentActivity.slice(0, 3);

  const todayStr = new Date().toDateString();
  const totalTodaySec = recentActivity
    .filter((e) => new Date(e.openedAt).toDateString() === todayStr)
    .reduce((sum, e) => sum + e.durationSec, 0);

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.container}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Header ── */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <ShieldLogo size={32} />
          <View>
            <Text style={s.brand}>PhantomShield</Text>
            <Text style={s.email}>{user?.email ?? 'Your device'}</Text>
          </View>
        </View>
        <View style={[s.planBadge, user?.plan === 'elite' && s.planBadgeElite]}>
          <Text style={[s.planText, user?.plan === 'elite' && { color: Colors.accent }]}>
            {user?.plan?.toUpperCase() ?? 'FREE'}
          </Text>
        </View>
      </View>

      {/* ── Guard Mode — anti-theft alarm (hero action) ── */}
      <TouchableOpacity
        style={s.guardCard}
        activeOpacity={0.85}
        onPress={() => router.push('/guard-mode')}
      >
        <Text style={s.guardIcon}>🛡</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.guardTitle}>Arm Guard Mode</Text>
          <Text style={s.guardSub}>Sound an alarm + snap a photo if anyone moves your phone.</Text>
        </View>
        <Text style={s.guardArrow}>›</Text>
      </TouchableOpacity>

      {/* ── Tracking toggle ── */}
      <View style={[s.card, s.statusCard, trackingEnabled && s.statusCardActive]}>
        <View style={s.statusLeft}>
          <View style={[s.statusDot, { backgroundColor: trackingEnabled ? Colors.success : Colors.textMuted }]} />
          <View>
            <Text style={s.statusTitle}>
              {trackingEnabled ? 'Monitoring Active' : 'Monitoring Paused'}
            </Text>
            <Text style={s.statusSub}>
              {trackingEnabled
                ? 'PhantomShield is watching your activity'
                : 'Enable to start tracking'}
            </Text>
          </View>
        </View>
        <Switch
          value={trackingEnabled}
          onValueChange={setTrackingEnabled}
          trackColor={{ false: Colors.bgBorder, true: Colors.primary + '55' }}
          thumbColor={trackingEnabled ? Colors.primary : Colors.textMuted}
        />
      </View>

      {/* ── Stats ── */}
      <View style={s.statsRow}>
        <View style={s.card}>
          <Text style={s.statValue}>{Math.round(totalTodaySec / 60)}m</Text>
          <Text style={s.statLabel}>Today's Usage</Text>
        </View>
        <View style={[s.card, anomalies.length > 0 && s.statCardAlert]}>
          <Text style={[s.statValue, anomalies.length > 0 && { color: Colors.accent }]}>
            {anomalies.length}
          </Text>
          <Text style={s.statLabel}>Anomalies</Text>
        </View>
        <View style={s.card}>
          <Text style={s.statValue}>{intruderPhotos.length}</Text>
          <Text style={s.statLabel}>Intruder Shots</Text>
        </View>
      </View>

      {/* ── Anomaly alert banner ── */}
      {anomalies.length > 0 && (
        <TouchableOpacity
          onPress={() => router.push('/(tabs)/activity')}
          activeOpacity={0.8}
          style={[s.card, s.alertBanner]}
        >
          <Text style={s.alertIcon}>⚠️</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.alertTitle}>{anomalies.length} anomal{anomalies.length === 1 ? 'y' : 'ies'} detected</Text>
            <Text style={s.alertSub} numberOfLines={1}>{anomalies[0].anomalyReason}</Text>
          </View>
          <Text style={s.alertArrow}>›</Text>
        </TouchableOpacity>
      )}

      {/* ── Recent activity ── */}
      <View style={s.section}>
        <View style={s.sectionHeader}>
          <Text style={s.sectionLabel}>RECENT ACTIVITY</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/activity')}>
            <Text style={s.sectionAction}>View All</Text>
          </TouchableOpacity>
        </View>
        {recentThree.length === 0 ? (
          <View style={[s.card, s.emptyCard]}>
            <Text style={s.emptyText}>No activity recorded yet</Text>
          </View>
        ) : (
          recentThree.map((event) => (
            <ActivityCard key={event.id} event={event} />
          ))
        )}
      </View>

      {/* ── Quick actions ── */}
      <View style={s.section}>
        <Text style={s.sectionLabel}>QUICK ACTIONS</Text>
        <View style={s.quickGrid}>
          {[
            { icon: '📸', label: 'Intruder\nPhotos',    dest: '/(tabs)/vault' },
            { icon: '🔒', label: 'Secure\nVault',       dest: '/(tabs)/vault' },
            { icon: '📊', label: 'Full\nActivity',      dest: '/(tabs)/activity' },
            { icon: '⚙️',  label: 'Settings',           dest: '/(tabs)/settings' },
          ].map((a) => (
            <TouchableOpacity
              key={a.label}
              onPress={() => router.push(a.dest as any)}
              style={s.quickCard}
              activeOpacity={0.7}
            >
              <Text style={s.quickIcon}>{a.icon}</Text>
              <Text style={s.quickLabel}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  container: { padding: Spacing.lg, paddingTop: 60, paddingBottom: 32, gap: Spacing.md },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brand: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  email: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 1 },
  planBadge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryGlow,
    borderWidth: 1, borderColor: Colors.primary + '44',
  },
  planBadgeElite: { backgroundColor: Colors.accentGlow, borderColor: Colors.accent + '44' },
  planText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: Colors.primary },

  // Card base
  card: {
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.bgBorder,
    padding: Spacing.md,
  },

  // Guard Mode hero card
  guardCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.primaryGlow,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.primary + '55',
    padding: Spacing.md,
  },
  guardIcon: { fontSize: 30 },
  guardTitle: { fontSize: FontSize.md, fontWeight: '800', color: Colors.primary },
  guardSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2, lineHeight: 16 },
  guardArrow: { fontSize: 24, color: Colors.primary },

  // Status
  statusCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusCardActive: { borderColor: Colors.primary + '44' },
  statusLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusTitle: { fontSize: FontSize.md, fontWeight: '600', color: Colors.textPrimary },
  statusSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },

  // Stats row
  statsRow: { flexDirection: 'row', gap: 10 },
  statValue: { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.primary, textAlign: 'center' },
  statLabel: { fontSize: 10, color: Colors.textSecondary, textAlign: 'center', marginTop: 3 },
  statCardAlert: { borderColor: Colors.accent + '55' },

  // Alert banner
  alertBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderColor: Colors.accent + '55',
    backgroundColor: Colors.accentGlow,
  },
  alertIcon: { fontSize: 20 },
  alertTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.accent },
  alertSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 1 },
  alertArrow: { fontSize: 22, color: Colors.textMuted },

  // Sections
  section: { gap: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: {
    fontSize: 10, fontWeight: '700', color: Colors.textMuted,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  sectionAction: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  emptyCard: { alignItems: 'center', paddingVertical: Spacing.xl },
  emptyText: { fontSize: FontSize.sm, color: Colors.textMuted },

  // Quick actions
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickCard: {
    width: '47%',
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.bgBorder,
    padding: Spacing.md,
    alignItems: 'center',
    gap: 8,
  },
  quickIcon: { fontSize: 22 },
  quickLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, textAlign: 'center', fontWeight: '500' },
});
