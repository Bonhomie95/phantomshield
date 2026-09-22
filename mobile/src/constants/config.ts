/**
 * PhantomShield runtime config. Values come from EXPO_PUBLIC_* env vars at
 * build time (see mobile/.env.example).
 */

// Base URL must include the backend's /api prefix and the correct port (3002).
// Override per-environment via EXPO_PUBLIC_API_URL, e.g.
//   http://192.168.1.10:3002/api   (LAN dev — set this in mobile/.env)
//   https://api.phantomshield.app/api   (production)
// The fallback is the PRODUCTION https endpoint: a release build with the env
// var unset must never ship pointing at a cleartext LAN address (tokens would
// traverse in the clear, and iOS ATS blocks it anyway).
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "https://api.phantomshield.app/api";

export const GOOGLE = {
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "",
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "",
};

// Public legal pages — required by both app stores. Override per-environment if
// your policy lives elsewhere.
export const LEGAL = {
  terms:   process.env.EXPO_PUBLIC_TERMS_URL ?? "https://app.phantomshield.app/terms",
  privacy: process.env.EXPO_PUBLIC_PRIVACY_URL ?? "https://app.phantomshield.app/privacy",
};

/** Public help page (also the App Store "Support URL"). */
export const SUPPORT_URL =
  process.env.EXPO_PUBLIC_SUPPORT_URL ?? "https://app.phantomshield.app/support";

/** Web dashboard, for Find My Phone from another device. */
export const DASHBOARD_URL =
  process.env.EXPO_PUBLIC_DASHBOARD_URL ?? "https://app.phantomshield.app";

/** Public page shared by "Share PhantomShield" (no reward attached). */
export const SHARE_URL =
  process.env.EXPO_PUBLIC_SHARE_URL ?? "https://phantomshield.app";
