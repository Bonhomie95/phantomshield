import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Switch } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Camera } from 'expo-camera';
import { track } from '@/services/analytics';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { ShieldLogo } from '@/components/ShieldLogo';
import { requestNotificationPermissions } from '@/services/notifications';
import { usePhantomStore } from '@/stores/phantom';
import { allowFirstRunSetup } from '@/services/pinVault';

// Explain WHY each permission is needed before the OS prompt fires — cold
// prompts get denied, and denials for a security app are hard to recover from.
// Each item is a real choice the user makes here, not just a description.
export default function PermissionsIntroScreen() {
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState(true);
  const [alerts, setAlerts] = useState(true);

  useEffect(() => {
    void track('permissions_intro_shown');
  }, []);

  const finish = () => {
    allowFirstRunSetup();
    router.replace('/setup-pins');
  };

  const handleContinue = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (photos) {
        const cam = await Camera.requestCameraPermissionsAsync().catch(() => null);
        const granted = !!cam?.granted;
        usePhantomStore.getState().setIntruderSnapshotEnabled(granted);
        void track('permission_result', { permission: 'camera', granted });
      }
      if (alerts) {
        const granted = await requestNotificationPermissions().catch(() => false);
        void track('permission_result', { permission: 'notifications', granted: !!granted });
      }
    } finally {
      finish();
    }
  };

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
      <View style={s.hero}>
        <ShieldLogo size={56} />
        <Text style={s.title} accessibilityRole="header">Choose your protection</Text>
        <Text style={s.sub}>
          PhantomShield only protects this phone, and only does what you switch on here. You can
          change any of this later in Settings.
        </Text>
      </View>

      <View style={s.list}>
        <Choice
          icon="camera-outline"
          title="Intruder photos"
          desc="When someone enters a wrong PIN, or moves your phone while Guard Mode is on, the front camera takes a photo for you. Uses the camera."
          value={photos}
          onChange={setPhotos}
        />
        <Choice
          icon="notifications-outline"
          title="Security alerts"
          desc="Tells you when someone tries to get in, shows Guard Mode is on, and shows lost-mode messages. No marketing, ever. Uses notifications."
          value={alerts}
          onChange={setAlerts}
        />
        <View style={s.card}>
          <Ionicons name="location-outline" size={24} color={Colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>Location</Text>
            <Text style={s.cardDesc}>
              Off for now. Turn on Find My Phone or location on events in Settings when you want
              them — we&apos;ll ask then.
            </Text>
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={[s.btn, busy && s.btnDisabled]}
        onPress={handleContinue}
        disabled={busy}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        {busy ? <ActivityIndicator color={Colors.bg} /> : <Text style={s.btnText}>Continue</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

function Choice({
  icon, title, desc, value, onChange,
}: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; desc: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={s.card}>
      <Ionicons name={icon} size={24} color={Colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={s.cardTitle}>{title}</Text>
        <Text style={s.cardDesc}>{desc}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={title}
        trackColor={{ false: Colors.bgBorder, true: Colors.primary + '55' }}
        thumbColor={value ? Colors.primary : Colors.textMuted}
      />
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  container: { padding: Spacing.lg, paddingTop: 72, paddingBottom: 40, gap: Spacing.lg },
  hero: { alignItems: 'center', gap: Spacing.sm },
  title: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.textPrimary, marginTop: Spacing.sm, textAlign: 'center' },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  list: { gap: Spacing.md },
  card: {
    flexDirection: 'row', gap: Spacing.md, alignItems: 'center',
    backgroundColor: Colors.bgCard, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.bgBorder, padding: Spacing.md,
  },
  cardTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary },
  cardDesc: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 4, lineHeight: 19 },
  btn: { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 16, alignItems: 'center' },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontSize: FontSize.md, fontWeight: '800', color: Colors.bg },
});
