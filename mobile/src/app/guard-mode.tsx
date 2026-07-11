import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, AppState, AppStateStatus } from 'react-native';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { PinPad } from '@/components/PinPad';
import { usePhantomStore } from '@/stores/phantom';
import { startGuard, GuardHandle, GUARD_LEVELS, GUARD_LEVEL_SUMMARY } from '@/services/guard';
import { saveIntruderPhoto } from '@/services/camera';
import { captureLocation } from '@/services/location';
import { uploadIntruderEvent } from '@/services/api';
import { showInterstitial } from '@/services/ads';
import * as pinVault from '@/services/pinVault';
import { GuardEvent, GuardEventType, GuardLevel } from '@/constants/types';
import { track } from '@/services/analytics';
import { maybeAskForReview } from '@/services/rating';

// 'setpin' is shown on first use when no PIN exists yet — Guard Mode must be
// protected by a PIN so only the owner can stop it and see what was captured.
type Phase = 'setpin' | 'confirmpin' | 'config' | 'arming' | 'armed' | 'records';

const ARM_DELAY_SEC = 5;
const GUARD_PIN_LAYER = 'settings' as const;

const EVENT_LABEL: Record<GuardEventType, string> = {
  motion:               'Phone was moved',
  charger_connected:    'Charger was plugged in',
  charger_disconnected: 'Charger was unplugged',
  app_switch:           'Another app was opened',
  disarm_attempt:       'Someone tried to stop Guard Mode',
  wrong_pin:            'Wrong PIN entered',
};

const EVENT_ICON: Record<GuardEventType, string> = {
  motion: '📳', charger_connected: '🔌', charger_disconnected: '⚡',
  app_switch: '📱', disarm_attempt: '✋', wrong_pin: '🔢',
};

export default function GuardModeScreen() {
  const { addGuardEvent, addIntruderPhoto, setGuardArmed } = usePhantomStore();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [phase, setPhase] = useState<Phase>('config');
  const [countdown, setCountdown] = useState(ARM_DELAY_SEC);
  const [level, setLevel] = useState<GuardLevel>('medium');
  const [firstPin, setFirstPin] = useState('');
  const [showPinFallback, setShowPinFallback] = useState(false);
  // Everything captured during THIS session — revealed only when stopped.
  const [sessionEvents, setSessionEvents] = useState<GuardEvent[]>([]);
  const guardRef = useRef<GuardHandle | null>(null);
  const leftAppRef = useRef(false);

  // ── First run: require a PIN before Guard Mode can be used ──────────────────
  useEffect(() => {
    (async () => {
      if (!(await pinVault.hasAnyPin())) setPhase('setpin');
    })();
  }, []);

  // Warm up the camera so silent snaps are instant the moment something happens.
  useEffect(() => {
    if (!permission?.granted) requestPermission();
  }, [permission?.granted, requestPermission]);

  // ── Record one event silently (face snap + location, no on-screen reaction) ──
  const captureAndRecord = useCallback(
    async (type: GuardEventType, opts: { snap?: boolean; reason?: string } = {}) => {
      const { snap = true, reason = EVENT_LABEL[type] } = opts;
      const id = `guard_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      let imageUri: string | undefined;
      let loc: { lat: number; lng: number; accuracy: number } | null = null;
      try {
        const [photo, location] = await Promise.all([
          snap
            ? cameraRef.current?.takePictureAsync({ quality: 0.5, shutterSound: false }).catch(() => null)
            : Promise.resolve(null),
          captureLocation().catch(() => null),
        ]);
        loc = location;
        if (photo?.uri) imageUri = await saveIntruderPhoto(photo.uri).catch(() => undefined);
      } catch {
        // capture failures must never interrupt recording
      }

      const event: GuardEvent = {
        id,
        type,
        timestamp: new Date().toISOString(),
        reason,
        imageUri,
        latitude: loc?.lat,
        longitude: loc?.lng,
      };
      addGuardEvent(event);
      setSessionEvents((prev) => [event, ...prev]);

      // Face snaps also land in the Vault so they persist alongside PIN captures.
      if (imageUri) {
        addIntruderPhoto({
          id,
          timestamp: event.timestamp,
          imageUri,
          trigger: type,
          isAnomaly: true,
          anomalyReason: reason,
          latitude: loc?.lat,
          longitude: loc?.lng,
        });
      }

      // Best-effort backend report (free plan gets a 403 here, which we swallow).
      uploadIntruderEvent({
        id,
        timestamp: Date.now(),
        pinLayer: 'guard',
        failedAttempt: 1,
        location: loc ?? undefined,
      }).catch(() => {});
    },
    [addGuardEvent, addIntruderPhoto],
  );

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

  // ── Start sensors once armed (silent — no alarm, no notification) ────────────
  useEffect(() => {
    if (phase !== 'armed') return;
    track('guard_armed', { level });
    setGuardArmed(true);
    activateKeepAwakeAsync('guard-mode').catch(() => {});

    guardRef.current = startGuard({
      level,
      onEvent: (type) => { void captureAndRecord(type); },
    });
    return () => guardRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, level]);

  // ── Detect app switches (someone leaving to open another app) ────────────────
  useEffect(() => {
    if (phase !== 'armed') return;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (!guardRef.current?.watchesAppSwitch) return;
      if (next === 'background' || next === 'inactive') {
        // Can't snap while backgrounding, but record that they left.
        leftAppRef.current = true;
        void captureAndRecord('app_switch', { snap: false });
      } else if (next === 'active' && leftAppRef.current) {
        leftAppRef.current = false;
        // They came back — now the camera works, so grab their face.
        void captureAndRecord('app_switch', { snap: true, reason: 'Returned to the phone' });
      }
    });
    return () => sub.remove();
  }, [phase, captureAndRecord]);

  // ── Stop — biometric first, PIN fallback; both reveal the records ───────────
  const finishStop = useCallback(async () => {
    guardRef.current?.stop();
    setGuardArmed(false);
    deactivateKeepAwake('guard-mode');
    track('guard_stopped', { incidents: sessionEvents.length });
    if (sessionEvents.length > 0) void maybeAskForReview();
    setShowPinFallback(false);
    setPhase('records');
    // Ad on the way out ("to end").
    void showInterstitial();
  }, [sessionEvents.length, setGuardArmed]);

  const attemptStop = useCallback(async () => {
    const hasHw = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (hasHw && enrolled) {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Verify your identity to stop Guard Mode',
        cancelLabel: 'Cancel',
      });
      if (res.success) return finishStop();
    }
    // Falling back to the PIN means someone is actively trying to stop it —
    // record the attempt (and their face) before showing the pad.
    void captureAndRecord('disarm_attempt');
    setShowPinFallback(true);
  }, [finishStop, captureAndRecord]);

  // A wrong PIN entered while trying to stop is itself evidence.
  const handleWrongPin = useCallback(() => {
    void captureAndRecord('wrong_pin');
  }, [captureAndRecord]);

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
    setPhase('config');
  }, [firstPin]);

  // ── Start button (ad "to start", then countdown) ────────────────────────────
  const handleStart = useCallback(async () => {
    await showInterstitial();
    setCountdown(ARM_DELAY_SEC);
    setPhase('arming');
  }, []);

  // Clean up if torn down while armed.
  useEffect(() => {
    return () => {
      guardRef.current?.stop();
      setGuardArmed(false);
      deactivateKeepAwake('guard-mode');
    };
  }, [setGuardArmed]);

  const cameraEnabled = phase === 'arming' || phase === 'armed';

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
              : 'Guard Mode needs a PIN so only you can stop it and see what it recorded.'
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

  // ── Records screen (revealed only when stopped with the correct PIN) ─────────
  if (phase === 'records') {
    return (
      <ScrollView style={s.recordsScroll} contentContainerStyle={s.recordsContainer}>
        <Text style={s.shield}>{sessionEvents.length ? '🗂️' : '✅'}</Text>
        <Text style={s.title}>{sessionEvents.length ? 'Guard Mode Report' : 'All Clear'}</Text>
        <Text style={s.sub}>
          {sessionEvents.length
            ? `${sessionEvents.length} event${sessionEvents.length > 1 ? 's' : ''} were recorded while you were away.`
            : 'Nothing happened while Guard Mode was watching.'}
        </Text>

        <View style={s.recordList}>
          {sessionEvents.map((r) => (
            <View key={r.id} style={s.recordRow}>
              {r.imageUri ? (
                <Image source={{ uri: r.imageUri }} style={s.recordThumb} />
              ) : (
                <View style={[s.recordThumb, s.recordThumbEmpty]}>
                  <Text style={s.recordThumbIcon}>{EVENT_ICON[r.type]}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.recordReason}>{r.reason}</Text>
                <Text style={s.recordTime}>{new Date(r.timestamp).toLocaleString()}</Text>
                {r.latitude != null && r.longitude != null && (
                  <Text style={s.recordGeo}>📍 {r.latitude.toFixed(4)}, {r.longitude.toFixed(4)}</Text>
                )}
              </View>
            </View>
          ))}
        </View>

        <Text style={s.recordsHint}>Face snapshots are also saved in your Vault.</Text>

        <TouchableOpacity style={s.primaryBtn} onPress={() => router.back()} activeOpacity={0.85}>
          <Text style={s.primaryText}>Done</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ── Armed screen — neutral, reveals nothing about what's been captured ──────
  if (phase === 'armed') {
    return (
      <View style={s.container}>
        <HiddenCamera enabled={cameraEnabled} cameraRef={cameraRef} />
        {showPinFallback ? (
          <PinPad
            title="Enter PIN to stop"
            subtitle="Enter your PhantomShield PIN to stop Guard Mode."
            verify={verifyPin}
            onSuccess={finishStop}
            onFail={handleWrongPin}
          />
        ) : (
          <>
            <View style={s.armedPulse}>
              <View style={s.armedDot} />
            </View>
            <Text style={s.title}>Guard Mode Active</Text>
            <Text style={s.sub}>
              Watching quietly. Whatever happens is recorded and shown only to you when you stop.
            </Text>
            <TouchableOpacity style={s.primaryBtn} onPress={attemptStop} activeOpacity={0.85}>
              <Text style={s.primaryText}>Stop</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  // ── Config / arming screen ──────────────────────────────────────────────────
  return (
    <View style={s.container}>
      <HiddenCamera enabled={cameraEnabled} cameraRef={cameraRef} />
      <Text style={s.shield}>🛡</Text>

      {phase === 'arming' ? (
        <>
          <Text style={s.title}>Arming in {countdown}…</Text>
          <Text style={s.sub}>Put your phone down. Guard Mode starts watching silently.</Text>
        </>
      ) : (
        <>
          <Text style={s.title}>Guard Mode</Text>
          <Text style={s.sub}>Choose how much to watch. Everything is recorded silently.</Text>

          <View style={s.levelList}>
            {(['low', 'medium', 'high'] as GuardLevel[]).map((lvl) => (
              <TouchableOpacity
                key={lvl}
                style={[s.levelCard, level === lvl && s.levelCardActive]}
                onPress={() => setLevel(lvl)}
                activeOpacity={0.85}
              >
                <View style={s.levelHead}>
                  <Text style={[s.levelName, level === lvl && s.levelNameActive]}>{lvl}</Text>
                  {level === lvl && <Text style={s.levelCheck}>✓</Text>}
                </View>
                <Text style={s.levelDesc}>{GUARD_LEVEL_SUMMARY[lvl]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={s.primaryBtn} onPress={handleStart} activeOpacity={0.85}>
            <Text style={s.primaryText}>Start Guard Mode</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()} style={s.cancel}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
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
  hiddenCamera: { position: 'absolute', width: 1, height: 1, top: -10, left: -10, opacity: 0 },
  shield: { fontSize: 56 },
  title: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, paddingHorizontal: Spacing.md },
  levelList: { width: '100%', gap: Spacing.sm, marginTop: Spacing.md },
  levelCard: {
    backgroundColor: Colors.bgCard, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.bgBorder, padding: Spacing.md,
  },
  levelCardActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryGlow },
  levelHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  levelName: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textPrimary, textTransform: 'capitalize' },
  levelNameActive: { color: Colors.primary },
  levelCheck: { fontSize: FontSize.md, color: Colors.primary, fontWeight: '800' },
  levelDesc: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 4, lineHeight: 16 },
  armedPulse: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: Colors.success + '55', alignItems: 'center', justifyContent: 'center' },
  armedDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.success },
  primaryBtn: { marginTop: Spacing.lg, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 16, paddingHorizontal: 48, alignItems: 'center', alignSelf: 'stretch' },
  primaryText: { fontSize: FontSize.md, fontWeight: '800', color: Colors.bg, textAlign: 'center' },
  cancel: { marginTop: Spacing.md },
  cancelText: { fontSize: FontSize.sm, color: Colors.textSecondary },
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
  recordThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  recordThumbIcon: { fontSize: 24 },
  recordReason: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textPrimary },
  recordTime: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  recordGeo: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  recordsHint: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: Spacing.md, textAlign: 'center' },
});
