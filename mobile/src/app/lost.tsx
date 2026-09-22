import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, BackHandler, Alert } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { PinPad } from '@/components/PinPad';
import { usePhantomStore } from '@/stores/phantom';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import * as pinVault from '@/services/pinVault';
import { clearLostMode } from '@/services/api';
import { dismissLostModeNotification } from '@/services/notifications';
import { stopSiren } from '@/services/alarm';

/** Something a finder can tap: a phone number dials, an email opens mail. */
function contactUrl(contact: string): string | null {
  const c = contact.trim();
  if (/^\S+@\S+\.\S+$/.test(c)) return `mailto:${c}`;
  const digits = c.replace(/[^\d+]/g, '');
  return digits.length >= 6 ? `tel:${digits}` : null;
}

/**
 * Lost mode: the owner marked this phone lost from the web. Whoever holds it
 * sees the owner's message and a way to reach them — nothing else. Only the
 * owner's PIN or biometrics gets past it, and doing so ends lost mode.
 */
export default function LostScreen() {
  usePreventScreenCapture('lost');
  const lostMode = usePhantomStore((s) => s.lostMode);
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!lostMode) router.replace('/');
  }, [lostMode]);

  const found = async () => {
    stopSiren();
    const st = usePhantomStore.getState();
    st.setLostMode(null);
    st.setAppUnlocked(true);
    void dismissLostModeNotification();
    if (st.isAuthenticated && !(await clearLostMode())) {
      Alert.alert('Lost mode is still on in your account', 'Turn it off from the web dashboard when you’re back online.');
    }
    router.replace('/(tabs)');
  };

  const tryBiometric = async () => {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Confirm it’s your phone',
      cancelLabel: 'Use PIN',
      disableDeviceFallback: true,
    }).catch(() => null);
    if (res?.success) await found();
    else setUnlocking(true);
  };

  if (!lostMode) return <View style={s.container} />;

  if (unlocking) {
    return (
      <View style={s.container}>
        <PinPad
          title="Owner PIN"
          subtitle="Enter your PhantomShield PIN to turn off lost mode."
          verify={(pin) => pinVault.verifyPin('app', pin)}
          lockContext="lost"
          onSuccess={found}
        />
        <TouchableOpacity onPress={() => setUnlocking(false)} style={s.link} accessibilityRole="button">
          <Text style={s.linkText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const url = lostMode.contact ? contactUrl(lostMode.contact) : null;

  return (
    <View style={s.container}>
      <View style={s.badge}>
        <Ionicons name="help-buoy-outline" size={44} color={Colors.primary} />
      </View>
      <Text style={s.title} accessibilityRole="header">This phone is lost</Text>
      <Text style={s.message}>{lostMode.message}</Text>

      {lostMode.contact ? (
        url ? (
          <TouchableOpacity
            style={s.primaryBtn}
            onPress={() => void Linking.openURL(url)}
            accessibilityRole="button"
            accessibilityLabel={`Contact the owner: ${lostMode.contact}`}
          >
            <Ionicons name={url.startsWith('tel:') ? 'call' : 'mail'} size={20} color={Colors.bg} />
            <Text style={s.primaryText}>Contact the owner</Text>
          </TouchableOpacity>
        ) : null
      ) : null}
      {lostMode.contact ? <Text style={s.contact} selectable>{lostMode.contact}</Text> : null}

      <Text style={s.thanks}>Thank you for helping get it back.</Text>

      <TouchableOpacity onPress={tryBiometric} style={s.link} accessibilityRole="button">
        <Text style={s.linkText}>I’m the owner</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  badge: {
    width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primaryGlow, borderWidth: 1, borderColor: Colors.primary + '55',
  },
  title: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  message: { fontSize: FontSize.lg, color: Colors.textPrimary, textAlign: 'center', lineHeight: 26 },
  contact: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center' },
  primaryBtn: {
    marginTop: Spacing.md, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 16, alignSelf: 'stretch',
  },
  primaryText: { fontSize: FontSize.md, fontWeight: '800', color: Colors.bg },
  thanks: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.md },
  link: { marginTop: Spacing.lg, padding: Spacing.sm },
  linkText: { fontSize: FontSize.sm, color: Colors.textMuted },
});
