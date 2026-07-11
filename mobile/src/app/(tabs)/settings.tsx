import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Switch,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { router } from 'expo-router';
import { usePhantomStore } from '@/stores/phantom';
import { Card, SectionHeader, Badge, Button, Divider } from '@/components/ui/components';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { clearTokens, signOut, getOrCreateDeviceId } from '@/services/api';
import { SafeZone, PINLayer } from '@/constants/types';

// ─── Setting row ──────────────────────────────────────────────────────────────

function SettingRow({
  icon, title, subtitle, value, onValueChange, onPress, badge, badgeVariant = 'neutral', danger,
}: {
  icon: string; title: string; subtitle?: string;
  value?: boolean; onValueChange?: (v: boolean) => void;
  onPress?: () => void; badge?: string;
  badgeVariant?: 'cyan' | 'red' | 'green' | 'warning' | 'neutral'; danger?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      style={styles.settingRow}
    >
      <Text style={styles.settingIcon}>{icon}</Text>
      <View style={styles.settingInfo}>
        <Text style={[styles.settingTitle, danger && { color: Colors.accent }]}>{title}</Text>
        {subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
      </View>
      {badge && <Badge label={badge} variant={badgeVariant} />}
      {value !== undefined && onValueChange && (
        <Switch
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: Colors.bgBorder, true: Colors.primary + '55' }}
          thumbColor={value ? Colors.primary : Colors.textMuted}
        />
      )}
      {onPress && badge === undefined && value === undefined && (
        <Text style={styles.arrow}>›</Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Add/edit safe zone modal ─────────────────────────────────────────────────

function SafeZoneModal({
  visible,
  onClose,
  onSave,
  existing,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (zone: Omit<SafeZone, 'id'>) => void;
  existing?: SafeZone;
}) {
  const [name, setName]       = useState(existing?.name ?? '');
  const [startHour, setStart] = useState(String(existing?.startHour ?? 7));
  const [endHour, setEnd]     = useState(String(existing?.endHour ?? 23));

  const handleSave = () => {
    const s = parseInt(startHour, 10);
    const e = parseInt(endHour,   10);
    if (!name.trim()) {
      Alert.alert('Missing name', 'Give this zone a name.'); return;
    }
    if (isNaN(s) || isNaN(e) || s < 0 || s > 23 || e < 0 || e > 23) {
      Alert.alert('Invalid hours', 'Hours must be between 0 and 23.'); return;
    }
    onSave({ name: name.trim(), startHour: s, endHour: e, enabled: true });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalBox}>
          <Text style={styles.modalTitle}>{existing ? 'Edit Safe Zone' : 'Add Safe Zone'}</Text>
          <Text style={styles.modalSub}>
            Activity outside these hours will be flagged as anomalous.
          </Text>

          <Text style={styles.fieldLabel}>Zone Name</Text>
          <TextInput
            style={styles.fieldInput}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Home Hours"
            placeholderTextColor={Colors.textMuted}
          />

          <View style={styles.hourRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Start Hour (0–23)</Text>
              <TextInput
                style={styles.fieldInput}
                value={startHour}
                onChangeText={setStart}
                keyboardType="number-pad"
                placeholder="7"
                placeholderTextColor={Colors.textMuted}
              />
            </View>
            <Text style={styles.hourSep}>→</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>End Hour (0–23)</Text>
              <TextInput
                style={styles.fieldInput}
                value={endHour}
                onChangeText={setEnd}
                keyboardType="number-pad"
                placeholder="23"
                placeholderTextColor={Colors.textMuted}
              />
            </View>
          </View>

          <Text style={styles.hourHint}>
            Example: 7 → 23 means unlocks between 11 PM and 7 AM are flagged.
          </Text>

          <View style={styles.modalBtns}>
            <Button label="Cancel" onPress={onClose} variant="ghost" style={{ flex: 1 }} />
            <Button label="Save"   onPress={handleSave} variant="primary" style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const {
    user, setUser, setAuthenticated, setAppUnlocked, lockAllLayers,
    trackingEnabled, setTrackingEnabled,
    locationEnabled, setLocationEnabled,
    intruderSnapshotEnabled, setIntruderSnapshotEnabled,
    safeZones, addSafeZone, removeSafeZone, updateSafeZone,
    unlockedLayers,
  } = usePhantomStore();

  const [showAddZone, setShowAddZone]       = useState(false);
  const [editingZone, setEditingZone]       = useState<SafeZone | undefined>();
  const isSettingsUnlocked = unlockedLayers.includes('settings');

  const requirePin = (action: () => void) => {
    if (!isSettingsUnlocked) {
      router.push({ pathname: '/pin-gate', params: { layer: 'settings', redirect: '/(tabs)/settings' } });
    } else {
      action();
    }
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'You will be signed out and all session data cleared.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          const deviceId = await getOrCreateDeviceId();
          await signOut(deviceId);
          setUser(null);
          setAuthenticated(false);
          setAppUnlocked(false);
          lockAllLayers();
          router.replace('/(auth)/welcome');
        },
      },
    ]);
  };

  const handleChangePIN = (layer: PINLayer, label: string) => {
    requirePin(() =>
      router.push({ pathname: '/setup-pins', params: { singleLayer: layer, label } })
    );
  };

  const handleDeleteZone = (id: string, name: string) => {
    Alert.alert('Remove Zone', `Remove "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeSafeZone(id) },
    ]);
  };

  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          {!isSettingsUnlocked && (
            <TouchableOpacity
              onPress={() =>
                router.push({ pathname: '/pin-gate', params: { layer: 'settings', redirect: '/(tabs)/settings' } })
              }
            >
              <Badge label="🔒 LOCKED" variant="neutral" />
            </TouchableOpacity>
          )}
        </View>

        {/* Account card */}
        <Card style={styles.accountCard}>
          <View style={styles.accountRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(user?.name ?? user?.email ?? 'U')[0].toUpperCase()}
              </Text>
            </View>
            <View style={styles.accountInfo}>
              <Text style={styles.accountName}>{user?.name ?? 'Anonymous'}</Text>
              <Text style={styles.accountEmail}>{user?.email ?? '—'}</Text>
            </View>
            <Badge
              label={user?.plan?.toUpperCase() ?? 'FREE'}
              variant={user?.plan === 'elite' ? 'red' : user?.plan === 'guard' ? 'cyan' : 'neutral'}
            />
          </View>
          <Button
            label={user?.plan === 'elite' ? 'Manage Plan' : 'Upgrade Plan'}
            onPress={() => router.push('/paywall')}
            variant="secondary"
            style={{ marginTop: Spacing.md }}
          />
          <Button
            label="🎁 Invite friends — get Guard free"
            onPress={() => router.push('/invite')}
            variant="ghost"
            style={{ marginTop: Spacing.sm }}
          />
        </Card>

        {/* Monitoring */}
        <View style={styles.section}>
          <SectionHeader title="Monitoring" />
          <Card>
            <SettingRow
              icon="🎯"
              title="Activity Tracking"
              subtitle="Log app sessions and unlock events"
              value={trackingEnabled}
              onValueChange={(v) => {
                if (!v) {
                  Alert.alert('Disable Tracking', 'Stop monitoring? Existing logs are kept.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Disable', style: 'destructive', onPress: () => setTrackingEnabled(false) },
                  ]);
                } else {
                  setTrackingEnabled(true);
                }
              }}
            />
            <Divider />
            <SettingRow
              icon="📍"
              title="Location Tracking"
              subtitle="Log GPS coordinates on unlock events"
              value={locationEnabled}
              onValueChange={(v) => requirePin(() => setLocationEnabled(v))}
            />
            <Divider />
            <SettingRow
              icon="📸"
              title="Intruder Snapshots"
              subtitle="Front camera photo on wrong PIN entry"
              value={intruderSnapshotEnabled}
              onValueChange={(v) => requirePin(() => setIntruderSnapshotEnabled(v))}
            />
          </Card>
        </View>

        {/* Safe Zones */}
        <View style={styles.section}>
          <SectionHeader
            title="Safe Zones"
            action={{ label: '+ Add', onPress: () => requirePin(() => setShowAddZone(true)) }}
          />
          <Card>
            {safeZones.length === 0 ? (
              <Text style={styles.emptyZone}>
                No safe zones yet. Add one to get anomaly alerts when your phone is used outside
                trusted hours.
              </Text>
            ) : (
              safeZones.map((z, i) => (
                <React.Fragment key={z.id}>
                  {i > 0 && <Divider />}
                  <View style={styles.zoneRow}>
                    <Switch
                      value={z.enabled}
                      onValueChange={(v) => updateSafeZone(z.id, { enabled: v })}
                      trackColor={{ false: Colors.bgBorder, true: Colors.primary + '55' }}
                      thumbColor={z.enabled ? Colors.primary : Colors.textMuted}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.zoneName}>{z.name}</Text>
                      <Text style={styles.zoneHours}>
                        {String(z.startHour).padStart(2, '0')}:00 –{' '}
                        {String(z.endHour).padStart(2, '0')}:00
                        {!z.enabled && '  (disabled)'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => requirePin(() => setEditingZone(z))}
                      style={styles.zoneEdit}
                    >
                      <Text style={styles.zoneEditText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDeleteZone(z.id, z.name)}>
                      <Text style={styles.zoneDelete}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </React.Fragment>
              ))
            )}
          </Card>
        </View>

        {/* PIN Security */}
        <View style={styles.section}>
          <SectionHeader title="PIN Security" />
          <Card>
            {([
              { icon: '🏠', layer: 'dashboard' as PINLayer, label: 'Dashboard PIN', sub: 'Quick access PIN' },
              { icon: '📊', layer: 'logs'      as PINLayer, label: 'Logs PIN',       sub: 'Protects activity history' },
              { icon: '🔒', layer: 'vault'     as PINLayer, label: 'Vault PIN',      sub: 'Protects intruder photos' },
              { icon: '⚙️', layer: 'settings'  as PINLayer, label: 'Settings PIN',   sub: 'Protects this screen' },
              { icon: '🎭', layer: 'decoy'     as PINLayer, label: 'Decoy PIN',      sub: 'Opens fake empty dashboard' },
            ]).map((p, i) => (
              <React.Fragment key={p.layer}>
                {i > 0 && <Divider />}
                <SettingRow
                  icon={p.icon}
                  title={p.label}
                  subtitle={p.sub}
                  badge={p.layer === 'decoy' ? 'SAFETY' : undefined}
                  badgeVariant="warning"
                  onPress={() => handleChangePIN(p.layer, p.label)}
                />
              </React.Fragment>
            ))}
          </Card>
        </View>

        {/* Devices */}
        <View style={styles.section}>
          <SectionHeader title="Connected Devices" />
          <Card>
            <SettingRow
              icon="📱"
              title="Manage Devices"
              subtitle="View and revoke trusted devices"
              onPress={() => requirePin(() => Alert.alert('Devices', 'Device manager coming in next update.'))}
            />
          </Card>
        </View>

        {/* Account */}
        <View style={styles.section}>
          <SectionHeader title="Account" />
          <Card>
            <SettingRow
              icon="🔐"
              title="Provider"
              subtitle={`Signed in with ${user?.provider === 'apple' ? 'Apple' : 'Google'}`}
              badge={user?.provider === 'apple' ? 'APPLE' : 'GOOGLE'}
              badgeVariant="neutral"
            />
            <Divider />
            <SettingRow
              icon="🚪"
              title="Sign Out"
              danger
              onPress={handleSignOut}
            />
          </Card>
        </View>

        <Text style={styles.version}>PhantomShield v1.0.0</Text>
      </ScrollView>

      {/* Safe zone modals */}
      <SafeZoneModal
        visible={showAddZone}
        onClose={() => setShowAddZone(false)}
        onSave={(z) => addSafeZone({ ...z, id: `zone_${Date.now()}` })}
      />
      {editingZone && (
        <SafeZoneModal
          visible
          existing={editingZone}
          onClose={() => setEditingZone(undefined)}
          onSave={(z) => {
            updateSafeZone(editingZone.id, z);
            setEditingZone(undefined);
          }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  scroll:    { flex: 1, backgroundColor: Colors.bg },
  container: { padding: Spacing.lg, paddingTop: 60, paddingBottom: 48, gap: Spacing.md },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  title:     { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.textPrimary },
  accountCard: { padding: Spacing.md },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: Colors.primaryGlow, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.primary + '44',
  },
  avatarText:   { fontSize: FontSize.xl, color: Colors.primary, fontWeight: '700' },
  accountInfo:  { flex: 1 },
  accountName:  { fontSize: FontSize.md, fontWeight: '600', color: Colors.textPrimary },
  accountEmail: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  section: { gap: 8 },
  settingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  settingIcon: { fontSize: 18, width: 26, textAlign: 'center' },
  settingInfo: { flex: 1 },
  settingTitle:{ fontSize: FontSize.md, color: Colors.textPrimary, fontWeight: '500' },
  settingSubtitle: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  arrow: { fontSize: 20, color: Colors.textMuted },
  emptyZone: {
    fontSize: FontSize.sm, color: Colors.textSecondary,
    textAlign: 'center', paddingVertical: Spacing.md, lineHeight: 20,
  },
  zoneRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  zoneName:   { fontSize: FontSize.md, fontWeight: '600', color: Colors.textPrimary },
  zoneHours:  { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  zoneEdit:   { paddingHorizontal: 8, paddingVertical: 4 },
  zoneEditText:{ fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600' },
  zoneDelete: { fontSize: 16, color: Colors.accent, paddingHorizontal: 4 },
  version: {
    fontSize: FontSize.xs, color: Colors.textMuted,
    textAlign: 'center', marginTop: Spacing.sm,
  },
  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  modalBox: {
    backgroundColor: Colors.bgCard, borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl, padding: Spacing.lg, gap: 12,
    borderTopWidth: 1, borderColor: Colors.bgBorder,
  },
  modalTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary },
  modalSub:   { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  fieldLabel: { fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 },
  fieldInput: {
    backgroundColor: Colors.bgElevated, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.bgBorder,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    fontSize: FontSize.md, color: Colors.textPrimary,
  },
  hourRow:   { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  hourSep:   { fontSize: FontSize.xl, color: Colors.textMuted, marginBottom: 12 },
  hourHint:  { fontSize: FontSize.xs, color: Colors.textMuted, lineHeight: 18 },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 4, paddingBottom: 16 },
});
