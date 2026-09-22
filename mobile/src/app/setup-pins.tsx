import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { PinPad } from '@/components/PinPad';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { PINLayer } from '@/constants/types';
import * as pinVault from '@/services/pinVault';
import { usePhantomStore } from '@/stores/phantom';
import { track } from '@/services/analytics';

const COPY: Record<PINLayer, { title: string; desc: string }> = {
  app: {
    title: 'Create your PhantomShield PIN',
    desc: 'You’ll use it to open the app and to stop Guard Mode. Face ID or fingerprint works too.',
  },
  decoy: {
    title: 'Create a decoy PIN',
    desc: 'If someone forces you to open the app, this PIN shows a harmless screen with nothing in it.',
  },
};

export default function SetupPinScreen() {
  usePreventScreenCapture('setup-pins');
  const params = useLocalSearchParams<{ layer?: PINLayer }>();
  const layer: PINLayer = params.layer === 'decoy' ? 'decoy' : 'app';
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [firstPin, setFirstPin] = useState('');

  // Setting a PIN can overwrite one, so it is never reachable by deep link:
  // only from onboarding (one-shot allowance) or from the unlocked app.
  useEffect(() => {
    const ok = pinVault.consumeFirstRunSetup() || usePhantomStore.getState().isAppUnlocked;
    if (!ok) router.replace('/');
    setAllowed(ok);
  }, []);

  const handleFirstEntry = async (pin: string) => {
    if (pinVault.isWeakPin(pin)) {
      Alert.alert('Choose a stronger PIN', 'Avoid repeated digits (1111) and straight runs (1234) — they are the first guesses anyone tries.');
      return;
    }
    const other: PINLayer = layer === 'app' ? 'decoy' : 'app';
    if (await pinVault.verifyPin(other, pin)) {
      Alert.alert('Use a different PIN', 'Your app PIN and decoy PIN must be different.');
      return;
    }
    setFirstPin(pin);
    setStep('confirm');
  };

  const handleConfirm = async (pin: string) => {
    if (pin !== firstPin) {
      Alert.alert('PINs don’t match', 'Please try again.');
      setFirstPin('');
      setStep('enter');
      return;
    }
    await pinVault.setPin(layer, pin);
    void track('pin_set', { layer });

    if (layer === 'decoy') {
      usePhantomStore.setState({ decoyPinSet: true });
      router.back();
      return;
    }

    const st = usePhantomStore.getState();
    if (st.onboarded) {
      // Changing an existing PIN from Settings.
      router.back();
      return;
    }
    // First run complete.
    void track('pin_setup_completed');
    st.setOnboarded(true);
    st.setAppUnlocked(true);
    router.replace('/(tabs)');
  };

  if (!allowed) return <View style={s.container} />;

  return (
    <View style={s.container}>
      <Ionicons name={layer === 'decoy' ? 'eye-off-outline' : 'lock-closed-outline'} size={40} color={Colors.primary} style={s.icon} />
      <PinPad
        key={step}
        title={step === 'confirm' ? 'Enter it again' : COPY[layer].title}
        subtitle={step === 'confirm' ? 'Enter the same 4 digits to confirm.' : COPY[layer].desc}
        mode="set"
        onSuccess={step === 'enter' ? handleFirstEntry : handleConfirm}
      />
      {(layer === 'decoy' || usePhantomStore.getState().onboarded) && (
        <TouchableOpacity onPress={() => router.back()} style={s.cancel} accessibilityRole="button">
          <Text style={s.cancelText}>Cancel</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg, justifyContent: 'center', padding: Spacing.lg, gap: Spacing.lg },
  icon: { alignSelf: 'center', padding: Spacing.md, borderRadius: Radius.full, backgroundColor: Colors.primaryGlow },
  cancel: { alignItems: 'center', paddingVertical: 8 },
  cancelText: { fontSize: FontSize.sm, color: Colors.textSecondary },
});
