import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, AppState, AppStateStatus, ActivityIndicator, Pressable, Alert, BackHandler } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Battery from 'expo-battery';
import * as LocalAuthentication from 'expo-local-authentication';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { Colors, Spacing, FontSize, Radius } from '@/constants/theme';
import { PinPad } from '@/components/PinPad';
import { usePhantomStore } from '@/stores/phantom';
import { startGuard, GuardHandle, GUARD_LEVEL_SUMMARY, GUARD_MODE_SUMMARY, isPocketModeAvailable } from '@/services/guard';
import { saveIntruderPhoto } from '@/services/camera';
import { captureLocation, ensureLocationPermission } from '@/services/location';
import { uploadIntruderEvent, uploadIntruderPhoto, reportGuardSession } from '@/services/api';
import * as pinVault from '@/services/pinVault';
import { GuardEvent, GuardEventType, GuardLevel, GuardMode } from '@/constants/types';
import { track } from '@/services/analytics';
import { maybeAskForReview } from '@/services/rating';
import { startSiren, stopSiren } from '@/services/alarm';
import { presentArmedNotification, dismissNotification } from '@/services/notifications';
import { startLocationTracking, stopLocationTracking, requestTrackingPermissions } from '@/services/locationTracking';

// 'setpin' is shown on first use when no PIN exists yet — Guard Mode must be
// protected by a PIN so only the owner can stop it and see what was captured.
type Phase = 'setpin' | 'confirmpin' | 'config' | 'arming' | 'armed' | 'records';

const ARM_DELAY_SEC = 5;
type IconName = React.ComponentProps<typeof Ionicons>['name'];

// Labels state only what the sensors can actually prove — no guessing. The OS
// never tells a backgrounded app WHICH app took the foreground, so we say the
// app was hidden/reopened rather than inventing "another app was opened".
const EVENT_LABEL: Record<GuardEventType, string> = {
  motion:               'Phone was moved',
  charger_connected:    'Charger was plugged in',
  charger_disconnected: 'Charger was unplugged',
  app_switch:           'PhantomShield was hidden (Home pressed or app switched)',
  disarm_attempt:       'Stop was attempted',
  wrong_pin:            'Wrong PIN entered while trying to stop',
  pocket:               'Phone was taken out of a pocket or bag',
};

const EVENT_ICON: Record<GuardEventType, IconName> = {
  motion: 'move-outline', charger_connected: 'flash-outline', charger_disconnected: 'flash-off-outline',
  app_switch: 'albums-outline', disarm_attempt: 'hand-left-outline', wrong_pin: 'keypad-outline',
  pocket: 'walk-outline',
};

const MODE_ICON: Record<GuardMode, IconName> = {
  table: 'phone-portrait-outline',
  charger: 'flash-outline',
  pocket: 'walk-outline',
};

const isCharging = (st: Battery.BatteryState) =>
  st === Battery.BatteryState.CHARGING || st === Battery.BatteryState.FULL;

export default function GuardModeScreen() {
  // The report (faces, locations) and PIN entry must not be capturable.
  usePreventScreenCapture('guard-mode');
  const {
    addGuardEvent,
    addIntruderPhoto,
    setGuardArmed,
    isAuthenticated,
    // Consent flags. These are the user's explicit choices in Settings and they
    // govern EVERY capture surface, not just the PIN pad — Guard Mode used to
    // photograph people and read GPS regardless of both switches.
    intruderSnapshotEnabled,
    setIntruderSnapshotEnabled,
    locationEnabled,
    setLocationEnabled,
    backgroundGuardEnabled,
    setBackgroundGuardEnabled,
  } = usePhantomStore();
  const params = useLocalSearchParams<{ arm?: string; mode?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [phase, setPhase] = useState<Phase>('config');
  const [countdown, setCountdown] = useState(ARM_DELAY_SEC);
  const [level, setLevel] = useState<GuardLevel>('medium');
  const initialMode: GuardMode = params.mode === 'charger' || params.mode === 'pocket' ? params.mode : 'table';
  const [mode, setMode] = useState<GuardMode>(initialMode);
  const [pocketAvailable, setPocketAvailable] = useState(false);
  // Pocket mode: true once the phone has been dark long enough to be in a pocket.
  const [pocketed, setPocketed] = useState(false);
  // Arm as soon as the PIN exists — set by a quick action, Siri or a shortcut.
  const autoArm = useRef(params.arm === '1');
  const [firstPin, setFirstPin] = useState('');
  const [showPinFallback, setShowPinFallback] = useState(false);
  // True when Guard was stopped with the DECOY PIN — the report must show a fake
  // "All Clear" and never surface the real captured records.
  const [decoyStop, setDecoyStop] = useState(false);
  // Disables Start/Stop while an ad or auth prompt is in flight so a second
  // tap can't double-trigger the flow.
  const [busy, setBusy] = useState(false);
  // Everything captured during THIS session — revealed only when stopped.
  const [sessionEvents, setSessionEvents] = useState<GuardEvent[]>([]);
  // The armed screen dims to near-black after a few idle seconds so the
  // (kept-awake) display doesn't burn battery/OLED while watching. Tapping wakes
  // it. Sensors keep running regardless — this is purely the visible surface.
  const [dimmed, setDimmed] = useState(false);
  // Siren: off by default on a table (quiet evidence is the point there), on by
  // default for charger and pocket alarms (being loud IS the point there).
  const [alarmOnTamper, setAlarmOnTamper] = useState(initialMode !== 'table');
  // Whether the background location task actually started — never claim
  // background protection is on when the OS refused permission.
  const [backgroundActive, setBackgroundActive] = useState(false);
  const dimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guardRef = useRef<GuardHandle | null>(null);
  const leftAppRef = useRef(false);
  // Id of the persistent "armed" notification so we can dismiss it on stop.
  const armedNotifIdRef = useRef<string | null>(null);

  // ── First run: require a PIN before Guard Mode can be used ──────────────────
  useEffect(() => {
    (async () => {
      const pocketOk = await isPocketModeAvailable();
      setPocketAvailable(pocketOk);
      if (!(await pinVault.hasPin('app'))) {
        setPhase('setpin');
        return;
      }
      if (autoArm.current) {
        autoArm.current = false;
        if (initialMode === 'pocket' && !pocketOk) setMode('table');
        void armNow(initialMode === 'pocket' && !pocketOk ? 'table' : initialMode);
      }
    })();
    // Runs once: the params that launched this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseMode = (m: GuardMode) => {
    setMode(m);
    setAlarmOnTamper(m !== 'table');
  };

  // While arming/armed, the Android back button must not leave the screen —
  // leaving tears Guard Mode down, so anyone holding the phone could disarm it
  // without the PIN. (iOS: the swipe-back gesture is disabled in _layout.)
  useEffect(() => {
    if (phase !== 'arming' && phase !== 'armed') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (phase === 'armed') setShowPinFallback(true);
      return true;
    });
    return () => sub.remove();
  }, [phase]);

  // Photo capture is an explicit choice made here; the OS prompt comes with it.
  const togglePhotos = useCallback(async () => {
    if (intruderSnapshotEnabled) { setIntruderSnapshotEnabled(false); return; }
    const res = permission?.granted ? permission : await requestPermission();
    setIntruderSnapshotEnabled(!!res?.granted);
    if (!res?.granted) {
      Alert.alert('Camera access needed', 'Allow camera access for PhantomShield in Settings to take intruder photos.');
    }
  }, [intruderSnapshotEnabled, permission, requestPermission, setIntruderSnapshotEnabled]);

  // Background tracking needs "Always" location. Ask now, while the owner is
  // looking at the screen — not after arming, when the phone is put down.
  const toggleBackground = useCallback(async () => {
    if (backgroundGuardEnabled) { setBackgroundGuardEnabled(false); return; }
    const perms = await requestTrackingPermissions().catch(() => null);
    setBackgroundGuardEnabled(!!perms?.granted);
    if (!perms?.granted) {
      Alert.alert(
        'Allow location “Always”',
        'To keep tracking after you leave the app, allow PhantomShield to use your location “Always” in Settings. Guard Mode still works while the app is open.',
      );
    }
  }, [backgroundGuardEnabled, setBackgroundGuardEnabled]);

  const toggleLocation = useCallback(async () => {
    if (locationEnabled) { setLocationEnabled(false); return; }
    const ok = await ensureLocationPermission();
    setLocationEnabled(ok);
    if (!ok) {
      Alert.alert('Location access needed', 'Allow location access for PhantomShield in Settings to record where events happen.');
    }
  }, [locationEnabled, setLocationEnabled]);

  // ── Record one event silently (face snap + location, no on-screen reaction) ──
  const captureAndRecord = useCallback(
    async (type: GuardEventType, opts: { snap?: boolean; reason?: string } = {}) => {
      const { snap = true, reason = EVENT_LABEL[type] } = opts;
      const id = `guard_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      // Consent gates. Photographing a person and reading GPS are the two most
      // sensitive things this app does, and both are user-controlled switches:
      // honour them here or the switches are decorative.
      const maySnap = snap && intruderSnapshotEnabled;
      const mayLocate = locationEnabled;

      // Loud mode, if the owner asked for it. Fire-and-forget: the siren must
      // never delay or block evidence capture.
      if (alarmOnTamper) void startSiren().catch(() => {});

      let imageUri: string | undefined;
      let loc: { lat: number; lng: number; accuracy: number } | null = null;
      try {
        const [photo, location] = await Promise.all([
          maySnap
            ? cameraRef.current
                // Downscaling happens in saveIntruderPhoto() — expo-camera has
                // no native resize option on native platforms.
                ?.takePictureAsync({ quality: 0.6, shutterSound: false })
                .catch(() => null)
            : Promise.resolve(null),
          mayLocate ? captureLocation().catch(() => null) : Promise.resolve(null),
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

      // Back up the photo, then report the event with its reference. Only for a
      // signed-in owner; best-effort either way — evidence stays on the phone.
      if (usePhantomStore.getState().isAuthenticated) (async () => {
        const key = imageUri ? await uploadIntruderPhoto(id, imageUri).catch(() => null) : null;
        uploadIntruderEvent({
          id,
          timestamp: Date.now(),
          pinLayer: 'guard',
          failedAttempt: 1,
          location: loc ?? undefined,
          encryptedPhotoKey: key ?? undefined,
        }).catch(() => {});
      })();
    },
    [addGuardEvent, addIntruderPhoto, intruderSnapshotEnabled, locationEnabled, alarmOnTamper],
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

  // ── Start sensors once armed ─────────────────────────────────────────────────
  // A persistent, user-visible notification is presented while armed. This is a
  // deliberate trust/compliance signal: silent background monitoring with no
  // indicator can be treated as stalkerware under Google Play policy (see
  // docs/STORE_COMPLIANCE.md §3). The evidence itself is still recorded quietly.
  useEffect(() => {
    if (phase !== 'armed') return;
    track('guard_armed', { level });
    setGuardArmed(true);
    activateKeepAwakeAsync('guard-mode').catch(() => {});
    presentArmedNotification()
      .then((id) => { armedNotifIdRef.current = id; })
      .catch(() => {});

    setPocketed(false);
    guardRef.current = startGuard({
      level,
      mode,
      onEvent: (type) => { void captureAndRecord(type); },
      onPocketed: () => setPocketed(true),
    });

    // Background continuation.
    //
    // Guard Mode used to stop dead the moment the app left the foreground —
    // exactly when a phone is most likely being taken. Neither platform allows
    // continuous background accelerometer access, so we do the thing that IS
    // permitted and that matters most once the phone is gone: keep a background
    // location task alive for the duration of the session, so the trail
    // continues even though motion sensing pauses.
    //
    // The honest limitation is stated in the UI rather than hidden: sensors are
    // foreground-only; location keeps running.
    if (backgroundGuardEnabled) {
      void startLocationTracking().then((ok) => {
        setBackgroundActive(ok);
        if (!ok) {
          // Permission refused — say so instead of implying it's watching.
          Alert.alert(
            'Background protection unavailable',
            'Allow “Always” location access to keep tracking this phone after you leave the app. Guard Mode will still watch while the app is open.',
          );
        }
      });
    }

    return () => {
      guardRef.current?.stop();
      // Only tear the location task down if this session started it — a user
      // who has continuous tracking switched on must keep it after Guard stops.
      if (!usePhantomStore.getState().locationTrackingEnabled) {
        void stopLocationTracking();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, level, mode, backgroundGuardEnabled]);

  // ── Auto-dim the armed screen after idle ─────────────────────────────────────
  const scheduleDim = useCallback(() => {
    if (dimTimer.current) clearTimeout(dimTimer.current);
    setDimmed(false);
    dimTimer.current = setTimeout(() => setDimmed(true), 8000);
  }, []);

  useEffect(() => {
    if (phase !== 'armed' || showPinFallback) {
      if (dimTimer.current) clearTimeout(dimTimer.current);
      setDimmed(false);
      return;
    }
    scheduleDim();
    return () => { if (dimTimer.current) clearTimeout(dimTimer.current); };
  }, [phase, showPinFallback, scheduleDim]);

  // ── Detect the app being hidden (High level only) ────────────────────────────
  // Only a real 'background' transition counts. iOS also fires 'inactive' for
  // the notification shade, control centre, and Face ID prompts — none of which
  // prove anyone left the app, so they are deliberately ignored.
  useEffect(() => {
    if (phase !== 'armed') return;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (!guardRef.current?.watchesAppSwitch) return;
      if (next === 'background') {
        // Camera is unavailable while backgrounded — record the fact only.
        leftAppRef.current = true;
        void captureAndRecord('app_switch', { snap: false });
      } else if (next === 'active' && leftAppRef.current) {
        leftAppRef.current = false;
        // They came back — the camera works again, so capture who it is.
        void captureAndRecord('app_switch', { snap: true, reason: 'PhantomShield was reopened' });
      }
    });
    return () => sub.remove();
  }, [phase, captureAndRecord]);

  // ── Stop — biometric first, PIN fallback; both reveal the records ───────────
  const finishStop = useCallback(async () => {
    guardRef.current?.stop();
    stopSiren();
    setGuardArmed(false);
    deactivateKeepAwake('guard-mode');
    void dismissNotification(armedNotifIdRef.current);
    armedNotifIdRef.current = null;
    track('guard_stopped', { incidents: sessionEvents.length });
    // Activation signal: tells the server the product was actually used, which
    // drives the activation metric.
    void reportGuardSession();
    if (sessionEvents.length > 0) void maybeAskForReview();
    setShowPinFallback(false);
    setPhase('records');
    // Deliberately NO interstitial here. The user has just come back to their
    // phone and is asking one urgent question — "did anything happen?" — and a
    // full-screen ad delays that answer in what may be an actual theft. It also
    // fired two lines after the review prompt, so we asked for five stars and
    // immediately served an ad. Ads do not belong anywhere on the security path.
  }, [sessionEvents.length, setGuardArmed]);

  // Duress stop: the DECOY PIN must never reveal real evidence. It shows the
  // same "All Clear" screen an empty session would, so a coercer who was handed
  // the decoy PIN sees nothing — while the real records stay in the Vault.
  const finishStopDecoy = useCallback(() => {
    guardRef.current?.stop();
    stopSiren();
    setGuardArmed(false);
    deactivateKeepAwake('guard-mode');
    void dismissNotification(armedNotifIdRef.current);
    armedNotifIdRef.current = null;
    track('guard_stopped_decoy');
    setShowPinFallback(false);
    setDecoyStop(true);
    setPhase('records');
  }, [setGuardArmed]);

  // Stopping always asks for the PIN the user set — never the phone's own
  // passcode. (The OS biometric prompt's default fallback is the DEVICE PIN,
  // which confused users who had just created a Guard PIN.)
  const attemptStop = useCallback(() => {
    if (busy) return;
    setShowPinFallback(true);
  }, [busy]);

  // Optional convenience: biometrics may stop Guard Mode, but with the device-
  // passcode fallback disabled so the phone PIN can never bypass the Guard PIN.
  const tryBiometricStop = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const hasHw = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHw || !enrolled) return;
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Stop Guard Mode',
        cancelLabel: 'Use PIN',
        disableDeviceFallback: true,
      });
      if (res.success) finishStop();
    } catch {
      // fall through — the PIN pad stays available
    } finally {
      setBusy(false);
    }
  }, [busy, finishStop]);

  // A wrong PIN entered while trying to stop is itself evidence — snap a face.
  const handleWrongPin = useCallback(() => {
    void captureAndRecord('wrong_pin');
  }, [captureAndRecord]);

  // Verify against a configured PIN. Real layers stop Guard Mode and reveal the
  // records; the DECOY layer is accepted too (so it doesn't read as a wrong PIN)
  // but is routed to a fake all-clear by the success handler below — it must
  // never reveal real evidence (duress protection). A PIN always exists here
  // because the 'setpin' phase forces one before arming.

  const verifyPin = useCallback(async (pin: string) =>
    // Accept the decoy so the pad doesn't shake/flag it; handleStopSuccess
    // decides it's a decoy and shows the fake report instead.
    (await pinVault.verifyPin('app', pin)) || (await pinVault.verifyPin('decoy', pin)),
  []);

  // Called by the PIN pad on any accepted PIN. A decoy match diverts to the fake
  // all-clear; every real layer reveals the true records.
  const handleStopSuccess = useCallback(async (pin: string) => {
    const isReal = await pinVault.verifyPin('app', pin);
    if (!isReal && (await pinVault.verifyPin('decoy', pin))) finishStopDecoy();
    else finishStop();
  }, [finishStop, finishStopDecoy]);

  // ── First-run PIN setup ─────────────────────────────────────────────────────
  const handleSetPin = useCallback((pin: string) => {
    if (pinVault.isWeakPin(pin)) {
      Alert.alert('Choose a stronger PIN', 'Avoid repeated digits (1111) and straight runs (1234) — they are the first guesses anyone tries.');
      return;
    }
    setFirstPin(pin);
    setPhase('confirmpin');
  }, []);

  const handleConfirmPin = useCallback(async (pin: string) => {
    if (pin !== firstPin) {
      setFirstPin('');
      setPhase('setpin');
      Alert.alert('PINs didn’t match', 'Enter your new PIN again.');
      return;
    }
    await pinVault.setPin('app', pin);
    setFirstPin('');
    setPhase('config');
    if (autoArm.current) {
      autoArm.current = false;
      void armNow(mode);
    }
  }, [firstPin, mode]);

  // ── Start: short countdown, then the sensors start ─────────────────────────
  // Nothing (no ad, no prompt) ever sits between the owner's intent and the
  // sensors starting. The one check is charger mode: an unplugged phone would
  // have nothing to watch for, which is worth saying before it's put down.
  async function armNow(m: GuardMode) {
    if (m === 'charger') {
      const st = await Battery.getBatteryStateAsync().catch(() => Battery.BatteryState.UNKNOWN);
      if (st !== Battery.BatteryState.UNKNOWN && !isCharging(st)) {
        Alert.alert('Plug in your charger first', 'The charger alarm goes off when the cable is pulled out, so the phone needs to be charging.');
        return;
      }
    }
    setCountdown(ARM_DELAY_SEC);
    setPhase('arming');
  }

  const handleStart = useCallback(() => {
    if (busy) return;
    void armNow(mode);
  }, [busy, mode]);

  // Clean up if torn down while armed.
  useEffect(() => {
    return () => {
      guardRef.current?.stop();
      setGuardArmed(false);
      deactivateKeepAwake('guard-mode');
    };
  }, [setGuardArmed]);

  // Don't even mount the camera when the user has snapshots switched off —
  // a security app must not hold an open camera it has no consent to use.
  const cameraEnabled =
    (phase === 'arming' || phase === 'armed') && intruderSnapshotEnabled && !!permission?.granted;

  // ── First-run PIN setup screen ──────────────────────────────────────────────
  if (phase === 'setpin' || phase === 'confirmpin') {
    return (
      <View style={s.container}>
        <Ionicons name="lock-closed-outline" size={48} color={Colors.primary} />
        <PinPad
          key={phase}
          title={phase === 'confirmpin' ? 'Confirm your PIN' : 'Create your PhantomShield PIN'}
          subtitle={
            phase === 'confirmpin'
              ? 'Enter the same 4-digit PIN again.'
              : 'Only this PIN can stop Guard Mode and show what it recorded.'
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
    // A decoy stop shows the same screen an empty, uneventful session would —
    // the real records are never rendered here.
    const shownEvents = decoyStop ? [] : sessionEvents;
    return (
      <ScrollView style={s.recordsScroll} contentContainerStyle={s.recordsContainer}>
        <Ionicons
          name={shownEvents.length ? 'alert-circle-outline' : 'checkmark-circle-outline'}
          size={56}
          color={shownEvents.length ? Colors.accent : Colors.success}
        />
        <Text style={s.title}>{shownEvents.length ? 'Guard Mode Report' : 'All Clear'}</Text>
        <Text style={s.sub}>
          {shownEvents.length
            ? `${shownEvents.length === 1 ? '1 event was' : `${shownEvents.length} events were`} recorded while you were away.`
            : 'Nothing happened while Guard Mode was watching.'}
        </Text>

        <View style={s.recordList}>
          {shownEvents.map((r) => (
            <View key={r.id} style={s.recordRow}>
              {r.imageUri ? (
                <Image source={{ uri: r.imageUri }} style={s.recordThumb} />
              ) : (
                <View style={[s.recordThumb, s.recordThumbEmpty]}>
                  <Ionicons name={EVENT_ICON[r.type] ?? 'alert-circle-outline'} size={24} color={Colors.textSecondary} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.recordReason}>{r.reason}</Text>
                <Text style={s.recordTime}>{new Date(r.timestamp).toLocaleString()}</Text>
                {r.latitude != null && r.longitude != null && (
                  <Text style={s.recordGeo}>{r.latitude.toFixed(4)}, {r.longitude.toFixed(4)}</Text>
                )}
              </View>
            </View>
          ))}
        </View>

        <Text style={s.recordsHint}>
          {isAuthenticated
            ? 'Photos are saved in the Evidence tab.'
            : 'This report is stored on this device. Sign in to keep a backup and see it from any browser.'}
        </Text>

        {isAuthenticated && shownEvents.some((e) => e.imageUri) && (
          <TouchableOpacity
            style={s.secondaryBtn}
            onPress={() => router.replace('/(tabs)/vault')}
            activeOpacity={0.85}
          >
            <Text style={s.secondaryText}>Open Evidence</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={s.primaryBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
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
          <>
            <PinPad
              title="Enter PIN to stop"
              subtitle="Enter the PIN you set for PhantomShield."
              verify={verifyPin}
              lockContext="guard"
              onSuccess={handleStopSuccess}
              onFail={handleWrongPin}
            />
            <TouchableOpacity onPress={tryBiometricStop} style={s.cancel}>
              <Text style={s.linkText}>Use Face ID / Fingerprint instead</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowPinFallback(false)} style={s.cancel}>
              <Text style={s.cancelText}>Back</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={s.armedPulse}>
              <View style={s.armedDot} />
            </View>
            <Text style={s.title}>Guard Mode Active</Text>
            <Text style={s.sub}>
              {mode === 'pocket'
                ? pocketed
                  ? 'In your pocket. If someone takes it out, the alarm goes off.'
                  : 'Put the phone in your pocket or bag now, screen facing in.'
                : mode === 'charger'
                  ? 'Watching the charger. If the cable is pulled out, the alarm goes off.'
                  : 'Watching quietly. Whatever happens is recorded and shown only to you when you stop.'}
              {' '}Keep the app open — the sensors pause if it&apos;s closed.
            </Text>
            {/* Be explicit about what is and isn't being captured, so the
                Settings switches visibly mean something here. */}
            <Text style={s.captureNote}>
              {intruderSnapshotEnabled ? 'Photo' : 'Photo off'}
              {'  ·  '}
              {locationEnabled ? 'Location' : 'Location off'}
              {'  ·  '}
              {backgroundActive ? 'Background tracking on' : 'Foreground only'}
            </Text>
            <TouchableOpacity
              style={[s.primaryBtn, busy && s.btnDisabled]}
              onPress={attemptStop}
              disabled={busy}
              activeOpacity={0.85}
            >
              {busy
                ? <ActivityIndicator color={Colors.bg} />
                : <Text style={s.primaryText}>Stop</Text>}
            </TouchableOpacity>

            {/* Idle dimmer: a near-black layer over the kept-awake screen. Tap to
                wake. Sensors keep watching underneath regardless. */}
            {dimmed && (
              <Pressable
                style={s.dimOverlay}
                onPress={scheduleDim}
                accessibilityRole="button"
                accessibilityLabel="Screen dimmed — tap to wake"
              >
                <Text style={s.dimHint}>Guard Mode active · tap to wake</Text>
              </Pressable>
            )}
          </>
        )}
      </View>
    );
  }

  // ── Config / arming screen ──────────────────────────────────────────────────
  return (
    <ScrollView style={s.recordsScroll} contentContainerStyle={s.configContainer} showsVerticalScrollIndicator={false}>
      <HiddenCamera enabled={cameraEnabled} cameraRef={cameraRef} />
      <Ionicons name="shield-half-outline" size={56} color={Colors.primary} />

      {phase === 'arming' ? (
        <>
          <Text style={s.title} accessibilityLiveRegion="polite">Arming in {countdown}…</Text>
          <Text style={s.sub}>
            {mode === 'pocket'
              ? 'Put your phone in your pocket or bag.'
              : mode === 'charger'
                ? 'Leave it charging. The alarm starts watching in a moment.'
                : 'Put your phone down. Guard Mode starts watching in a moment.'}
          </Text>
          <TouchableOpacity onPress={() => setPhase('config')} style={s.cancel} accessibilityRole="button">
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={s.title} accessibilityRole="header">Guard Mode</Text>
          <Text style={s.sub}>Where are you leaving your phone? What happens is shown to you when you stop.</Text>

          <View style={s.modeRow}>
            {(pocketAvailable ? (['table', 'charger', 'pocket'] as GuardMode[]) : (['table', 'charger'] as GuardMode[])).map((m) => (
              <TouchableOpacity
                key={m}
                style={[s.modeCard, mode === m && s.levelCardActive]}
                onPress={() => chooseMode(m)}
                activeOpacity={0.85}
                accessibilityRole="radio"
                accessibilityState={{ selected: mode === m }}
                accessibilityLabel={`${GUARD_MODE_SUMMARY[m].title}. ${GUARD_MODE_SUMMARY[m].desc}`}
              >
                <Ionicons name={MODE_ICON[m]} size={22} color={mode === m ? Colors.primary : Colors.textSecondary} />
                <Text style={[s.modeTitle, mode === m && s.levelNameActive]}>{GUARD_MODE_SUMMARY[m].title}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.modeDesc}>{GUARD_MODE_SUMMARY[mode].desc}</Text>

          {mode === 'table' && <View style={s.levelList}>
            {(['low', 'medium', 'high'] as GuardLevel[]).map((lvl) => (
              <TouchableOpacity
                key={lvl}
                style={[s.levelCard, level === lvl && s.levelCardActive]}
                onPress={() => setLevel(lvl)}
                activeOpacity={0.85}
              >
                <View style={s.levelHead}>
                  <Text style={[s.levelName, level === lvl && s.levelNameActive]}>{lvl}</Text>
                  {level === lvl && <Ionicons name="checkmark" size={18} color={Colors.primary} />}
                </View>
                <Text style={s.levelDesc}>{GUARD_LEVEL_SUMMARY[lvl]}</Text>
              </TouchableOpacity>
            ))}
          </View>}

          <ToggleRow
            icon="camera-outline"
            title="Take a photo of whoever moves it"
            desc={intruderSnapshotEnabled ? 'Front camera photo with each event.' : 'Off — events are recorded without a photo.'}
            on={intruderSnapshotEnabled}
            onPress={togglePhotos}
          />
          <ToggleRow
            icon="location-outline"
            title="Record the location"
            desc={locationEnabled ? 'Each event is tagged with where it happened.' : 'Off — events are recorded without a location.'}
            on={locationEnabled}
            onPress={toggleLocation}
          />

          {/* Keep watching after the app is backgrounded. Neither platform
              allows continuous background motion sensing, so this specifically
              keeps the LOCATION trail alive — which is what still matters once
              the phone is out of reach. The copy says exactly that. */}
          <TouchableOpacity
            style={[s.alarmRow, backgroundGuardEnabled && s.alarmRowActive]}
            onPress={toggleBackground}
            activeOpacity={0.85}
            accessibilityRole="switch"
            accessibilityState={{ checked: backgroundGuardEnabled }}
            accessibilityLabel="Keep tracking after leaving the app"
          >
            <Ionicons name="navigate-outline" size={20} color={backgroundGuardEnabled ? Colors.warning : Colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={s.alarmTitle}>Keep tracking in the background</Text>
              <Text style={s.alarmDesc}>
                {backgroundGuardEnabled
                  ? 'Location keeps reporting after you leave the app. Motion and charger sensing still pause — the OS does not allow them in the background.'
                  : 'Off — Guard Mode stops watching when you leave the app.'}
              </Text>
            </View>
            <View style={[s.alarmToggle, backgroundGuardEnabled && s.alarmToggleOn]}>
              <View style={[s.alarmKnob, backgroundGuardEnabled && s.alarmKnobOn]} />
            </View>
          </TouchableOpacity>

          {/* Guard Mode records silently by default — that is the point of the
              feature. But the app also SELLS an "anti-theft alarm", so make the
              siren a real, explicit choice rather than a claim nothing honours. */}
          <TouchableOpacity
            style={[s.alarmRow, alarmOnTamper && s.alarmRowActive]}
            onPress={() => setAlarmOnTamper((v) => !v)}
            activeOpacity={0.85}
            accessibilityRole="switch"
            accessibilityState={{ checked: alarmOnTamper }}
            accessibilityLabel="Sound an alarm when tampering is detected"
          >
            <Ionicons name={alarmOnTamper ? 'volume-high-outline' : 'volume-mute-outline'} size={20} color={alarmOnTamper ? Colors.warning : Colors.textSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={s.alarmTitle}>Sound alarm on tamper</Text>
              <Text style={s.alarmDesc}>
                {alarmOnTamper
                  ? 'A loud siren plays when something is detected.'
                  : 'Off — Guard Mode watches silently and records evidence.'}
              </Text>
            </View>
            <View style={[s.alarmToggle, alarmOnTamper && s.alarmToggleOn]}>
              <View style={[s.alarmKnob, alarmOnTamper && s.alarmKnobOn]} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.primaryBtn, busy && s.btnDisabled]}
            onPress={handleStart}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy
              ? <ActivityIndicator color={Colors.bg} />
              : <Text style={s.primaryText}>Start Guard Mode</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()} style={s.cancel} disabled={busy}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

function ToggleRow({
  icon, title, desc, on, onPress,
}: { icon: IconName; title: string; desc: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[s.alarmRow, on && s.alarmRowActive]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={title}
    >
      <Ionicons name={icon} size={20} color={on ? Colors.warning : Colors.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={s.alarmTitle}>{title}</Text>
        <Text style={s.alarmDesc}>{desc}</Text>
      </View>
      <View style={[s.alarmToggle, on && s.alarmToggleOn]}>
        <View style={[s.alarmKnob, on && s.alarmKnobOn]} />
      </View>
    </TouchableOpacity>
  );
}

function HiddenCamera({ enabled, cameraRef }: { enabled: boolean; cameraRef: React.RefObject<CameraView | null> }) {
  if (!enabled) return null;
  return <CameraView ref={cameraRef} facing="front" style={s.hiddenCamera} />;
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md },
  // Scrolls on small phones; top padding clears the status bar / Dynamic Island.
  configContainer: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, paddingTop: 72, paddingBottom: 48, gap: Spacing.md },
  hiddenCamera: { position: 'absolute', width: 1, height: 1, top: -10, left: -10, opacity: 0 },
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
  modeRow: { flexDirection: 'row', gap: Spacing.sm, width: '100%', marginTop: Spacing.md },
  modeCard: {
    flex: 1, alignItems: 'center', gap: 6, minHeight: 72, justifyContent: 'center',
    backgroundColor: Colors.bgCard, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.bgBorder, padding: Spacing.sm,
  },
  modeTitle: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  modeDesc: { fontSize: FontSize.xs, color: Colors.textSecondary, textAlign: 'center' },
  levelDesc: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 4, lineHeight: 16 },
  armedPulse: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: Colors.success + '55', alignItems: 'center', justifyContent: 'center' },
  armedDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.success },
  captureNote: { fontSize: FontSize.xs, color: Colors.textMuted, letterSpacing: 0.5, marginTop: -4 },
  alarmRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%',
    backgroundColor: Colors.bgCard, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.bgBorder, padding: Spacing.md,
  },
  alarmRowActive: { borderColor: Colors.warning + '77' },
  alarmTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textPrimary },
  alarmDesc:  { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  alarmToggle: {
    width: 44, height: 26, borderRadius: 13, backgroundColor: Colors.bgBorder,
    padding: 3, justifyContent: 'center',
  },
  alarmToggleOn: { backgroundColor: Colors.warning + '55' },
  alarmKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.textMuted },
  alarmKnobOn: { backgroundColor: Colors.warning, alignSelf: 'flex-end' },
  dimOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 48 },
  dimHint: { color: '#1E2D45', fontSize: FontSize.xs },
  primaryBtn: { marginTop: Spacing.lg, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 16, paddingHorizontal: 48, alignItems: 'center', alignSelf: 'stretch' },
  primaryText: { fontSize: FontSize.md, fontWeight: '800', color: Colors.bg, textAlign: 'center' },
  secondaryBtn: {
    marginTop: Spacing.md, borderWidth: 1, borderColor: Colors.primary + '55',
    backgroundColor: Colors.primaryGlow, borderRadius: Radius.md,
    paddingVertical: 14, alignItems: 'center', alignSelf: 'stretch',
  },
  secondaryText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  btnDisabled: { opacity: 0.6 },
  cancel: { marginTop: Spacing.md },
  cancelText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  linkText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
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
  recordReason: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textPrimary },
  recordTime: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  recordGeo: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  recordsHint: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: Spacing.md, textAlign: 'center' },
});
