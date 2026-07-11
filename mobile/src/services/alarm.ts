/**
 * Anti-theft siren. Plays a loud looping alarm through expo-audio, forced to
 * the loudest available output and ignoring the silent switch.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const SIREN = require('@/assets/sounds/siren.wav');

let player: AudioPlayer | null = null;

export async function startSiren(): Promise<void> {
  if (player) return; // already sounding
  try {
    // Play even when the phone is on silent / in the background momentarily.
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    });
    player = createAudioPlayer(SIREN);
    player.loop = true;
    player.volume = 1.0;
    player.play();
  } catch {
    player = null;
  }
}

export function stopSiren(): void {
  try {
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
