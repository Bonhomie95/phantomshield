/**
 * Remote command handling — the device side of "control my phone from the web".
 *
 * Commands arrive by two routes and are applied by ONE handler so the two can
 * never drift:
 *   • the WebSocket, the instant they are issued (see services/realtime.ts),
 *   • an HTTP drain on foreground, which catches anything queued while offline.
 */
import { resetTo } from '@/services/navigation';
import type { DeviceCommand } from '@phantomshield/shared';
import { usePhantomStore } from '@/stores/phantom';
import { fetchDeviceCommands, reportLocation } from '@/services/api';
import { sendTamperAlert, presentLostModeNotification } from '@/services/notifications';
import { startSiren } from '@/services/alarm';

/** Commands the device knows how to execute. */
export type ApplicableCommand = DeviceCommand;

/**
 * Apply one command. Idempotent and safe to call twice — the socket and the
 * poll can legitimately deliver the same command, and re-locking or re-wiping
 * an already-wiped device is harmless.
 */
export async function applyCommand(command: string, payload?: unknown): Promise<void> {
  const store = usePhantomStore.getState();

  switch (command as ApplicableCommand) {
    case 'lock_app':
      // Force re-authentication and re-lock every protected layer.
      store.setAppUnlocked(false);
      resetTo('/biometric-gate');
      break;

    case 'lost_mode': {
      // The owner's message for whoever finds this phone: on the lock screen
      // (notification) and filling the app (the lost screen).
      const p = (payload ?? {}) as { message?: unknown; contact?: unknown };
      const message = typeof p.message === 'string' && p.message ? p.message.slice(0, 200) : 'This phone is lost.';
      const contact = typeof p.contact === 'string' ? p.contact.slice(0, 60) : '';
      store.setLostMode({ message, contact, since: new Date().toISOString() });
      store.setAppUnlocked(false);
      await presentLostModeNotification(message, contact).catch(() => {});
      resetTo('/lost');
      break;
    }

    case 'lost_mode_off':
      store.setLostMode(null);
      break;

    case 'send_alert':
      // Remote "find my phone": notification AND a siren that stops itself.
      await sendTamperAlert().catch(() => {});
      await startSiren().catch(() => {});
      break;

    case 'locate':
      await reportLocation().catch(() => {});
      break;

    default:
      // Unknown command from a newer server — ignore rather than crash.
      break;
  }
}

/** Drain any commands queued while this device was offline. */
export async function pollAndApplyCommands(): Promise<void> {
  const store = usePhantomStore.getState();
  if (!store.isAuthenticated) return;

  const commands = await fetchDeviceCommands().catch(() => []);
  for (const { command, payload } of commands) {
    await applyCommand(command, payload);
  }
}
