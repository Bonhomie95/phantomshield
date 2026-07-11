import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import { usePhantomStore } from '@/stores/phantom';
import { ShieldLogo } from '@/components/ShieldLogo';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import * as pinVault from '@/services/pinVault';

export default function BiometricGateScreen() {
  const { setAppUnlocked, isAuthenticated } = usePhantomStore();
  const [authenticating, setAuthenticating] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    checkAndAuthenticate();
  }, []);

  const checkAndAuthenticate = async () => {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled   = await LocalAuthentication.isEnrolledAsync();
    if (!compatible || !enrolled) {
      setSupported(false);
      // No biometrics enrolled — DON'T silently open the app. Fall back to the
      // dashboard PIN gate if one is configured; only open directly if the user
      // has set no PIN at all (nothing to enforce).
      const hasAnyPin = await pinVault.hasPin('dashboard');
      if (hasAnyPin) {
        router.replace({ pathname: '/pin-gate', params: { layer: 'dashboard', redirect: '/(tabs)' } });
      } else {
        proceedWithoutBiometric();
      }
      return;
    }
    authenticate();
  };

  const authenticate = async () => {
    if (authenticating) return;
    setAuthenticating(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Verify your identity to open PhantomShield',
        fallbackLabel: 'Use Passcode',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });

      if (result.success) {
        setAppUnlocked(true);
        router.replace('/(tabs)');
      } else {
        // User cancelled — show retry option rather than looping automatically
      }
    } catch {
      Alert.alert('Authentication Error', 'Unable to use biometrics. Try again.');
    } finally {
      setAuthenticating(false);
    }
  };

  const proceedWithoutBiometric = () => {
    setAppUnlocked(true);
    router.replace('/(tabs)');
  };

  if (!isAuthenticated) {
    router.replace('/(auth)/welcome');
    return null;
  }

  return (
    <View style={s.container}>
      <ShieldLogo size={72} />

      <View style={s.textBlock}>
        <Text style={s.title}>Identity Required</Text>
        <Text style={s.sub}>
          PhantomShield requires verification every time you open the app.
        </Text>
      </View>

      <TouchableOpacity
        style={[s.btn, authenticating && s.btnDisabled]}
        onPress={authenticate}
        disabled={authenticating}
        activeOpacity={0.8}
      >
        <Text style={s.btnText}>
          {authenticating ? 'Verifying…' : '🔐  Use Face ID / Fingerprint'}
        </Text>
      </TouchableOpacity>

      {!supported && (
        <TouchableOpacity onPress={proceedWithoutBiometric} style={s.skip}>
          <Text style={s.skipText}>Continue without biometrics</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.xl,
  },
  textBlock: { alignItems: 'center', gap: Spacing.sm },
  title: { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  sub:   { fontSize: FontSize.sm,  color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  btn: {
    width: '100%',
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnText:     { fontSize: FontSize.md, fontWeight: '700', color: Colors.bg },
  skip:        { marginTop: -Spacing.md },
  skipText:    { fontSize: FontSize.sm, color: Colors.textSecondary },
});
