import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Switch, Alert,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { resetTo, openFromModal } from '@/services/navigation';
import { Ionicons } from '@expo/vector-icons';
import type { Guardian } from '@phantomshield/shared';
import { usePhantomStore } from '@/stores/phantom';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { listGuardians, addGuardian, removeGuardian, setGuardianAlertOnGuard } from '@/services/api';
import { track } from '@/services/analytics';

/**
 * Guardians: people who get an email with a live-location link when this phone
 * looks stolen. They don't need the app. The server emails them once when
 * added, so the first alert never comes from a stranger.
 */
export default function GuardiansScreen() {
  const isAuthenticated = usePhantomStore((s) => s.isAuthenticated);
  const isAppUnlocked = usePhantomStore((s) => s.isAppUnlocked);
  const [guardians, setGuardians] = useState<Guardian[] | null>(null);
  const [limit, setLimit] = useState(1);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await listGuardians();
    if (res) {
      setGuardians(res.guardians);
      setLimit(res.limit);
    } else {
      setGuardians([]);
    }
  }, []);

  useEffect(() => {
    if (!isAppUnlocked) resetTo('/');
    else if (isAuthenticated) void load();
  }, [isAppUnlocked, isAuthenticated, load]);

  const add = async () => {
    if (busy) return;
    setBusy(true);
    const res = await addGuardian(name.trim(), email.trim(), true);
    setBusy(false);
    if (res.ok) {
      track('guardian_added');
      setName('');
      setEmail('');
      setGuardians((g) => [...(g ?? []), res.guardian]);
      Alert.alert('Guardian added', `${res.guardian.name} will get an email saying you added them.`);
    } else if (res.upgrade) {
      Alert.alert('Add more guardians', res.message, [
        { text: 'Not now', style: 'cancel' },
        { text: 'See plans', onPress: () => router.push({ pathname: '/paywall', params: { source: 'guardians' } }) },
      ]);
    } else {
      Alert.alert('Couldn’t add guardian', res.message);
    }
  };

  const remove = (g: Guardian) =>
    Alert.alert('Remove guardian?', `${g.name} won’t be alerted any more.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          // An alert can outlive the lock: never act for whoever holds a locked phone.
          if (!usePhantomStore.getState().isAppUnlocked) return;
          if (await removeGuardian(g.id)) setGuardians((list) => (list ?? []).filter((x) => x.id !== g.id));
          else Alert.alert('Couldn’t remove guardian', 'Check your connection and try again.');
        },
      },
    ]);

  const toggleGuard = async (g: Guardian, v: boolean) => {
    setGuardians((list) => (list ?? []).map((x) => (x.id === g.id ? { ...x, alertOnGuard: v } : x)));
    if (!(await setGuardianAlertOnGuard(g.id, v))) {
      setGuardians((list) => (list ?? []).map((x) => (x.id === g.id ? { ...x, alertOnGuard: !v } : x)));
    }
  };

  const canAdd = name.trim().length > 0 && /^\S+@\S+\.\S+$/.test(email.trim());
  const full = guardians !== null && guardians.length >= limit;

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={s.flex} contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
        <View style={s.headerRow}>
          <Text style={s.title} accessibilityRole="header">Guardians</Text>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={26} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <Text style={s.sub}>
          If your phone looks stolen — its SIM is swapped or removed, or Guard Mode is set off — your
          guardians get an email with a private link showing where it is. The link expires after 24
          hours. They don’t need the app.
        </Text>

        {!isAuthenticated ? (
          <View style={s.card}>
            <Text style={s.cardTitle}>Sign in to add guardians</Text>
            <Text style={s.cardText}>Alerts are sent from your account, so they still go out when your phone is gone.</Text>
            <TouchableOpacity style={s.primaryBtn} onPress={() => openFromModal('/(auth)/welcome')} accessibilityRole="button">
              <Text style={s.primaryText}>Sign in</Text>
            </TouchableOpacity>
          </View>
        ) : guardians === null ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
        ) : (
          <>
            {guardians.map((g) => (
              <View key={g.id} style={s.card}>
                <View style={s.row}>
                  <Ionicons name="person-circle-outline" size={32} color={Colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardTitle}>{g.name}</Text>
                    <Text style={s.cardText}>{g.email}</Text>
                  </View>
                  <TouchableOpacity onPress={() => remove(g)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${g.name}`}>
                    <Ionicons name="trash-outline" size={20} color={Colors.accent} />
                  </TouchableOpacity>
                </View>
                <View style={[s.row, s.toggleRow]}>
                  <Text style={[s.cardText, { flex: 1 }]}>Also alert when Guard Mode is set off</Text>
                  <Switch
                    value={g.alertOnGuard}
                    onValueChange={(v) => void toggleGuard(g, v)}
                    accessibilityLabel={`Alert ${g.name} when Guard Mode is set off`}
                    trackColor={{ false: Colors.bgBorder, true: Colors.primary + '55' }}
                    thumbColor={g.alertOnGuard ? Colors.primary : Colors.textMuted}
                  />
                </View>
              </View>
            ))}

            {full ? (
              <Text style={s.note}>
                You’ve added {guardians.length} of {limit}.{' '}
                <Text style={s.link} onPress={() => router.push({ pathname: '/paywall', params: { source: 'guardians' } })}>
                  Upgrade for more
                </Text>
              </Text>
            ) : (
              <View style={s.card}>
                <Text style={s.cardTitle}>Add a guardian</Text>
                <TextInput
                  style={s.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="Name"
                  placeholderTextColor={Colors.textMuted}
                  maxLength={60}
                  autoCapitalize="words"
                  accessibilityLabel="Guardian name"
                />
                <TextInput
                  style={s.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={254}
                  accessibilityLabel="Guardian email"
                />
                <TouchableOpacity
                  style={[s.primaryBtn, (!canAdd || busy) && s.disabled]}
                  onPress={add}
                  disabled={!canAdd || busy}
                  accessibilityRole="button"
                >
                  {busy ? <ActivityIndicator color={Colors.bg} /> : <Text style={s.primaryText}>Add guardian</Text>}
                </TouchableOpacity>
                <Text style={s.note}>{guardians.length} of {limit} used. Only add people who have agreed to help.</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.bg },
  container: { padding: Spacing.lg, paddingTop: Spacing.xl, paddingBottom: 48, gap: Spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.textPrimary },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  card: { backgroundColor: Colors.bgCard, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.bgBorder, padding: Spacing.md, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleRow: { borderTopWidth: 1, borderTopColor: Colors.bgBorder, paddingTop: Spacing.sm },
  cardTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary },
  cardText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  input: {
    backgroundColor: Colors.bgElevated, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.bgBorder,
    paddingHorizontal: Spacing.md, paddingVertical: 12, fontSize: FontSize.md, color: Colors.textPrimary,
  },
  primaryBtn: { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  primaryText: { fontSize: FontSize.md, fontWeight: '800', color: Colors.bg },
  disabled: { opacity: 0.5 },
  note: { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center' },
  link: { color: Colors.primary, fontWeight: '700' },
});
