/**
 * PIN vault — stores PINs as salted SHA-256 hashes in the OS keychain
 * (expo-secure-store), never in plaintext and never in AsyncStorage.
 *
 * Each layer's PIN gets its own random 16-byte salt so identical PINs across
 * layers produce different hashes, and a stolen AsyncStorage backup reveals
 * nothing. Verification is a constant-time hex compare.
 */
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { PINLayer } from '@/constants/types';

const ALL_LAYERS: PINLayer[] = ['dashboard', 'logs', 'vault', 'settings', 'decoy'];

const keyFor = (layer: PINLayer) => `ps_pin_${layer}`;

interface StoredPin {
  salt: string;
  hash: string;
}

async function hashPin(salt: string, pin: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Length-safe, constant-time comparison of two equal-length hex digests. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function setPin(layer: PINLayer, pin: string): Promise<void> {
  const salt = toHex(await Crypto.getRandomBytesAsync(16));
  const hash = await hashPin(salt, pin);
  const payload: StoredPin = { salt, hash };
  await SecureStore.setItemAsync(keyFor(layer), JSON.stringify(payload));
}

export async function verifyPin(layer: PINLayer, pin: string): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(keyFor(layer));
  if (!raw) return false;
  try {
    const { salt, hash } = JSON.parse(raw) as StoredPin;
    const candidate = await hashPin(salt, pin);
    return timingSafeEqual(candidate, hash);
  } catch {
    return false;
  }
}

export async function hasPin(layer: PINLayer): Promise<boolean> {
  return (await SecureStore.getItemAsync(keyFor(layer))) !== null;
}

/** True if a PIN is configured on any layer. */
export async function hasAnyPin(): Promise<boolean> {
  const results = await Promise.all(ALL_LAYERS.map((l) => hasPin(l)));
  return results.some(Boolean);
}

export async function clearPin(layer: PINLayer): Promise<void> {
  await SecureStore.deleteItemAsync(keyFor(layer));
}

export async function clearAllPins(): Promise<void> {
  await Promise.all(ALL_LAYERS.map((l) => SecureStore.deleteItemAsync(keyFor(l))));
}

// ─── Brute-force lockout (persisted) ──────────────────────────────────────────
// The lockout lives in the keychain, not component state, so force-quitting and
// relaunching the app can't reset the attempt counter and bypass the wait.

const LOCK_KEY = 'ps_pin_lock';

export interface LockState {
  attempts: number;
  /** epoch ms until which entry is blocked; 0 = not locked. */
  lockedUntil: number;
}

/** Escalating lockout: 3 fails → 5s, 7 → 30s, 10+ → 60s. */
function lockoutMsFor(attempts: number): number {
  if (attempts >= 10) return 60_000;
  if (attempts >= 7) return 30_000;
  if (attempts >= 3) return 5_000;
  return 0;
}

export async function getLockState(): Promise<LockState> {
  const raw = await SecureStore.getItemAsync(LOCK_KEY);
  if (!raw) return { attempts: 0, lockedUntil: 0 };
  try {
    const parsed = JSON.parse(raw) as LockState;
    return { attempts: parsed.attempts ?? 0, lockedUntil: parsed.lockedUntil ?? 0 };
  } catch {
    return { attempts: 0, lockedUntil: 0 };
  }
}

export async function registerFailedAttempt(): Promise<LockState> {
  const cur = await getLockState();
  const attempts = cur.attempts + 1;
  const ms = lockoutMsFor(attempts);
  const next: LockState = { attempts, lockedUntil: ms > 0 ? Date.now() + ms : cur.lockedUntil };
  await SecureStore.setItemAsync(LOCK_KEY, JSON.stringify(next));
  return next;
}

export async function resetAttempts(): Promise<void> {
  await SecureStore.deleteItemAsync(LOCK_KEY);
}
