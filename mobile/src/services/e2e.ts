/**
 * End-to-end encrypted photo backup.
 *
 * When the owner turns this on, the phone makes a random 256-bit key, keeps it
 * in the keychain, and shows it ONCE as a recovery key. Every intruder photo is
 * then sealed with AES-256-GCM before upload, bound to its event id, so the
 * server stores bytes it cannot read — and cannot swap between events. The web
 * dashboard asks for the recovery key to open them.
 *
 * The honest trade-off, stated in the UI: lose the recovery key and those
 * photos are gone for good. Nobody, including us, can get them back.
 */
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { gcm } from '@noble/ciphers/aes.js';
import { encodeRecoveryKey, decodeRecoveryKey, ENCRYPTED_PHOTO_MAGIC } from '@phantomshield/shared';

const KEY_ITEM = 'ps_photo_key';

const toHex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));

// Chunked so a ~300KB photo doesn't blow the argument limit of fromCharCode.
function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** SHA-256 of the key, hex. The server keeps this to recognise the right key. */
export async function keyCheck(key: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(key))));
}

export function createPhotoKey(): { key: Uint8Array; recoveryKey: string } {
  const key = Crypto.getRandomBytes(32);
  return { key, recoveryKey: encodeRecoveryKey(key) };
}

export const parseRecoveryKey = decodeRecoveryKey;

export async function savePhotoKey(key: Uint8Array): Promise<void> {
  await SecureStore.setItemAsync(KEY_ITEM, toHex(key), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function getPhotoKey(): Promise<Uint8Array | null> {
  const hex = await SecureStore.getItemAsync(KEY_ITEM);
  return hex && hex.length === 64 ? fromHex(hex) : null;
}

export async function forgetPhotoKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_ITEM);
}

/** The key again, as the owner saw it — for "show my recovery key". */
export async function currentRecoveryKey(): Promise<string | null> {
  const key = await getPhotoKey();
  return key ? encodeRecoveryKey(key) : null;
}

/** MAGIC || nonce || AES-256-GCM(photo), with the event id as associated data. */
export function sealPhoto(key: Uint8Array, eventId: string, plain: Uint8Array): Uint8Array {
  const nonce = Crypto.getRandomBytes(12);
  const aad = new TextEncoder().encode(eventId);
  const sealed = gcm(key, nonce, aad).encrypt(plain);
  const out = new Uint8Array(4 + 12 + sealed.length);
  out.set(ENCRYPTED_PHOTO_MAGIC, 0);
  out.set(nonce, 4);
  out.set(sealed, 16);
  return out;
}

/** Inverse of sealPhoto; throws on a wrong key or tampered bytes. */
export function openPhoto(key: Uint8Array, eventId: string, blob: Uint8Array): Uint8Array {
  if (!ENCRYPTED_PHOTO_MAGIC.every((b, i) => blob[i] === b)) throw new Error('not an encrypted photo');
  const aad = new TextEncoder().encode(eventId);
  return gcm(key, blob.subarray(4, 16), aad).decrypt(blob.subarray(16));
}

/** Encrypt a photo file into a temporary file ready to upload. */
export async function sealPhotoFile(key: Uint8Array, eventId: string, fileUri: string): Promise<string> {
  const plain = fromBase64(await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 }));
  const out = `${FileSystem.cacheDirectory}sealed_${eventId}.bin`;
  await FileSystem.writeAsStringAsync(out, toBase64(sealPhoto(key, eventId, plain)), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return out;
}
