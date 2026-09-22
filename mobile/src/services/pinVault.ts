/**
 * PIN vault — stores PINs as salted SHA-256 hashes in the OS keychain
 * (expo-secure-store), never in plaintext and never in AsyncStorage.
 *
 * There is one app PIN and an optional decoy PIN. Each gets its own random
 * 16-byte salt, and verification is a constant-time hex compare.
 *
 * Older builds had a PIN per section (dashboard / logs / vault / settings).
 * Any of those still opens the app; the first one that matches becomes the
 * app PIN and the rest are deleted, so upgrading never locks anyone out.
 */
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { PINLayer } from '@/constants/types';

const LEGACY_LAYERS = ['settings', 'dashboard', 'vault', 'logs'] as const;
type StoredLayer = PINLayer | (typeof LEGACY_LAYERS)[number];

const keyFor = (layer: StoredLayer) => `ps_pin_${layer}`;

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
  if (layer === 'app') await dropLegacy();
}

const dropLegacy = () => Promise.all(LEGACY_LAYERS.map((l) => SecureStore.deleteItemAsync(keyFor(l)))).then(() => {});

async function matches(layer: StoredLayer, pin: string): Promise<boolean> {
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

export async function verifyPin(layer: PINLayer, pin: string): Promise<boolean> {
  if (await matches(layer, pin)) return true;
  if (layer !== 'app' || (await SecureStore.getItemAsync(keyFor('app'))) !== null) return false;
  // Upgrade path: a PIN from the old per-section model opens the app once and
  // becomes the app PIN.
  for (const l of LEGACY_LAYERS) {
    if (await matches(l, pin)) {
      await setPin('app', pin);
      return true;
    }
  }
  return false;
}

export async function hasPin(layer: PINLayer): Promise<boolean> {
  if ((await SecureStore.getItemAsync(keyFor(layer))) !== null) return true;
  if (layer !== 'app') return false;
  for (const l of LEGACY_LAYERS) if ((await SecureStore.getItemAsync(keyFor(l))) !== null) return true;
  return false;
}

// ─── First-run setup permission ───────────────────────────────────────────────
// The PIN setup screen can overwrite PINs, so it must not be openable by a deep
// link. Onboarding grants a one-shot, in-memory allowance (a URL can't set it);
// after that, it requires the unlocked app.
let firstRunSetupAllowed = false;
export const allowFirstRunSetup = () => { firstRunSetupAllowed = true; };
export const consumeFirstRunSetup = (): boolean => {
  const ok = firstRunSetupAllowed;
  firstRunSetupAllowed = false;
  return ok;
};

/** Trivially guessable PINs: one repeated digit, or a straight run (1234 / 9876). */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const d = pin.split('').map(Number);
  const steps = d.slice(1).map((v, i) => v - d[i]);
  return steps.every((x) => x === 1) || steps.every((x) => x === -1);
}

export async function removePin(layer: PINLayer): Promise<void> {
  await SecureStore.deleteItemAsync(keyFor(layer));
}

export async function clearAllPins(): Promise<void> {
  await Promise.all([
    ...(['app', 'decoy', ...LEGACY_LAYERS] as StoredLayer[]).map((l) => SecureStore.deleteItemAsync(keyFor(l))),
    // Lockout counters too, so the next owner of this install starts clean.
    ...['', '_guard', '_lost'].map((c) => SecureStore.deleteItemAsync(`ps_pin_lock${c}`)),
  ]);
}

// ─── Brute-force lockout (persisted) ──────────────────────────────────────────
// The lockout lives in the keychain, not component state, so force-quitting and
// relaunching the app can't reset the attempt counter and bypass the wait.

// Lockout is namespaced by CONTEXT so distinct gates don't share one counter:
// failing the Guard-stop pad must not lock the owner out of the app gate, and a
// coercer hammering one gate can't lock every gate. The default context keeps
// the original single-counter behaviour for the app gate.
const LOCK_KEY_BASE = 'ps_pin_lock';
export type LockContext = string;
const lockKey = (context?: LockContext) =>
  context ? `${LOCK_KEY_BASE}_${context}` : LOCK_KEY_BASE;

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

export async function getLockState(context?: LockContext): Promise<LockState> {
  const raw = await SecureStore.getItemAsync(lockKey(context));
  if (!raw) return { attempts: 0, lockedUntil: 0 };
  try {
    const parsed = JSON.parse(raw) as LockState;
    return { attempts: parsed.attempts ?? 0, lockedUntil: parsed.lockedUntil ?? 0 };
  } catch {
    return { attempts: 0, lockedUntil: 0 };
  }
}

export async function registerFailedAttempt(context?: LockContext): Promise<LockState> {
  const cur = await getLockState(context);
  const attempts = cur.attempts + 1;
  const ms = lockoutMsFor(attempts);
  const next: LockState = { attempts, lockedUntil: ms > 0 ? Date.now() + ms : cur.lockedUntil };
  await SecureStore.setItemAsync(lockKey(context), JSON.stringify(next));
  return next;
}

export async function resetAttempts(context?: LockContext): Promise<void> {
  await SecureStore.deleteItemAsync(lockKey(context));
}
