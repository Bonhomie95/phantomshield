import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { resetTo } from '@/services/navigation';
import * as WebBrowser from 'expo-web-browser';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { listDevices, removeDevice, getOrCreateDeviceId, AccountDevice } from '@/services/api';
import { DASHBOARD_URL } from '@/constants/config';
import { usePhantomStore } from '@/stores/phantom';

const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
};

export default function DevicesScreen() {
  const [devices, setDevices] = useState<AccountDevice[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [thisId, setThisId] = useState('');

  // Reached only from an unlocked Settings layer; a deep link lands nowhere.
  const allowed = usePhantomStore((s) => s.isAppUnlocked && s.isAuthenticated);

  const load = useCallback(async () => {
    setLoading(true);
    const [list, id] = await Promise.all([listDevices(), getOrCreateDeviceId()]);
    setThisId(id);
    setDevices(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!allowed) { resetTo('/'); return; }
    void load();
  }, [allowed, load]);

  const confirmRemove = (d: AccountDevice) => {
    Alert.alert(
      'Remove this device?',
      `${d.model} will be signed out of PhantomShield and stop reporting to your account.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            // An alert can outlive the lock: never act for whoever holds a locked phone.
            if (!usePhantomStore.getState().isAppUnlocked) return;
            setRemoving(d.deviceId);
            const ok = await removeDevice(d.deviceId);
            setRemoving(null);
            if (ok) setDevices((cur) => cur?.filter((x) => x.deviceId !== d.deviceId) ?? null);
            else Alert.alert('Couldn’t remove device', 'Check your connection and try again.');
          },
        },
      ],
    );
  };

  if (!allowed) return <View style={s.scroll} />;

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.container}
      refreshControl={<RefreshControl refreshing={loading && devices !== null} onRefresh={load} tintColor={Colors.primary} />}
    >
      <View style={s.header}>
        <Text style={s.title} accessibilityRole="header">Devices</Text>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12}>
          <Text style={s.close}>✕</Text>
        </TouchableOpacity>
      </View>
      <Text style={s.sub}>Phones and browsers signed in to your account.</Text>

      {loading && devices === null ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
      ) : devices === null ? (
        <View style={s.card}>
          <Text style={s.empty}>Couldn’t load your devices. Check your connection.</Text>
          <TouchableOpacity style={s.retry} onPress={load} accessibilityRole="button">
            <Text style={s.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        devices.map((d) => {
          const isThis = d.deviceId === thisId;
          return (
            <View key={d.deviceId} style={s.card}>
              <Text style={s.icon} accessibilityElementsHidden>
                {d.platform === 'web' ? '🌐' : d.platform === 'ios' ? '📱' : '🤖'}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={s.name}>
                  {d.platform === 'web' ? 'Web dashboard' : d.model}
                  {isThis ? '  ·  This phone' : ''}
                </Text>
                <Text style={s.meta}>
                  {d.isOnline ? 'Online now' : `Last seen ${ago(d.lastSeenAt)}`}
                  {d.platform !== 'web' && d.osVersion !== 'Unknown' ? `  ·  ${d.platform === 'ios' ? 'iOS' : 'Android'} ${d.osVersion}` : ''}
                </Text>
              </View>
              {!isThis && (
                <TouchableOpacity
                  onPress={() => confirmRemove(d)}
                  disabled={removing !== null}
                  style={s.remove}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${d.model}`}
                >
                  {removing === d.deviceId
                    ? <ActivityIndicator color={Colors.accent} />
                    : <Text style={s.removeText}>Remove</Text>}
                </TouchableOpacity>
              )}
            </View>
          );
        })
      )}

      <TouchableOpacity style={s.webBtn} onPress={() => WebBrowser.openBrowserAsync(DASHBOARD_URL)} accessibilityRole="link">
        <Text style={s.webText}>Open the web dashboard</Text>
      </TouchableOpacity>
      <Text style={s.hint}>
        If this phone is lost, sign in on the web dashboard from any browser to see where it is and lock it.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: Colors.bg },
  container: { padding: Spacing.lg, paddingTop: 32, paddingBottom: 48, gap: Spacing.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.textPrimary },
  close: { fontSize: 22, color: Colors.textSecondary, padding: 4 },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.bgCard, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.bgBorder, padding: Spacing.md, flexWrap: 'wrap',
  },
  icon: { fontSize: 24 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.textPrimary },
  meta: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  remove: { paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  removeText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.accent },
  empty: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary },
  retry: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.primary + '55' },
  retryText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  webBtn: {
    marginTop: Spacing.md, borderWidth: 1, borderColor: Colors.primary + '55',
    backgroundColor: Colors.primaryGlow, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center',
  },
  webText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  hint: { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center', lineHeight: 17 },
});
