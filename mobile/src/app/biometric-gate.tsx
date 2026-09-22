import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, AppState } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import { usePhantomStore } from '@/stores/phantom';
import { ShieldLogo } from '@/components/ShieldLogo';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import * as pinVault from '@/services/pinVault';
import { stopSiren } from '@/services/alarm';

export default function BiometricGateScreen() {
  const { setAppUnlocked } = usePhantomStore();
  const hasAccess = usePhantomStore((st) => st.isAuthenticated || st.onboarded);
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPin, setHasPin] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    void pinVault.hasPin('app').then(setHasPin);
  }, []);

  const unlock = useCallback(() => {
    // Owner verified — silence any remote "find my phone" siren.
    stopSiren();
    setAppUnlocked(true);
    router.replace('/(tabs)');
  }, [setAppUnlocked]);

  const authenticate = useCallback(async () => {
    // The OS refuses a biometric prompt from a backgrounded app, so only ask
    // while we are actually on screen.
    if (busy.current || AppState.currentState !== 'active') return;
    busy.current = true;
    setAuthenticating(true);
    setError(null);
    try {
      const [hasHardware, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!hasHardware || !enrolled) {
        // No biometrics — fall back to the PIN gate when any PIN exists. With no
        // PIN anywhere there is nothing to enforce; the device passcode prompt
        // below still verifies the owner.
        if (await pinVault.hasPin('app')) {
          router.replace('/pin-gate');
          return;
        }
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock PhantomShield',
        fallbackLabel: 'Use Passcode',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      if (result.success) {
        unlock();
      } else if (result.error === 'not_enrolled' || result.error === 'passcode_not_set') {
        // No biometrics and no device passcode: the phone itself is unprotected
        // and there is no PIN either — nothing to verify against.
        unlock();
      } else if (result.error !== 'user_cancel' && result.error !== 'system_cancel' && result.error !== 'app_cancel') {
        setError('Verification failed. Try again.');
      }
    } catch {
      setError('Unable to verify right now. Try again.');
    } finally {
      busy.current = false;
      setAuthenticating(false);
    }
  }, [unlock]);

  useEffect(() => {
    // An unauthenticated session must never reach the gate.
    if (!hasAccess) {
      router.replace('/(auth)/welcome');
      return;
    }
    void authenticate();
    // Mounted while backgrounded (the app was locked on the way out): prompt the
    // moment the owner comes back.
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void authenticate(); });
    return () => sub.remove();
  }, [hasAccess, authenticate]);

  const usePin = () => router.replace('/pin-gate');

  if (!hasAccess) return null;

  return (
    <View style={s.container}>
      <ShieldLogo size={72} />

      <View style={s.textBlock}>
        <Text style={s.title} accessibilityRole="header">PhantomShield is locked</Text>
        <Text style={s.sub}>Verify it&apos;s you to continue.</Text>
        {error && <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text>}
      </View>

      <TouchableOpacity
        style={[s.btn, authenticating && s.btnDisabled]}
        onPress={authenticate}
        disabled={authenticating}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Unlock with Face ID, fingerprint or passcode"
      >
        <Text style={s.btnText}>{authenticating ? 'Verifying…' : 'Unlock'}</Text>
      </TouchableOpacity>

      {hasPin && (
        <TouchableOpacity onPress={usePin} style={s.skip} accessibilityRole="button">
          <Text style={s.skipText}>Use my PhantomShield PIN</Text>
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
  error: { fontSize: FontSize.sm, color: Colors.accent, textAlign: 'center' },
  btn: {
    width: '100%',
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnText:     { fontSize: FontSize.md, fontWeight: '700', color: Colors.bg },
  skip:        { marginTop: -Spacing.md, padding: Spacing.sm },
  skipText:    { fontSize: FontSize.sm, color: Colors.textSecondary },
});
