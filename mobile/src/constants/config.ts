/**
 * PhantomShield runtime config.
 *
 * ⚙️  GOOGLE SIGN-IN SETUP:
 *
 * 1. Go to https://console.cloud.google.com
 * 2. Create a project → APIs & Services → Credentials → Create OAuth Client ID
 * 3. Create a "Web application" client ID
 *    - Add your SHA-1 fingerprint under "Android" if prompted
 * 4. Copy the Web Client ID (ends in .apps.googleusercontent.com)
 * 5. Add to your .env file at the project root:
 *
 *    EXPO_PUBLIC_API_URL=https://api.phantomshield.app
 *    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=xxxx.apps.googleusercontent.com
 *
 * Note: @react-native-google-signin only needs the webClientId.
 * No iosClientId or androidClientId required.
 *
 * ⚙️  APPLE SIGN-IN:
 * Already configured via `usesAppleSignIn: true` in app.json.
 * Works automatically in production builds signed with your Apple Developer account.
 */

// Base URL must include the backend's /api prefix and the correct port (3002).
// Override per-environment via EXPO_PUBLIC_API_URL, e.g.
//   http://192.168.1.10:3002/api   (LAN dev)
//   https://api.phantomshield.app/api   (production)
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://192.168.100.44:3002/api";

export const GOOGLE = {
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "",
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "",
};
