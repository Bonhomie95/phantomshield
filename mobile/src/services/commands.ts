/**
 * Remote command handling. The dashboard/backend queue commands per device
 * (lock, wipe logs, alert); the app drains and applies them on foreground and
 * on WebSocket/poll. This is the device side of the "remote control" feature.
 */
import { router } from 'expo-router';
import { usePhantomStore } from '@/stores/phantom';
import { fetchDeviceCommands } from '@/services/api';
import { clearAllIntruderPhotos } from '@/services/camera';
import { sendTamperAlert } from '@/services/notifications';

export async function pollAndApplyCommands(): Promise<void> {
  const store = usePhantomStore.getState();
  if (!store.isAuthenticated) return;

  const commands = await fetchDeviceCommands().catch(() => []);
  for (const { command } of commands) {
    switch (command) {
      case 'lock_app':
        // Force re-authentication and re-lock every protected layer.
        store.setAppUnlocked(false);
        store.lockAllLayers();
        router.replace('/biometric-gate');
        break;

      case 'wipe_logs':
        store.clearLogs();
        await clearAllIntruderPhotos().catch(() => {});
        break;

      case 'send_alert':
        await sendTamperAlert().catch(() => {});
        break;
    }
  }
}
