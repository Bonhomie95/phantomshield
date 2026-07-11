import { Platform } from 'react-native';

export interface ForegroundEvent {
  /** Android package name of the app that came to the foreground. */
  packageName: string;
  /** epoch ms */
  timestamp: number;
}

interface UsageStatsNativeModule {
  hasPermission(): boolean;
  openSettings(): void;
  queryForegroundEvents(startMs: number, endMs: number): Promise<ForegroundEvent[]>;
}

// Android-only native module. On iOS (and Expo Go) it isn't linked, so we guard
// the require and expose safe no-ops — there is no iOS equivalent of UsageStats.
let native: UsageStatsNativeModule | null = null;
if (Platform.OS === 'android') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { requireNativeModule } = require('expo-modules-core');
    native = requireNativeModule('UsageStats');
  } catch {
    native = null;
  }
}

export function isSupported(): boolean {
  return native !== null;
}

export function hasUsagePermission(): boolean {
  try {
    return native?.hasPermission() ?? false;
  } catch {
    return false;
  }
}

export function openUsageAccessSettings(): void {
  try {
    native?.openSettings();
  } catch {
    /* ignore */
  }
}

export async function queryForegroundEvents(
  startMs: number,
  endMs: number,
): Promise<ForegroundEvent[]> {
  try {
    return (await native?.queryForegroundEvents(startMs, endMs)) ?? [];
  } catch {
    return [];
  }
}
