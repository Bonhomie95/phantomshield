/**
 * Intruder photo capture service.
 *
 * Used by pin-gate.tsx when a wrong PIN is entered.
 * The CameraView is rendered 1×1 off-screen inside the gate screen —
 * this is the standard pattern for silent capture in React Native.ƒƒ
 */
import { Platform } from 'react-native';
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
 * Move a freshly-taken photo from the camera's temp URI to the permanent store.
 * Returns the permanent URI.
 */
export async function saveIntruderPhoto(tempUri: string): Promise<string> {
  await ensureIntruderDir();
  const filename = `intruder_${Date.now()}.jpg`;
  const dest = `${INTRUDER_DIR}${filename}`;
  await FileSystem.moveAsync({ from: tempUri, to: dest });
  return dest;
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
