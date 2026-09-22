/**
 * Anti-theft siren. Plays a loud looping alarm through expo-audio, forced to
 * the loudest available output and ignoring the silent switch.
 *
 * The siren plays while the app is foregrounded (which is when the remote
 * `send_alert` command is applied). We deliberately do NOT request background
 * audio: `app.json` UIBackgroundModes omits `audio`, so `shouldPlayInBackground`
 * would silently fail on iOS and invite review scrutiny for an unused capability.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

const SIREN = require('@/assets/sounds/siren.m4a');

// Safety cap so a remote-triggered siren can never sound forever if no one is
// present to stop it manually.
const MAX_SIREN_MS = 60_000;

let player: AudioPlayer | null = null;
let autoStop: ReturnType<typeof setTimeout> | null = null;

/** Start the siren. Auto-stops after `durationMs` (default 60s) as a backstop. */
export async function startSiren(durationMs: number = MAX_SIREN_MS): Promise<void> {
  if (player) return; // already sounding
  try {
    // Play even when the phone is on silent.
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'doNotMix',
    });
    player = createAudioPlayer(SIREN);
    player.loop = true;
    player.volume = 1.0;
    player.play();
    if (autoStop) clearTimeout(autoStop);
    autoStop = setTimeout(() => stopSiren(), durationMs);
  } catch {
    player = null;
  }
}

export function stopSiren(): void {
  try {
    if (autoStop) { clearTimeout(autoStop); autoStop = null; }
    player?.pause();
    player?.remove();
  } catch {
    // ignore
  } finally {
    player = null;
  }
}

export function isSirenActive(): boolean {
  return player !== null;
}
