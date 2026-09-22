/**
 * One-tap arming from outside the app.
 *
 * Every entry point resolves to the same deep link, which the Guard Mode screen
 * understands: `phantomshield://guard-mode?arm=1&mode=<table|charger|pocket>`.
 *   • Home-screen quick actions (long-press the icon) — both platforms.
 *   • Siri, Spotlight, the Shortcuts app and the Action Button — iOS, through
 *     the App Intent added by plugins/withArmGuardIntent.js.
 *   • Shortcuts automations ("when the charger is disconnected…") — iOS, by
 *     running the same App Shortcut.
 * Arming needs no unlock (it reveals nothing); stopping always needs the PIN.
 */
import { Platform } from 'react-native';
import * as QuickActions from 'expo-quick-actions';
import type { GuardMode } from '@/constants/types';

export const armHref = (mode: GuardMode = 'table') => `/guard-mode?arm=1&mode=${mode}`;

export async function installQuickActions(pocketAvailable: boolean): Promise<void> {
  const ios = Platform.OS === 'ios';
  const items: QuickActions.Action[] = [
    {
      id: 'arm-table',
      title: 'Arm Guard Mode',
      subtitle: 'Phone on a table',
      icon: ios ? 'symbol:shield.lefthalf.filled' : undefined,
      params: { href: armHref('table') },
    },
    {
      id: 'arm-charger',
      title: 'Charger alarm',
      subtitle: 'Alarm if it’s unplugged',
      icon: ios ? 'symbol:powerplug' : undefined,
      params: { href: armHref('charger') },
    },
  ];
  if (pocketAvailable) {
    items.push({ id: 'arm-pocket', title: 'Pocket alarm', params: { href: armHref('pocket') } });
  }
  if (await QuickActions.isSupported().catch(() => false)) {
    await QuickActions.setItems(items).catch(() => {});
  }
}

let initialConsumed = false;

/** The quick action that cold-started the app, once. */
export function takeInitialArmHref(): string | null {
  if (initialConsumed) return null;
  initialConsumed = true;
  const href = QuickActions.initial?.params?.href;
  return typeof href === 'string' ? href : null;
}

/** Quick actions chosen while the app is already running. */
export function onArmAction(go: (href: string) => void): () => void {
  const sub = QuickActions.addListener((action) => {
    const href = action.params?.href;
    if (typeof href === 'string') go(href);
  });
  return () => sub.remove();
}
