/**
 * Navigation that is safe with modals open.
 *
 * Replacing a screen that is presented as a modal (Guardians, Paywall…) with a
 * regular one leaves an empty native modal covering the app: a black screen
 * that swallows every touch. Anything that can fire while a modal is up — the
 * lock on return from background, a remote lock or lost-mode command — closes
 * the modals first.
 */
import { router, type Href } from 'expo-router';

/** Close any open modals, then replace the current screen. */
export function resetTo(href: Href): void {
  if (router.canDismiss()) router.dismissAll();
  router.replace(href);
}

/** Leave a modal to open another screen on top of the app (e.g. sign-in). */
export function openFromModal(href: Href): void {
  if (router.canDismiss()) router.dismissAll();
  router.push(href);
}
