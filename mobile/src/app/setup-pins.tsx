import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { PinPad } from '@/components/PinPad';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { PINLayer } from '@/constants/types';
import * as pinVault from '@/services/pinVault';

const LAYERS: { layer: PINLayer; label: string; desc: string; icon: string }[] = [
  { layer: 'dashboard', icon: '🏠', label: 'Dashboard PIN',   desc: 'Quick access to your activity summary.' },
  { layer: 'logs',      icon: '📊', label: 'Logs PIN',         desc: 'Protects full activity history.' },
  { layer: 'vault',     icon: '🔒', label: 'Vault PIN',        desc: 'Protects intruder photos and exports.' },
  { layer: 'settings',  icon: '⚙️', label: 'Settings PIN',    desc: 'Protects app configuration.' },
  { layer: 'decoy',     icon: '🎭', label: 'Decoy PIN',        desc: 'Opens a fake empty dashboard under duress.' },
];

type Step = 'overview' | 'entering' | 'confirming';

export default function SetupPinsScreen() {
  usePreventScreenCapture('setup-pins');
  const params = useLocalSearchParams<{ singleLayer?: PINLayer; label?: string }>();

  // When launched from settings to change a single PIN
  const singleLayer = params.singleLayer as PINLayer | undefined;
  const layers = singleLayer ? LAYERS.filter((l) => l.layer === singleLayer) : LAYERS;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [step, setStep] = useState<Step>(singleLayer ? 'entering' : 'overview');
  const [firstPin, setFirstPin] = useState('');

  const currentLayer = layers[currentIndex];

  const handleFirstEntry = (pin: string) => {
    setFirstPin(pin);
    setStep('confirming');
  };

  const handleConfirm = async (pin: string) => {
    if (pin !== firstPin) {
      Alert.alert('PINs do not match', 'Please try again.', [
        { text: 'OK', onPress: () => setStep('entering') },
      ]);
      setFirstPin('');
      return;
    }
    await pinVault.setPin(currentLayer.layer, pin);

    const isLast = currentIndex === layers.length - 1;
    if (isLast) {
      if (singleLayer) {
        router.back();
      } else {
        router.replace('/biometric-gate');
      }
    } else {
      setCurrentIndex((i) => i + 1);
      setStep('entering');
      setFirstPin('');
    }
  };

  const handleSkip = () => {
    const isLast = currentIndex === layers.length - 1;
    if (isLast) {
      router.replace('/biometric-gate');
    } else {
      setCurrentIndex((i) => i + 1);
    }
  };

  // Overview screen shown only on first-run full setup
  if (step === 'overview') {
    return (
      <View style={s.container}>
        <Text style={s.title}>Set Up Your PINs</Text>
        <Text style={s.sub}>
          PhantomShield uses separate PINs for each protected section. You can skip any section and
          set it later from Settings.
        </Text>

        <View style={s.layerList}>
          {LAYERS.map((l) => (
            <View key={l.layer} style={s.layerRow}>
              <Text style={s.layerIcon}>{l.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.layerLabel}>{l.label}</Text>
                <Text style={s.layerDesc}>{l.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={s.btn}
          onPress={() => setStep('entering')}
          activeOpacity={0.8}
        >
          <Text style={s.btnText}>Start Setup →</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.replace('/biometric-gate')} style={s.skip}>
          <Text style={s.skipText}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isDecoy = currentLayer.layer === 'decoy';

  return (
    <View style={s.container}>
      {/* Progress dots — only during full setup */}
      {!singleLayer && (
        <View style={s.progress}>
          {layers.map((_, i) => (
            <View
              key={i}
              style={[
                s.dot,
                i === currentIndex && s.dotActive,
                i < currentIndex && s.dotDone,
              ]}
            />
          ))}
        </View>
      )}

      {isDecoy && (
        <View style={s.decoyNotice}>
          <Text style={s.decoyText}>
            🎭 The Decoy PIN opens a fake empty dashboard when entered. Keep it different from all
            other PINs.
          </Text>
        </View>
      )}

      <PinPad
        title={
          step === 'confirming'
            ? `Confirm ${currentLayer.label}`
            : `Set ${currentLayer.label}`
        }
        subtitle={
          step === 'confirming'
            ? 'Enter the same PIN again to confirm.'
            : currentLayer.desc
        }
        mode="set"
        onSuccess={step === 'entering' ? handleFirstEntry : handleConfirm}
      />

      {!singleLayer && currentLayer.layer !== 'dashboard' && (
        <TouchableOpacity onPress={handleSkip} style={s.skip}>
          <Text style={s.skipText}>Skip this PIN</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
    justifyContent: 'center',
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  title: { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  sub:   { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  layerList: { gap: 12 },
  layerRow:  { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  layerIcon: { fontSize: 20, marginTop: 2 },
  layerLabel:{ fontSize: FontSize.md, fontWeight: '600', color: Colors.textPrimary },
  layerDesc: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  progress:  { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dot:       { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.bgBorder },
  dotActive: { backgroundColor: Colors.primary, width: 20 },
  dotDone:   { backgroundColor: Colors.primary + '66' },
  decoyNotice: {
    backgroundColor: Colors.accentGlow,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.accent + '44',
  },
  decoyText: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  btn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnText: { fontSize: FontSize.md, fontWeight: '700', color: Colors.bg },
  skip:    { alignItems: 'center', paddingVertical: 8 },
  skipText:{ fontSize: FontSize.sm, color: Colors.textSecondary },
});
