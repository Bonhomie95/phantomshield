import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Modal,
} from 'react-native';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { shareCatch } from '@/services/share';
import { usePhantomStore } from '@/stores/phantom';
import { Card, Badge, Button, SectionHeader, Divider } from '@/components/ui/components';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { deleteIntruderPhoto, clearAllIntruderPhotos } from '@/services/camera';
import { IntruderPhoto } from '@/constants/types';

export default function VaultScreen() {
  const { intruderPhotos, recentActivity, unlockEvents, unlockedLayers, clearLogs } =
    usePhantomStore();
  const [preview, setPreview] = useState<IntruderPhoto | null>(null);
  const isUnlocked = unlockedLayers.includes('vault');

  if (!isUnlocked) {
    return (
      <View style={styles.locked}>
        <Text style={styles.lockIcon}>🔒</Text>
        <Text style={styles.lockTitle}>Secure Vault</Text>
        <Text style={styles.lockSub}>
          Intruder photos and evidence files are stored here. Enter your Vault PIN.
        </Text>
        <Button
          label="Unlock Vault"
          onPress={() =>
            router.push({ pathname: '/pin-gate', params: { layer: 'vault', redirect: '/(tabs)/vault' } })
          }
          variant="primary"
          style={styles.unlockBtn}
        />
      </View>
    );
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleDeletePhoto = (photo: IntruderPhoto) => {
    Alert.alert('Delete Photo', 'Permanently delete this intruder photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteIntruderPhoto(photo.imageUri);
          // Remove from store
          usePhantomStore.setState((s) => ({
            intruderPhotos: s.intruderPhotos.filter((p) => p.id !== photo.id),
          }));
          if (preview?.id === photo.id) setPreview(null);
        },
      },
    ]);
  };

  const handleSharePhoto = async (photo: IntruderPhoto) => {
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert('Sharing not available', 'Your device does not support sharing files.');
      return;
    }
    // Branded share (viral caption + analytics) — turns a catch into installs.
    await shareCatch(photo.imageUri);
  };

  const handleClearAll = () => {
    Alert.alert(
      'Clear All Data',
      'This permanently deletes all activity logs, unlock events, and intruder photos from this device. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Everything',
          style: 'destructive',
          onPress: async () => {
            await clearAllIntruderPhotos();
            clearLogs();
          },
        },
      ],
    );
  };

  const triggerLabel: Record<IntruderPhoto['trigger'], string> = {
    wrong_pin:          'Wrong PIN entered',
    failed_biometric:   'Failed biometric',
    unauthorized_open:  'Unauthorized open attempt',
    motion:             'Phone moved (Guard Mode)',
    charger_unplugged:  'Charger unplugged (Guard Mode)',
  };

  const totalScreenTimeSec = recentActivity.reduce((s, e) => s + e.durationSec, 0);
  const anomalyCount = [
    ...recentActivity.filter((e) => e.isAnomaly),
    ...unlockEvents.filter((e) => e.isAnomaly),
  ].length;

  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Secure Vault</Text>
          <Badge label="ENCRYPTED" variant="green" />
        </View>

        {/* Summary */}
        <Card style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <SummaryItem value={intruderPhotos.length} label="Photos" accent={intruderPhotos.length > 0} />
            <View style={styles.sep} />
            <SummaryItem value={anomalyCount} label="Anomalies" accent={anomalyCount > 0} />
            <View style={styles.sep} />
            <SummaryItem value={recentActivity.length} label="Events" />
            <View style={styles.sep} />
            <SummaryItem value={Math.round(totalScreenTimeSec / 60)} label="Mins" />
          </View>
        </Card>

        {/* Intruder Snapshots */}
        <SectionHeader
          title="Intruder Snapshots"
          subtitle={
            intruderPhotos.length === 0 ? 'None captured yet' : `${intruderPhotos.length} captured`
          }
        />

        {intruderPhotos.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>📸</Text>
            <Text style={styles.emptyTitle}>No snapshots yet</Text>
            <Text style={styles.emptyText}>
              When someone enters the wrong PIN, PhantomShield silently captures a front-camera photo
              and stores it here.
            </Text>
          </Card>
        ) : (
          <View style={styles.photoGrid}>
            {intruderPhotos.map((photo) => (
              <TouchableOpacity
                key={photo.id}
                onPress={() => setPreview(photo)}
                activeOpacity={0.8}
                style={styles.photoThumbWrap}
              >
                <Image source={{ uri: photo.imageUri }} style={styles.photoThumb} />
                <View style={styles.photoThumbOverlay}>
                  <Text style={styles.photoThumbTime}>
                    {new Date(photo.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                  <Text style={styles.photoThumbDate}>
                    {new Date(photo.timestamp).toLocaleDateString()}
                  </Text>
                </View>
                {photo.isAnomaly && (
                  <View style={styles.anomalyDot} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Unlock event log */}
        {unlockEvents.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Unlock Events"
              subtitle={`${unlockEvents.filter((e) => e.isAnomaly).length} suspicious`}
            />
            <Card>
              {unlockEvents.slice(0, 10).map((ev, i) => (
                <React.Fragment key={ev.id}>
                  {i > 0 && <Divider />}
                  <View style={styles.unlockRow}>
                    <View
                      style={[
                        styles.unlockDot,
                        { backgroundColor: ev.isAnomaly ? Colors.accent : Colors.success },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.unlockTime}>
                        {new Date(ev.timestamp).toLocaleString()}
                      </Text>
                      {ev.isAnomaly && ev.anomalyReason && (
                        <Text style={styles.unlockReason}>{ev.anomalyReason}</Text>
                      )}
                    </View>
                    {ev.isAnomaly && <Text style={{ fontSize: 14 }}>⚠️</Text>}
                  </View>
                </React.Fragment>
              ))}
              {unlockEvents.length > 10 && (
                <Text style={styles.moreLabel}>+{unlockEvents.length - 10} more</Text>
              )}
            </Card>
          </View>
        )}

        {/* Export */}
        <View style={styles.section}>
          <SectionHeader title="Evidence Export" />
          <Card style={styles.exportCard}>
            <View style={styles.exportRow}>
              <Text style={styles.exportIcon}>📄</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.exportTitle}>PDF Report</Text>
                <Text style={styles.exportSub}>Timeline, app usage, anomaly flags</Text>
              </View>
              <Badge label="FREE" variant="neutral" />
            </View>
            <Divider />
            <View style={styles.exportRow}>
              <Text style={styles.exportIcon}>🔐</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.exportTitle}>Encrypted .pshield</Text>
                <Text style={styles.exportSub}>AES-256 with passphrase — Elite only</Text>
              </View>
              <Badge label="ELITE" variant="cyan" />
            </View>
            <Button
              label="Export Logs"
              onPress={() =>
                Alert.alert(
                  'Export Logs',
                  'Choose export format',
                  [
                    {
                      text: 'PDF Report',
                      onPress: () =>
                        Alert.alert('Coming Soon', 'PDF export will be available in the next release.'),
                    },
                    {
                      text: 'Encrypted .pshield',
                      onPress: () =>
                        Alert.alert('Upgrade Required', 'Encrypted export requires Phantom Elite.'),
                    },
                    { text: 'Cancel', style: 'cancel' },
                  ],
                )
              }
              variant="secondary"
              style={{ marginTop: Spacing.md }}
            />
          </Card>
        </View>

        {/* Danger zone */}
        <View style={styles.section}>
          <SectionHeader title="Danger Zone" />
          <Card style={styles.dangerCard}>
            <Text style={styles.dangerTitle}>Clear All Data</Text>
            <Text style={styles.dangerSub}>
              Permanently deletes all activity logs, unlock events, and intruder photos from this
              device.
            </Text>
            <Button
              label="Clear All Logs"
              onPress={handleClearAll}
              variant="danger"
              style={{ marginTop: Spacing.md }}
            />
          </Card>
        </View>
      </ScrollView>

      {/* Full-screen photo preview modal */}
      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <View style={styles.modalBg}>
          <TouchableOpacity style={styles.modalClose} onPress={() => setPreview(null)}>
            <Text style={styles.modalCloseText}>✕</Text>
          </TouchableOpacity>

          {preview && (
            <>
              <Image source={{ uri: preview.imageUri }} style={styles.modalImage} resizeMode="contain" />
              <View style={styles.modalInfo}>
                <Text style={styles.modalTime}>{new Date(preview.timestamp).toLocaleString()}</Text>
                <Text style={styles.modalTrigger}>{triggerLabel[preview.trigger]}</Text>
              </View>
              <View style={styles.modalActions}>
                <Button
                  label="Share"
                  onPress={() => handleSharePhoto(preview)}
                  variant="secondary"
                  style={{ flex: 1 }}
                />
                <Button
                  label="Delete"
                  onPress={() => handleDeletePhoto(preview)}
                  variant="danger"
                  style={{ flex: 1 }}
                />
              </View>
            </>
          )}
        </View>
      </Modal>
    </>
  );
}

function SummaryItem({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={[styles.summaryValue, accent && { color: Colors.accent }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll:    { flex: 1, backgroundColor: Colors.bg },
  container: { padding: Spacing.lg, paddingTop: 60, paddingBottom: 48, gap: Spacing.md },
  locked: {
    flex: 1, backgroundColor: Colors.bg, alignItems: 'center',
    justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md,
  },
  lockIcon:  { fontSize: 52 },
  lockTitle: { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.textPrimary },
  lockSub:   { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  unlockBtn: { width: '80%', marginTop: Spacing.sm },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  title:     { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.textPrimary },
  summaryCard: { padding: Spacing.md },
  summaryRow:  { flexDirection: 'row', alignItems: 'center' },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue:{ fontSize: FontSize.xl, fontWeight: '700', color: Colors.primary },
  summaryLabel:{ fontSize: 10, color: Colors.textSecondary, marginTop: 2 },
  sep: { width: 1, height: 32, backgroundColor: Colors.bgBorder },
  emptyCard:  { alignItems: 'center', padding: Spacing.xl, gap: 8 },
  emptyIcon:  { fontSize: 32 },
  emptyTitle: { fontSize: FontSize.md, fontWeight: '600', color: Colors.textPrimary },
  emptyText:  { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  photoGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoThumbWrap: {
    width: '31.5%', aspectRatio: 1, borderRadius: Radius.md,
    overflow: 'hidden', position: 'relative',
    borderWidth: 1, borderColor: Colors.accent + '44',
  },
  photoThumb:    { width: '100%', height: '100%' },
  photoThumbOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.65)', padding: 4,
  },
  photoThumbTime: { fontSize: 10, color: '#fff', fontWeight: '600' },
  photoThumbDate: { fontSize: 9,  color: 'rgba(255,255,255,0.7)' },
  anomalyDot: {
    position: 'absolute', top: 6, right: 6,
    width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.accent,
  },
  section: { gap: 8 },
  unlockRow:  { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  unlockDot:  { width: 8, height: 8, borderRadius: 4 },
  unlockTime: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: '500' },
  unlockReason: { fontSize: FontSize.xs, color: Colors.accent, marginTop: 2 },
  moreLabel:  { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center', paddingVertical: 8 },
  exportCard: { padding: Spacing.md, gap: 12 },
  exportRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  exportIcon: { fontSize: 20 },
  exportTitle:{ fontSize: FontSize.md, fontWeight: '600', color: Colors.textPrimary },
  exportSub:  { fontSize: FontSize.xs, color: Colors.textSecondary },
  dangerCard: { borderColor: Colors.accent + '44', padding: Spacing.md },
  dangerTitle:{ fontSize: FontSize.md, fontWeight: '700', color: Colors.accent },
  dangerSub:  { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 4, lineHeight: 20 },
  // Modal
  modalBg: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.94)',
    justifyContent: 'center', padding: Spacing.lg, gap: Spacing.md,
  },
  modalClose:     { position: 'absolute', top: 56, right: 24, zIndex: 10, padding: 8 },
  modalCloseText: { fontSize: 22, color: Colors.textSecondary },
  modalImage:     { width: '100%', height: 340, borderRadius: Radius.lg },
  modalInfo:      { alignItems: 'center', gap: 4 },
  modalTime:      { fontSize: FontSize.md, fontWeight: '600', color: Colors.textPrimary },
  modalTrigger:   { fontSize: FontSize.sm, color: Colors.accent },
  modalActions:   { flexDirection: 'row', gap: 12 },
});
