/**
 * Intruder photo capture service.
 *
 * Used by pin-gate.tsx when a wrong PIN is entered.
 * The CameraView is rendered 1×1 off-screen inside the gate screen —
 * this is the standard pattern for background capture in React Native.
 */
import * as FileSystem from 'expo-file-system/legacy';

/** Directory where intruder photos are stored. */
export const INTRUDER_DIR = `${FileSystem.documentDirectory}intruder-photos/`;

/** Ensure the directory exists. Call once on app start. */
export async function ensureIntruderDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(INTRUDER_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(INTRUDER_DIR, { intermediates: true });
  }
}

/**
 * Longest edge, in pixels, that a stored intruder photo is downscaled to.
 *
 * A modern front camera produces ~0.8–1.5MB per JPEG at full resolution, and
 * every one of those bytes is multiplied through on-device storage, the mobile
 * data budget, and cloud storage that is retained for a year. 1280px is roughly
 * an order of magnitude smaller and loses nothing that matters for recognising
 * a face. `expo-camera` has no native resize option (its `scale` is web-only),
 * so the resize happens here, in the single place every capture path passes
 * through.
 */
const MAX_PHOTO_EDGE = 1280;
const PHOTO_QUALITY = 0.6;

/**
 * Move a freshly-taken photo from the camera's temp URI to the permanent store,
 * downscaling it on the way. Returns the permanent URI.
 */
export async function saveIntruderPhoto(tempUri: string): Promise<string> {
  await ensureIntruderDir();
  const filename = `intruder_${Date.now()}.jpg`;
  const dest = `${INTRUDER_DIR}${filename}`;

  try {
    // Dynamic import so a missing native module can never break evidence
    // capture — the raw photo is still saved by the fallback below.
    const ImageManipulator = await import('expo-image-manipulator');
    const result = await ImageManipulator.manipulateAsync(
      tempUri,
      [{ resize: { width: MAX_PHOTO_EDGE } }],
      { compress: PHOTO_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
    );
    await FileSystem.moveAsync({ from: result.uri, to: dest });
    // Best-effort cleanup of the full-size original.
    await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
    return dest;
  } catch {
    // Never lose the evidence over a resize failure.
    await FileSystem.moveAsync({ from: tempUri, to: dest });
    return dest;
  }
}

/** Delete a specific intruder photo from disk. */
export async function deleteIntruderPhoto(uri: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(uri);
  if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
}

/** Delete ALL intruder photos from disk. */
export async function clearAllIntruderPhotos(): Promise<void> {
  const info = await FileSystem.getInfoAsync(INTRUDER_DIR);
  if (info.exists) {
    await FileSystem.deleteAsync(INTRUDER_DIR, { idempotent: true });
    await FileSystem.makeDirectoryAsync(INTRUDER_DIR, { intermediates: true });
  }
}
