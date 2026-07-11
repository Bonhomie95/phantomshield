/**
 * Share-the-catch. An intruder selfie is inherently shareable ("look who tried
 * to open my phone"), which is the cheapest organic-install engine we have.
 */
import * as Sharing from 'expo-sharing';
import { track } from '@/services/analytics';

const DEFAULT_CAPTION =
  'Caught with PhantomShield 🛡 — it alarms + snaps a photo when someone touches my phone.';

export async function shareCatch(imageUri: string, caption: string = DEFAULT_CAPTION): Promise<void> {
  try {
    if (!(await Sharing.isAvailableAsync())) return;
    track('share_catch');
    await Sharing.shareAsync(imageUri, {
      dialogTitle: caption,
      mimeType: 'image/jpeg',
      UTI: 'public.jpeg',
    });
  } catch {
    // user cancelled or sharing unavailable
  }
}
