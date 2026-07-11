import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { ShieldLogo } from '@/components/ShieldLogo';

// Fake but PLAUSIBLE dashboard shown when the Decoy PIN is entered under duress.
// An obviously-empty screen tips off a savvy snooper that it's a decoy, so this
// shows believable, benign activity with no real intruder data or vault.
const DECOY_APPS = [
  { icon: '💬', name: 'Messages', mins: 42 },
  { icon: '📷', name: 'Camera', mins: 11 },
  { icon: '🌐', name: 'Browser', mins: 68 },
  { icon: '🎵', name: 'Music', mins: 25 },
  { icon: '🗺️', name: 'Maps', mins: 9 },
];

export default function DecoyDashboardScreen() {
  // Small daily jitter so the numbers look live, not hard-coded.
  const jitter = useMemo(() => new Date().getDate() % 7, []);

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.container}>
      <View style={s.header}>
        <ShieldLogo size={32} />
        <Text style={s.appName}>PhantomShield</Text>
      </View>

      <View style={s.statusCard}>
        <View style={[s.dot, { backgroundColor: Colors.success }]} />
        <View>
          <Text style={s.statusTitle}>Monitoring Active</Text>
          <Text style={s.statusSub}>Everything looks normal today.</Text>
        </View>
      </View>

      <View style={s.statsRow}>
        <Stat value={`${3 + jitter}h`} label="Screen Time" />
        <Stat value={`${38 + jitter * 3}`} label="Unlocks" />
        <Stat value="0" label="Anomalies" />
      </View>

      <Text style={s.sectionLabel}>TODAY'S ACTIVITY</Text>
      {DECOY_APPS.map((a) => (
        <View key={a.name} style={s.appRow}>
          <Text style={s.appIcon}>{a.icon}</Text>
          <Text style={s.appName2}>{a.name}</Text>
          <Text style={s.appMins}>{a.mins + jitter}m</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={s.statCard}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  scroll:    { flex: 1, backgroundColor: Colors.bg },
  container: { padding: Spacing.lg, paddingTop: 60, gap: Spacing.md },
  header:    { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: Spacing.sm },
  appName:   { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  statusCard:{
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.bgCard, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.bgBorder,
  },
  dot:       { width: 10, height: 10, borderRadius: 5 },
  statusTitle:{ fontSize: FontSize.md, fontWeight: '600', color: Colors.textPrimary },
  statusSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  statsRow:  { flexDirection: 'row', gap: 8 },
  statCard:  {
    flex: 1, backgroundColor: Colors.bgCard, borderRadius: Radius.md,
    padding: Spacing.sm, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.bgBorder,
  },
  statValue: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary },
  statLabel: { fontSize: 10, color: Colors.textSecondary, marginTop: 2 },
  sectionLabel: {
    fontSize: 10, fontWeight: '700', color: Colors.textMuted,
    letterSpacing: 1.2, marginTop: Spacing.sm,
  },
  appRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.bgCard, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.bgBorder,
  },
  appIcon:  { fontSize: 20 },
  appName2: { flex: 1, fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: '500' },
  appMins:  { fontSize: FontSize.sm, color: Colors.textSecondary },
});
