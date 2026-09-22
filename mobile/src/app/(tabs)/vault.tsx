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
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { shareCatch } from '@/services/share';
import { usePhantomStore } from '@/stores/phantom';
import { Card, Badge, Button, SectionHeader, Divider } from '@/components/ui/components';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { deleteIntruderPhoto, clearAllIntruderPhotos } from '@/services/camera';
import { exportEvidence, exportReportPdf, ExportResult } from '@/services/export';
import { track } from '@/services/analytics';
import { IntruderPhoto } from '@/constants/types';

export default function VaultScreen() {
  // Intruder photos and evidence must not be screenshottable or screen-recordable.
  usePreventScreenCapture('vault');
  const { intruderPhotos, guardEvents, unlockEvents, clearLogs, photoQuotaReached, intruderSnapshotEnabled } =
    usePhantomStore();
  const [preview, setPreview] = useState<IntruderPhoto | null>(null);
  const [exporting, setExporting] = useState<'pdf' | 'json' | null>(null);

  const handleExport = async (kind: 'pdf' | 'json') => {
    setExporting(kind);
    try {
      const result: ExportResult = kind === 'pdf' ? await exportReportPdf() : await exportEvidence();
      if (result.ok) {
        // The share sheet already confirmed it; nothing more to say.
      } else if (result.reason === 'upgrade_required') {
        Alert.alert(
          'Evidence export is a Starter feature',
          'Upgrade to export a complete, verifiable record of everything captured on this device.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'See plans', onPress: () => router.push({ pathname: '/paywall', params: { source: 'vault' } }) },
          ],
        );
      } else if (result.reason === 'empty') {
        Alert.alert('Nothing to export', 'No events have been recorded on this device yet.');
      } else {
        Alert.alert('Export failed', 'The evidence file could not be created. Please try again.');
      }
    } finally {
      setExporting(null);
    }
  };

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleDeletePhoto = (photo: IntruderPhoto) => {
    Alert.alert('Delete Photo', 'Permanently delete this intruder photo?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          // An alert can outlive the lock: never act for whoever holds a locked phone.
          if (!usePhantomStore.getState().isAppUnlocked) return;
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
      'This permanently deletes every photo, Guard Mode event and PIN attempt stored on this phone. Anything backed up to your account stays there. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Everything',
          style: 'destructive',
          onPress: async () => {
            // An alert can outlive the lock: never act for whoever holds a locked phone.
            if (!usePhantomStore.getState().isAppUnlocked) return;
            await clearAllIntruderPhotos();
            clearLogs();
          },
        },
      ],
    );
  };

  const triggerLabel: Record<IntruderPhoto['trigger'], string> = {
    wrong_pin:            'Wrong PIN entered',
    failed_biometric:     'Failed biometric',
    unauthorized_open:    'Unauthorized open attempt',
    motion:               'Phone moved (Guard Mode)',
    charger_unplugged:    'Charger unplugged (Guard Mode)',
    charger_connected:    'Charger plugged in (Guard Mode)',
    charger_disconnected: 'Charger unplugged (Guard Mode)',
    app_switch:           'Another app opened (Guard Mode)',
    disarm_attempt:       'Stop attempt (Guard Mode)',
    pocket:               'Taken out of a pocket (Guard Mode)',
  };

  const failedPins = unlockEvents.filter((e) => e.isAnomaly).length;

  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Evidence</Text>
          {/* Photos live in the app's private sandbox (OS file protection), not
              app-level encrypted — so the honest label is "PRIVATE", not
              "ENCRYPTED". The export below is a plain JSON evidence file with an
              integrity digest; it is deliberately NOT described as encrypted. */}
          <Badge label="PRIVATE" variant="green" />
        </View>

        {/* The server tells us when it recorded an event but declined to keep
            the photo. That signal was computed and discarded; surfacing it is
            both honest (the image is NOT in the cloud) and the single best-timed
            upgrade prompt in the product. */}
        {photoQuotaReached && (
          <TouchableOpacity
            style={styles.quotaBanner}
            activeOpacity={0.85}
            onPress={() => {
              track('limit_reached_cta', { limit: 'cloud_photos' });
              router.push({ pathname: '/paywall', params: { source: 'photo_quota' } });
            }}
          >
            <Ionicons name="cloud-offline-outline" size={22} color={Colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.quotaTitle}>Monthly photo backup limit reached</Text>
              <Text style={styles.quotaSub}>
                New events are still recorded, but their photos stay on this device only — if it&apos;s
                lost, they&apos;re gone. Upgrade to keep every photo backed up.
              </Text>
            </View>
            <Text style={styles.quotaArrow}>›</Text>
          </TouchableOpacity>
        )}

        {/* Summary */}
        <Card style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <SummaryItem value={intruderPhotos.length} label="Photos" accent={intruderPhotos.length > 0} />
            <View style={styles.sep} />
            <SummaryItem value={guardEvents.length} label="Guard events" />
            <View style={styles.sep} />
            <SummaryItem value={failedPins} label="Wrong PINs" accent={failedPins > 0} />
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
            <Ionicons name="camera-outline" size={32} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No snapshots yet</Text>
            <Text style={styles.emptyText}>
              {intruderSnapshotEnabled
                ? 'When someone enters a wrong PIN or triggers Guard Mode, the photo appears here.'
                : 'Intruder photos are off. Turn them on in Settings to capture a photo when someone enters a wrong PIN.'}
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
              title="PIN attempts"
              subtitle={`${failedPins} wrong`}
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
                    {ev.isAnomaly && <Ionicons name="warning-outline" size={16} color={Colors.accent} />}
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
          <SectionHeader title="Report for police or insurance" />
          <Card style={styles.exportCard}>
            <View style={styles.exportRow}>
              <Ionicons name="document-text-outline" size={22} color={Colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.exportTitle}>Evidence report (PDF)</Text>
                <Text style={styles.exportSub}>
                  Every photo with its time, place and a map link, plus a SHA-256 integrity code so
                  any later change can be detected.
                </Text>
              </View>
            </View>
            <Button
              label={exporting === 'pdf' ? 'Preparing…' : 'Create PDF report'}
              onPress={() => handleExport('pdf')}
              disabled={!!exporting}
              variant="primary"
              style={{ marginTop: Spacing.md }}
            />
            <Button
              label={exporting === 'json' ? 'Preparing…' : 'Export raw data (JSON)'}
              onPress={() => handleExport('json')}
              disabled={!!exporting}
              variant="ghost"
            />
          </Card>
        </View>

        {/* Danger zone */}
        <View style={styles.section}>
          <SectionHeader title="Danger Zone" />
          <Card style={styles.dangerCard}>
            <Text style={styles.dangerTitle}>Clear All Data</Text>
            <Text style={styles.dangerSub}>
              Permanently deletes every photo, Guard Mode event and PIN attempt stored on this
              phone.
            </Text>
            <Button
              label="Delete evidence on this phone"
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
          <TouchableOpacity style={styles.modalClose} onPress={() => setPreview(null)} accessibilityRole="button" accessibilityLabel="Close photo" hitSlop={12}>
            <Ionicons name="close" size={26} color={Colors.textSecondary} />
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
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  title:     { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.textPrimary },
  quotaBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.accentGlow, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.accent + '55', padding: Spacing.md,
  },
  quotaTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary },
  quotaSub:   { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2, lineHeight: 17 },
  quotaArrow: { fontSize: 22, color: Colors.textSecondary },
  summaryCard: { padding: Spacing.md },
  summaryRow:  { flexDirection: 'row', alignItems: 'center' },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue:{ fontSize: FontSize.xl, fontWeight: '700', color: Colors.primary },
  summaryLabel:{ fontSize: 10, color: Colors.textSecondary, marginTop: 2 },
  sep: { width: 1, height: 32, backgroundColor: Colors.bgBorder },
  emptyCard:  { alignItems: 'center', padding: Spacing.xl, gap: 8 },
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
  modalImage:     { width: '100%', height: 340, borderRadius: Radius.lg },
  modalInfo:      { alignItems: 'center', gap: 4 },
  modalTime:      { fontSize: FontSize.md, fontWeight: '600', color: Colors.textPrimary },
  modalTrigger:   { fontSize: FontSize.sm, color: Colors.accent },
  modalActions:   { flexDirection: 'row', gap: 12 },
});
