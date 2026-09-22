import React, { useState, useRef, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { PinPad } from '@/components/PinPad';
import { usePhantomStore } from '@/stores/phantom';
import { Colors, FontSize } from '@/constants/theme';
import { saveIntruderPhoto, clearAllIntruderPhotos } from '@/services/camera';
import { sendIntruderAlert } from '@/services/notifications';
import * as pinVault from '@/services/pinVault';
import { uploadIntruderEvent, uploadIntruderPhoto } from '@/services/api';
import { stopSiren } from '@/services/alarm';

/** Alert on the 3rd and 5th wrong attempt, then every 10th — not every one. */
const shouldAlertOnAttempts = (attempts: number) => attempts === 3 || attempts === 5 || attempts % 10 === 0;

export default function PinGateScreen() {
  usePreventScreenCapture('pin-gate');
  const {
    setAppUnlocked,
    isAuthenticated,
    addIntruderPhoto,
    addUnlockEvent,
    intruderSnapshotEnabled,
    autoWipeAfterAttempts,
    clearLogs,
  } = usePhantomStore();

  const [cameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  // With no PIN at all the app is simply unprotected — the gate lets it open.
  const [noProtection, setNoProtection] = useState(false);
  const layerLabel = 'PhantomShield';

  useEffect(() => {
    void pinVault.hasPin('app').then((has) => setNoProtection(!has));
  }, []);

  const verify = async (entered: string): Promise<boolean> =>
    noProtection || (await pinVault.verifyPin('app', entered)) || (await pinVault.verifyPin('decoy', entered));

  // ── Success ────────────────────────────────────────────────────────────────
  const handleSuccess = async (enteredPin: string) => {
    // Decoy PIN check — show fake empty dashboard instead of the real one. A
    // decoy-only match (not also a real gate-layer PIN) diverts to the decoy.
    if (!(await pinVault.verifyPin('app', enteredPin)) && (await pinVault.verifyPin('decoy', enteredPin))) {
      router.replace('/decoy-dashboard');
      return;
    }

    stopSiren();
    setAppUnlocked(true);
    addUnlockEvent({
      id:        `pin_ok_${Date.now()}`,
      timestamp: new Date().toISOString(),
      isAnomaly: false,
    });
    router.replace('/(tabs)');
  };

  const cancel = () => router.replace('/biometric-gate');

  // ── Failure — capture intruder photo ─────────────────────────────────────
  const handleFail = async (attempts: number) => {

    // Log this failed attempt as a suspicious unlock event
    addUnlockEvent({
      id:            `pin_fail_${Date.now()}`,
      timestamp:     new Date().toISOString(),
      isAnomaly:     true,
      anomalyReason: `Wrong PIN entered (attempt ${attempts})`,
    });

    // Auto-wipe: after the configured number of failed attempts, purge the
    // on-device sensitive logs and intruder photos so a brute-forcer can't reach
    // them. This is a LOCAL wipe only (paid users keep a server-side copy); it
    // never deletes the account.
    if (autoWipeAfterAttempts && attempts >= autoWipeAfterAttempts) {
      clearLogs();
      clearAllIntruderPhotos().catch(() => {});
    }

    // Capture an intruder photo if the owner opted in (and granted the camera
    // at that moment). Never prompt for permission here — the person holding
    // the phone now is not the owner.
    if (intruderSnapshotEnabled && cameraPermission?.granted) {
      if (cameraRef.current) {
        try {
          // Downscaling happens in saveIntruderPhoto().
          const photo = await cameraRef.current.takePictureAsync({
            quality: 0.6,
            shutterSound: false, // no shutter sound
          });

          if (photo?.uri) {
            const savedUri = await saveIntruderPhoto(photo.uri);
            const eventId  = `intruder_${Date.now()}`;
            addIntruderPhoto({
              id:            eventId,
              timestamp:     new Date().toISOString(),
              imageUri:      savedUri,
              trigger:       'wrong_pin',
              isAnomaly:     true, // every intruder photo is, by definition, an anomaly
              anomalyReason: `Wrong PIN entered (attempt ${attempts})`,
            });

            // Upload the photo to R2 (paid plans), then report the event with
            // its key. Best-effort — the free plan gets a 403/501 we swallow.
            if (isAuthenticated) (async () => {
              const key = await uploadIntruderPhoto(eventId, savedUri).catch(() => null);
              uploadIntruderEvent({
                id:            eventId,
                timestamp:     Date.now(),
                pinLayer:      'app',
                failedAttempt: attempts,
                encryptedPhotoKey: key ?? undefined,
              }).catch(() => {});
            })();

            // Only send alert on meaningful thresholds to avoid notification spam
            if (shouldAlertOnAttempts(attempts)) {
              sendIntruderAlert(layerLabel, attempts).catch(() => {});
            }
          }
        } catch {
          // Camera capture failed silently — don't crash the gate screen
        }
      }
    }
  };

  return (
    <View style={styles.container}>
      {/*
        Hidden 1×1 front-facing camera for silent intruder capture.
        It is rendered only when intruderSnapshotEnabled is true and
        the camera permission is granted or will be requested on first failure.
        The opacity:0 + absolute position keeps it invisible to the user.
      */}
      {intruderSnapshotEnabled && cameraPermission?.granted && (
        <CameraView
          ref={cameraRef}
          facing="front"
          style={styles.hiddenCamera}
        />
      )}

      <PinPad
        title={`Enter your ${layerLabel} PIN`}
        subtitle="Enter your 4-digit PIN to open the app."
        verify={verify}
        onSuccess={handleSuccess}
        onFail={handleFail}
        maxAttempts={10}
      />

      <TouchableOpacity onPress={cancel} style={styles.cancel} accessibilityRole="button">
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
    justifyContent: 'center',
    paddingBottom: 80,
  },
  // Invisible camera — 1×1 and absolutely positioned off-screen
  hiddenCamera: {
    position: 'absolute',
    width: 1,
    height: 1,
    top: -10,
    left: -10,
    opacity: 0,
  },
  cancel: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
  },
  cancelText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
});
