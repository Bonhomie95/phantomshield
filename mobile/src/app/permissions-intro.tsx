import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { ShieldLogo } from '@/components/ShieldLogo';
import { requestNotificationPermissions } from '@/services/notifications';

// Explain WHY each permission is needed before the OS prompt fires — cold
// prompts get denied, and denials for a security app are hard to recover from.
const ITEMS = [
  {
    icon: '📸',
    title: 'Camera',
    desc: 'Silently captures a photo of whoever enters a wrong PIN or triggers Guard Mode. Asked only the first time it is needed.',
  },
  {
    icon: '📍',
    title: 'Location',
    desc: 'Tags intruder and anti-theft events with where your phone was. Only recorded during an actual event, and only if you enable it.',
  },
  {
    icon: '🔔',
    title: 'Notifications',
    desc: 'Alerts you the moment an intruder is detected or a remote command runs. We never send marketing.',
  },
];

export default function PermissionsIntroScreen() {
  const [busy, setBusy] = useState(false);

  const finish = () => router.replace('/setup-pins');

  const handleContinue = async () => {
    if (busy) return;
    setBusy(true);
    // Only notifications are requested up front; camera & location are requested
    // lazily at the exact moment a feature uses them, with this context already seen.
    await requestNotificationPermissions().catch(() => {});
    finish();
  };

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
      <View style={s.hero}>
        <ShieldLogo size={56} />
        <Text style={s.title}>A few permissions</Text>
        <Text style={s.sub}>
          PhantomShield only uses these to protect your device. You are always in control and can
          change them anytime in Settings.
        </Text>
      </View>

      <View style={s.list}>
        {ITEMS.map((it) => (
          <View key={it.title} style={s.card}>
            <Text style={s.cardIcon}>{it.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{it.title}</Text>
              <Text style={s.cardDesc}>{it.desc}</Text>
            </View>
          </View>
        ))}
      </View>

      <TouchableOpacity style={[s.btn, busy && s.btnDisabled]} onPress={handleContinue} disabled={busy} activeOpacity={0.85}>
        {busy ? <ActivityIndicator color={Colors.bg} /> : <Text style={s.btnText}>Enable & Continue</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={finish} style={s.skip} disabled={busy}>
        <Text style={s.skipText}>Set up later</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  container: { padding: Spacing.lg, paddingTop: 72, paddingBottom: 40, gap: Spacing.lg },
  hero: { alignItems: 'center', gap: Spacing.sm },
  title: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.textPrimary, marginTop: Spacing.sm },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  list: { gap: Spacing.md },
  card: {
    flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start',
    backgroundColor: Colors.bgCard, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.bgBorder, padding: Spacing.md,
  },
  cardIcon: { fontSize: 24, marginTop: 2 },
  cardTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary },
  cardDesc: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 4, lineHeight: 19 },
  btn: { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 16, alignItems: 'center' },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontSize: FontSize.md, fontWeight: '800', color: Colors.bg },
  skip: { alignItems: 'center', paddingVertical: Spacing.sm },
  skipText: { fontSize: FontSize.sm, color: Colors.textSecondary },
});
