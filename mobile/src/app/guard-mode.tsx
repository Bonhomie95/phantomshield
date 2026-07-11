import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Switch } from 'react-native';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { PinPad } from '@/components/PinPad';
import { usePhantomStore } from '@/stores/phantom';
import { startGuard, GuardHandle, GuardTrigger } from '@/services/guard';
import { startSiren, stopSiren } from '@/services/alarm';
import { saveIntruderPhoto } from '@/services/camera';
import { captureLocation } from '@/services/location';
import { sendIntruderAlert, presentArmedNotification, dismissNotification } from '@/services/notifications';
import { uploadIntruderEvent } from '@/services/api';
import * as pinVault from '@/services/pinVault';
import { IntruderPhoto } from '@/constants/types';
import { track } from '@/services/analytics';
import { maybeAskForReview } from '@/services/rating';

// 'setpin' is shown on first use when no PIN exists yet — Guard Mode must be
// protected by a PIN so an intruder can't just disarm it.
type Phase = 'setpin' | 'confirmpin' | 'arming' | 'armed' | 'triggered' | 'records';
type Sensitivity = 'low' | 'medium' | 'high';

const SENSITIVITY_VALUE: Record<Sensitivity, number> = { low: 0.25, medium: 0.6, high: 0.9 };
const ARM_DELAY_SEC = 5;

// The layer Guard Mode's own PIN is stored under when the user has no PIN yet.
const GUARD_PIN_LAYER = 'settings' as const;

const TRIGGER_LABEL: Record<GuardTrigger, string> = {
  motion: 'Your phone was moved',
  charger_unplugged: 'The charger was unplugged',
};

export default function GuardModeScreen() {
  const { addIntruderPhoto, guardBackgroundMode, setGuardBackgroundMode } = usePhantomStore();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [phase, setPhase] = useState<Phase>('arming');
  const [countdown, setCountdown] = useState(ARM_DELAY_SEC);
  const [sensitivity, setSensitivity] = useState<Sensitivity>('medium');
  const [triggerReason, setTriggerReason] = useState<string>('');
  const [firstPin, setFirstPin] = useState('');
  // Everything captured during THIS arm session — shown when the user stops.
  const [sessionRecords, setSessionRecords] = useState<IntruderPhoto[]>([]);
  const guardRef = useRef<GuardHandle | null>(null);
  const armedNotifId = useRef<string | null>(null);

  // ── First run: require a PIN before Guard Mode can be used ──────────────────
  useEffect(() => {
    (async () => {
      const hasPin = await pinVault.hasAnyPin();
      if (!hasPin) setPhase('setpin');
    })();
  }, []);

  // Ask for camera up front so the silent capture works the instant it trips.
  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, [permission?.granted, requestPermission]);

  // ── Arming countdown ────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'arming') return;
    if (countdown <= 0) {
      setPhase('armed');
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  // ── Start sensors once armed ────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'armed') return;
    track('guard_armed', { sensitivity, background: guardBackgroundMode });

    // Keep the screen (and therefore the JS sensor loop) alive while armed.
    // This is what lets stealth mode keep watching without a notification.
    activateKeepAwakeAsync('guard-mode').catch(() => {});

    // Only surface a persistent notification in background mode. Stealth mode
    // shows nothing, so an intruder can't tell Guard Mode is running.
    if (guardBackgroundMode) {
      presentArmedNotification().then((id) => { armedNotifId.current = id; });
    }

    guardRef.current = startGuard({
      sensitivity: SENSITIVITY_VALUE[sensitivity],
      onTrigger: handleTrigger,
    });
    return () => guardRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, sensitivity]);

  // ── Trigger — the alarm goes off ────────────────────────────────────────────
  const handleTrigger = useCallback(async (trigger: GuardTrigger) => {
    guardRef.current?.stop();
    setTriggerReason(TRIGGER_LABEL[trigger]);
    setPhase('triggered');
    track('guard_triggered', { trigger });

    void startSiren();

    // Capture evidence: front-camera selfie + location, then report it.
    try {
      const [photo, location] = await Promise.all([
        cameraRef.current?.takePictureAsync({ quality: 0.5, shutterSound: false }).catch(() => null),
        captureLocation().catch(() => null),
      ]);

      const eventId = `guard_${Date.now()}`;
      let savedUri: string | undefined;
      if (photo?.uri) savedUri = await saveIntruderPhoto(photo.uri).catch(() => undefined);

      if (savedUri) {
        const record: IntruderPhoto = {
          id: eventId,
          timestamp: new Date().toISOString(),
          imageUri: savedUri,
          trigger,
          isAnomaly: true,
          anomalyReason: TRIGGER_LABEL[trigger],
          latitude: location?.lat,
          longitude: location?.lng,
        };
        addIntruderPhoto(record);
        setSessionRecords((prev) => [record, ...prev]);
      }

      uploadIntruderEvent({
        id: eventId,
        timestamp: Date.now(),
        pinLayer: 'guard',
        failedAttempt: 1,
        location: location ?? undefined,
      }).catch(() => {});

      sendIntruderAlert('Guard Mode', 1).catch(() => {});
    } catch {
      // Never let capture failure stop the alarm.
    }
  }, [addIntruderPhoto]);

  // ── Disarm — biometric first, PIN fallback ──────────────────────────────────
  const [showPinFallback, setShowPinFallback] = useState(false);

  // Tear down sensors/siren/notification/keep-awake, then show the session records.
  const finishDisarm = useCallback(() => {
    stopSiren();
    guardRef.current?.stop();
    deactivateKeepAwake('guard-mode');
    void dismissNotification(armedNotifId.current);
    armedNotifId.current = null;
    track('guard_disarmed', { incidents: sessionRecords.length });
    // If the alarm actually fired, they just watched the product work — best
    // possible moment to ask for a store rating.
    if (phase === 'triggered') void maybeAskForReview();
    setShowPinFallback(false);
    setPhase('records');
  }, [phase, sessionRecords.length]);

  const attemptDisarm = useCallback(async () => {
    const hasHw = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (hasHw && enrolled) {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Verify your identity to disarm PhantomShield',
        cancelLabel: 'Cancel',
      });
      if (res.success) return finishDisarm();
    }
    setShowPinFallback(true);
  }, [finishDisarm]);

  // Verify against any configured PIN. A PIN always exists here because the
  // 'setpin' phase forces one before arming.
  const verifyPin = useCallback(async (pin: string) => {
    for (const layer of ['settings', 'dashboard', 'vault', 'logs', 'decoy'] as const) {
      if (await pinVault.hasPin(layer)) {
        if (await pinVault.verifyPin(layer, pin)) return true;
      }
    }
    return false;
  }, []);

  // ── First-run PIN setup ─────────────────────────────────────────────────────
  const handleSetPin = useCallback((pin: string) => {
    setFirstPin(pin);
    setPhase('confirmpin');
  }, []);

  const handleConfirmPin = useCallback(async (pin: string) => {
    if (pin !== firstPin) {
      setFirstPin('');
      setPhase('setpin');
      return;
    }
    await pinVault.setPin(GUARD_PIN_LAYER, pin);
    setFirstPin('');
    setCountdown(ARM_DELAY_SEC);
    setPhase('arming');
  }, [firstPin]);

  // Clean up if the screen is torn down while still armed.
  useEffect(() => {
    return () => {
      stopSiren();
      guardRef.current?.stop();
      deactivateKeepAwake('guard-mode');
      void dismissNotification(armedNotifId.current);
    };
  }, []);

  // Keep the camera warm from arming onward so the first capture is instant.
  const cameraEnabled = phase === 'arming' || phase === 'armed' || phase === 'triggered';

  // ── First-run PIN setup screen ──────────────────────────────────────────────
  if (phase === 'setpin' || phase === 'confirmpin') {
    return (
      <View style={s.container}>
        <Text style={s.shield}>🔐</Text>
        <PinPad
          title={phase === 'confirmpin' ? 'Confirm your PIN' : 'Set a PIN for Guard Mode'}
          subtitle={
            phase === 'confirmpin'
              ? 'Enter the same 4-digit PIN again.'
              : 'Guard Mode needs a PIN so only you can disarm the alarm.'
          }
          mode="set"
          onSuccess={phase === 'confirmpin' ? handleConfirmPin : handleSetPin}
        />
        <TouchableOpacity onPress={() => router.back()} style={s.cancel}>
          <Text style={s.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Records screen (shown when the user stops Guard Mode) ────────────────────
  if (phase === 'records') {
    return (
      <ScrollView style={s.recordsScroll} contentContainerStyle={s.recordsContainer}>
        <Text style={s.shield}>{sessionRecords.length ? '📸' : '✅'}</Text>
        <Text style={s.title}>
          {sessionRecords.length ? 'Guard Mode Report' : 'All Clear'}
        </Text>
        <Text style={s.sub}>
          {sessionRecords.length
            ? `${sessionRecords.length} incident${sessionRecords.length > 1 ? 's' : ''} captured this session.`
            : 'No incidents were detected while Guard Mode was armed.'}
        </Text>

        <View style={s.recordList}>
          {sessionRecords.map((r) => (
            <View key={r.id} style={s.recordRow}>
              <Image source={{ uri: r.imageUri }} style={s.recordThumb} />
              <View style={{ flex: 1 }}>
                <Text style={s.recordReason}>{r.anomalyReason}</Text>
                <Text style={s.recordTime}>{new Date(r.timestamp).toLocaleString()}</Text>
                {r.latitude != null && r.longitude != null && (
                  <Text style={s.recordGeo}>
                    📍 {r.latitude.toFixed(4)}, {r.longitude.toFixed(4)}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>

        <Text style={s.recordsHint}>
          All captures are also saved in your Vault.
        </Text>

        <TouchableOpacity style={s.disarmBtn} onPress={() => router.back()} activeOpacity={0.85}>
          <Text style={s.disarmText}>Done</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── Alarm screen ────────────────────────────────────────────────────────────
  if (phase === 'triggered') {
    return (
      <View style={[s.container, s.alarmBg]}>
        <HiddenCamera enabled={cameraEnabled} cameraRef={cameraRef} />
        {showPinFallback ? (
          <PinPad
            title="Enter PIN to disarm"
            subtitle="Enter your PhantomShield PIN to stop the alarm."
            verify={verifyPin}
            onSuccess={finishDisarm}
          />
        ) : (
          <>
            <Text style={s.alarmSiren}>🚨</Text>
            <Text style={s.alarmTitle}>ALARM</Text>
            <Text style={s.alarmReason}>{triggerReason}</Text>
            <Text style={s.alarmSub}>A photo and location were captured.</Text>
            <TouchableOpacity style={s.disarmBtn} onPress={attemptDisarm} activeOpacity={0.85}>
              <Text style={s.disarmText}>Disarm</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  // ── Arming / armed screen ───────────────────────────────────────────────────
  return (
    <View style={s.container}>
      <HiddenCamera enabled={cameraEnabled} cameraRef={cameraRef} />
      {showPinFallback ? (
        <PinPad
          title="Enter PIN to disarm"
          subtitle="Enter your PhantomShield PIN to stop watching."
          verify={verifyPin}
          onSuccess={finishDisarm}
        />
      ) : (
        <>
          <Text style={s.shield}>🛡</Text>

          {phase === 'arming' ? (
            <>
              <Text style={s.title}>Arming in {countdown}…</Text>
              <Text style={s.sub}>Put your phone down. The alarm triggers if it&apos;s moved or the charger is pulled.</Text>
              <View style={s.sensRow}>
                {(['low', 'medium', 'high'] as Sensitivity[]).map((lvl) => (
                  <TouchableOpacity
                    key={lvl}
                    style={[s.sensChip, sensitivity === lvl && s.sensChipActive]}
                    onPress={() => setSensitivity(lvl)}
                  >
                    <Text style={[s.sensText, sensitivity === lvl && s.sensTextActive]}>{lvl}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Stealth vs background mode */}
              <View style={s.modeRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.modeTitle}>
                    {guardBackgroundMode ? 'Background mode' : 'Stealth mode'}
                  </Text>
                  <Text style={s.modeDesc}>
                    {guardBackgroundMode
                      ? 'Keeps watching if you leave the app. Shows a small notification (required by the OS).'
                      : 'No notification — invisible to an intruder. Keep this screen on; watching stops if the app is closed.'}
                  </Text>
                </View>
                <Switch
                  value={guardBackgroundMode}
                  onValueChange={setGuardBackgroundMode}
                  trackColor={{ true: Colors.primary, false: Colors.bgBorder }}
                />
              </View>

              <TouchableOpacity onPress={() => router.back()} style={s.cancel}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={s.armedPulse}>
                <View style={s.armedDot} />
              </View>
              <Text style={s.title}>Armed &amp; Watching</Text>
              <Text style={s.sub}>
                Sensitivity: {sensitivity} · {guardBackgroundMode ? 'Background' : 'Stealth'}.
                {guardBackgroundMode ? ' Running quietly.' : ' Keep this screen open.'} Disarm to stop.
              </Text>
              <TouchableOpacity style={s.disarmBtn} onPress={attemptDisarm} activeOpacity={0.85}>
                <Text style={s.disarmText}>Disarm</Text>
              </TouchableOpacity>
            </>
          )}
        </>
      )}
    </View>
  );
}

function HiddenCamera({ enabled, cameraRef }: { enabled: boolean; cameraRef: React.RefObject<CameraView | null> }) {
  if (!enabled) return null;
  return <CameraView ref={cameraRef} facing="front" style={s.hiddenCamera} />;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  alarmBg: { backgroundColor: '#2A0410' },
  hiddenCamera: { position: 'absolute', width: 1, height: 1, top: -10, left: -10, opacity: 0 },
  shield: { fontSize: 56 },
  title: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, paddingHorizontal: Spacing.md },
  sensRow: { flexDirection: 'row', gap: 8, marginTop: Spacing.md },
  sensChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.bgBorder, backgroundColor: Colors.bgCard },
  sensChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryGlow },
  sensText: { fontSize: FontSize.sm, color: Colors.textSecondary, textTransform: 'capitalize' },
  sensTextActive: { color: Colors.primary, fontWeight: '700' },
  modeRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.bgCard, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.bgBorder, padding: Spacing.md, marginTop: Spacing.md,
  },
  modeTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary },
  modeDesc: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2, lineHeight: 16 },
  armedPulse: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: Colors.success + '55', alignItems: 'center', justifyContent: 'center' },
  armedDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.success },
  disarmBtn: { marginTop: Spacing.lg, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 16, paddingHorizontal: 48, alignItems: 'center' },
  disarmText: { fontSize: FontSize.md, fontWeight: '800', color: Colors.bg },
  cancel: { marginTop: Spacing.md },
  cancelText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  alarmSiren: { fontSize: 72 },
  alarmTitle: { fontSize: 44, fontWeight: '900', color: '#FF3B5C', letterSpacing: 4 },
  alarmReason: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  alarmSub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center' },
  // Records
  recordsScroll: { flex: 1, backgroundColor: Colors.bg },
  recordsContainer: { padding: Spacing.xl, paddingTop: 72, alignItems: 'center', gap: Spacing.sm },
  recordList: { width: '100%', gap: Spacing.sm, marginTop: Spacing.lg },
  recordRow: {
    flexDirection: 'row', gap: Spacing.md, alignItems: 'center',
    backgroundColor: Colors.bgCard, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.accent + '44', padding: Spacing.sm,
  },
  recordThumb: { width: 56, height: 56, borderRadius: Radius.sm, backgroundColor: Colors.bgBorder },
  recordReason: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textPrimary },
  recordTime: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  recordGeo: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  recordsHint: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: Spacing.md, textAlign: 'center' },
});
