import React, { useState, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { PinPad } from '@/components/PinPad';
import { usePhantomStore } from '@/stores/phantom';
import { PINLayer } from '@/constants/types';
import { Colors, Spacing, FontSize } from '@/constants/theme';
import { saveIntruderPhoto } from '@/services/camera';
import { sendIntruderAlert } from '@/services/notifications';
import { checkTimeAnomaly } from '@/services/anomaly';
import { shouldAlertOnAttempts } from '@/services/anomaly';
import * as pinVault from '@/services/pinVault';
import { uploadIntruderEvent } from '@/services/api';

const LAYER_LABELS: Record<PINLayer, string> = {
  dashboard: 'Dashboard',
  logs:      'Activity Logs',
  vault:     'Secure Vault',
  settings:  'Settings',
  decoy:     '',
};

export default function PinGateScreen() {
  const { layer, redirect } = useLocalSearchParams<{ layer: PINLayer; redirect: string }>();
  const {
    unlockLayer,
    addIntruderPhoto,
    addUnlockEvent,
    intruderSnapshotEnabled,
    safeZones,
  } = usePhantomStore();

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [attemptCount, setAttemptCount] = useState(0);

  const layerLabel = LAYER_LABELS[layer ?? 'dashboard'];

  // Accept the entered PIN if it matches this layer's PIN, the decoy PIN, or
  // if the layer has no PIN configured. Hashes are checked in the vault.
  const verify = async (entered: string): Promise<boolean> => {
    if (!layer) return true;
    if (await pinVault.verifyPin(layer, entered)) return true;
    if (await pinVault.verifyPin('decoy', entered)) return true;
    return !(await pinVault.hasPin(layer));
  };

  // ── Success ────────────────────────────────────────────────────────────────
  const handleSuccess = async (enteredPin: string) => {
    // Decoy PIN check — show fake empty dashboard instead of the real one.
    const isDecoy = await pinVault.verifyPin('decoy', enteredPin);
    const isReal  = layer ? await pinVault.verifyPin(layer, enteredPin) : false;
    if (isDecoy && !isReal) {
      router.replace('/decoy-dashboard');
      return;
    }

    if (layer) unlockLayer(layer);

    // Log this as a normal unlock event
    const anomaly = checkTimeAnomaly(new Date(), safeZones);
    addUnlockEvent({
      id:            `pin_ok_${Date.now()}`,
      timestamp:     new Date().toISOString(),
      isAnomaly:     anomaly.isAnomaly,
      anomalyReason: anomaly.reason,
    });

    if (redirect) {
      router.replace(redirect as any);
    } else {
      router.back();
    }
  };

  // ── Failure — capture intruder photo ─────────────────────────────────────
  const handleFail = async (attempts: number) => {
    setAttemptCount(attempts);

    // Log this failed attempt as a suspicious unlock event
    addUnlockEvent({
      id:            `pin_fail_${Date.now()}`,
      timestamp:     new Date().toISOString(),
      isAnomaly:     true,
      anomalyReason: `Wrong PIN entered for ${layerLabel} (attempt ${attempts})`,
    });

    // Capture intruder photo if the feature is enabled
    if (intruderSnapshotEnabled) {
      // Request camera permission lazily on first failure
      let permGranted = cameraPermission?.granted ?? false;
      if (!permGranted) {
        const result = await requestCameraPermission();
        permGranted = result.granted;
      }

      if (permGranted && cameraRef.current) {
        try {
          const photo = await cameraRef.current.takePictureAsync({
            quality: 0.5,
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
              anomalyReason: `Wrong PIN entered for ${layerLabel} (attempt ${attempts})`,
            });

            // Report the intruder event to the backend (best-effort — the free
            // plan gets a 403 here, which we swallow). Photo stays on-device
            // until client-side encrypted upload is implemented.
            uploadIntruderEvent({
              id:            eventId,
              timestamp:     Date.now(),
              pinLayer:      layer ?? 'unknown',
              failedAttempt: attempts,
            }).catch(() => {});

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
      {intruderSnapshotEnabled && (
        <CameraView
          ref={cameraRef}
          facing="front"
          style={styles.hiddenCamera}
        />
      )}

      <PinPad
        title={`Enter ${layerLabel} PIN`}
        subtitle="This area is protected. Enter your 4-digit PIN."
        verify={verify}
        onSuccess={handleSuccess}
        onFail={handleFail}
        maxAttempts={10}
      />

      <TouchableOpacity onPress={() => router.back()} style={styles.cancel}>
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
