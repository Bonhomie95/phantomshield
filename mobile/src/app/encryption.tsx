import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { resetTo, openFromModal } from '@/services/navigation';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { usePhantomStore } from '@/stores/phantom';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { getE2eState, putE2eKeyCheck, disableE2eRemote } from '@/services/api';
import {
  createPhotoKey, savePhotoKey, getPhotoKey, forgetPhotoKey, keyCheck, parseRecoveryKey, currentRecoveryKey,
} from '@/services/e2e';
import { track } from '@/services/analytics';

type View_ = 'loading' | 'off' | 'restore' | 'on' | 'reveal' | 'offline';

/**
 * Private photo backup: intruder photos are encrypted on this phone with a key
 * only the owner holds. The web dashboard asks for the recovery key to open them.
 */
export default function EncryptionScreen() {
  usePreventScreenCapture('encryption');
  const isAuthenticated = usePhantomStore((s) => s.isAuthenticated);
  const isAppUnlocked = usePhantomStore((s) => s.isAppUnlocked);
  const [view, setView] = useState<View_>('loading');
  const [serverCheck, setServerCheck] = useState<string | null>(null);
  const [recovery, setRecovery] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [state, key] = await Promise.all([getE2eState(), getPhotoKey()]);
    if (!state) return setView('offline');
    usePhantomStore.getState().setE2eEnabled(state.enabled);
    setServerCheck(state.keyCheck);
    if (!state.enabled) {
      // A key left over from an earlier session isn't the account's any more.
      if (key) await forgetPhotoKey();
      return setView('off');
    }
    setView(key && (await keyCheck(key)) === state.keyCheck ? 'on' : 'restore');
  }, []);

  useEffect(() => {
    if (!isAppUnlocked) resetTo('/');
    else if (isAuthenticated) void load();
  }, [isAppUnlocked, isAuthenticated, load]);

  const turnOn = async () => {
    setBusy(true);
    const { key, recoveryKey } = createPhotoKey();
    const res = await putE2eKeyCheck(await keyCheck(key));
    setBusy(false);
    if (res === 'conflict') return void load();
    if (res !== 'ok') return Alert.alert('Couldn’t turn it on', 'Check your connection and try again.');
    await savePhotoKey(key);
    usePhantomStore.getState().setE2eEnabled(true);
    track('e2e_enabled');
    setRecovery(recoveryKey);
    setView('reveal');
  };

  const restore = async () => {
    const key = parseRecoveryKey(typed);
    if (!key || (await keyCheck(key)) !== serverCheck) {
      return Alert.alert('That key doesn’t match', 'Check each group of characters and try again.');
    }
    await savePhotoKey(key);
    usePhantomStore.getState().setE2eEnabled(true);
    setTyped('');
    setView('on');
  };

  const showKey = async () => {
    const k = await currentRecoveryKey();
    if (k) {
      setRecovery(k);
      setView('reveal');
    }
  };

  const turnOff = () =>
    Alert.alert(
      'Turn off private backup?',
      'New photos will be backed up without end-to-end encryption. Photos already backed up stay encrypted — keep your recovery key to see them on the web.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn off',
          style: 'destructive',
          onPress: async () => {
            // An alert can outlive the lock: never act for whoever holds a locked phone.
            if (!usePhantomStore.getState().isAppUnlocked) return;
            if (!(await disableE2eRemote())) return Alert.alert('Couldn’t turn it off', 'Check your connection and try again.');
            await forgetPhotoKey();
            usePhantomStore.getState().setE2eEnabled(false);
            track('e2e_disabled');
            setView('off');
          },
        },
      ],
    );

  const body = () => {
    if (!isAuthenticated) {
      return (
        <View style={s.card}>
          <Text style={s.cardTitle}>Sign in first</Text>
          <Text style={s.cardText}>Private backup encrypts the photos PhantomShield backs up to your account.</Text>
          <Btn label="Sign in" onPress={() => openFromModal('/(auth)/welcome')} />
        </View>
      );
    }
    switch (view) {
      case 'loading':
        return <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />;
      case 'offline':
        return <Text style={s.cardText}>Can’t reach PhantomShield right now. Check your connection and try again.</Text>;
      case 'off':
        return (
          <View style={s.card}>
            <Point icon="lock-closed-outline" text="Photos are encrypted on this phone before they’re uploaded. We store only scrambled data." />
            <Point icon="key-outline" text="You get a recovery key. Enter it on the web dashboard to see your photos." />
            <Point icon="warning-outline" text="If you lose the recovery key, nobody can open those photos — not even us." warn />
            <Btn label="Turn on private backup" onPress={turnOn} busy={busy} />
          </View>
        );
      case 'reveal':
        return (
          <View style={s.card}>
            <Text style={s.cardTitle}>Your recovery key</Text>
            <Text style={s.cardText}>Write it down or save it in a password manager. You’ll need it to see your photos on the web or on a new phone.</Text>
            <Text style={s.key} selectable accessibilityLabel={`Recovery key ${recovery.split('').join(' ')}`}>{recovery}</Text>
            <Btn
              label="Copy"
              secondary
              onPress={async () => {
                await Clipboard.setStringAsync(recovery);
                Alert.alert('Copied', 'Paste it somewhere safe, then clear it from your clipboard.');
              }}
            />
            <Btn label="I’ve saved it" onPress={() => { setRecovery(''); setView('on'); }} />
          </View>
        );
      case 'restore':
        return (
          <View style={s.card}>
            <Text style={s.cardTitle}>Enter your recovery key</Text>
            <Text style={s.cardText}>
              Private backup is on for your account. Enter your recovery key so this phone can encrypt its photos
              too. Until then, photos stay on this phone and aren’t backed up.
            </Text>
            <TextInput
              style={s.input}
              value={typed}
              onChangeText={setTyped}
              placeholder="XXXX-XXXX-XXXX-…"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              multiline
              accessibilityLabel="Recovery key"
            />
            <Btn label="Use this key" onPress={restore} />
          </View>
        );
      case 'on':
        return (
          <View style={s.card}>
            <View style={s.row}>
              <Ionicons name="checkmark-circle" size={24} color={Colors.success} />
              <Text style={s.cardTitle}>Private backup is on</Text>
            </View>
            <Text style={s.cardText}>New photos are encrypted on this phone before upload.</Text>
            <Btn label="Show recovery key" secondary onPress={showKey} />
            <TouchableOpacity onPress={turnOff} style={s.danger} accessibilityRole="button">
              <Text style={s.dangerText}>Turn off</Text>
            </TouchableOpacity>
          </View>
        );
    }
  };

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={s.flex} contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
        <View style={s.headerRow}>
          <Text style={s.title} accessibilityRole="header">Private photo backup</Text>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={26} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
        {body()}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Point({ icon, text, warn }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string; warn?: boolean }) {
  return (
    <View style={s.row}>
      <Ionicons name={icon} size={20} color={warn ? Colors.warning : Colors.primary} />
      <Text style={[s.cardText, { flex: 1 }]}>{text}</Text>
    </View>
  );
}

function Btn({ label, onPress, busy, secondary }: { label: string; onPress: () => void; busy?: boolean; secondary?: boolean }) {
  return (
    <TouchableOpacity
      style={[s.btn, secondary && s.btnSecondary, busy && s.disabled]}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
    >
      {busy ? <ActivityIndicator color={Colors.bg} /> : <Text style={[s.btnText, secondary && s.btnTextSecondary]}>{label}</Text>}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.bg },
  container: { padding: Spacing.lg, paddingTop: Spacing.xl, paddingBottom: 48, gap: Spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.textPrimary, flex: 1 },
  card: { backgroundColor: Colors.bgCard, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.bgBorder, padding: Spacing.md, gap: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary },
  cardText: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  key: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: FontSize.md, color: Colors.textPrimary,
    backgroundColor: Colors.bgElevated, borderRadius: Radius.md, padding: Spacing.md, lineHeight: 24, letterSpacing: 1,
  },
  input: {
    backgroundColor: Colors.bgElevated, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.bgBorder,
    paddingHorizontal: Spacing.md, paddingVertical: 12, fontSize: FontSize.md, color: Colors.textPrimary, minHeight: 72,
  },
  btn: { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
  btnSecondary: { backgroundColor: Colors.bgElevated, borderWidth: 1, borderColor: Colors.bgBorder },
  btnText: { fontSize: FontSize.md, fontWeight: '800', color: Colors.bg },
  btnTextSecondary: { color: Colors.textPrimary },
  disabled: { opacity: 0.6 },
  danger: { alignItems: 'center', paddingVertical: 8 },
  dangerText: { fontSize: FontSize.sm, color: Colors.accent, fontWeight: '600' },
});
