/**
 * Sign in with Apple server calls.
 *
 * App Store Review Guideline 5.1.1(v): an app that offers Sign in with Apple
 * must revoke the user's Apple tokens when they delete their account. That
 * needs a refresh token, which only comes from exchanging the one-time
 * `authorizationCode` the app receives at sign-in.
 *
 * Configure APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY (the .p8 key
 * contents; `\n` escapes are accepted). Without them both calls no-op.
 */
import appleSignin from 'apple-signin-auth';

const TEAM_ID = process.env.APPLE_TEAM_ID ?? '';
const KEY_ID = process.env.APPLE_KEY_ID ?? '';
const PRIVATE_KEY = (process.env.APPLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');

export const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID ?? 'dev.bonhomie95.phantomshield';
/** Services ID used by the web dashboard's Sign in with Apple (optional). */
export const APPLE_SERVICES_ID = process.env.APPLE_SERVICES_ID ?? '';

export const isAppleServerConfigured = (): boolean => Boolean(TEAM_ID && KEY_ID && PRIVATE_KEY);

function clientSecret(clientID: string): string {
  return appleSignin.getClientSecret({
    clientID,
    teamID: TEAM_ID,
    keyIdentifier: KEY_ID,
    privateKey: PRIVATE_KEY,
    expAfter: 300,
  });
}

async function post(path: string, form: Record<string, string>): Promise<Response> {
  return fetch(`https://appleid.apple.com/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
}

/** Exchange a native-app authorization code for Apple's refresh token. */
export async function exchangeAppleCode(code: string, clientID = APPLE_BUNDLE_ID): Promise<string | null> {
  if (!isAppleServerConfigured() || !code) return null;
  try {
    const res = await post('token', {
      client_id: clientID,
      client_secret: clientSecret(clientID),
      code,
      grant_type: 'authorization_code',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { refresh_token?: string };
    return data.refresh_token ?? null;
  } catch {
    return null;
  }
}

/** Revoke the user's Apple authorisation. Best-effort; never throws. */
export async function revokeAppleToken(refreshToken: string, clientID = APPLE_BUNDLE_ID): Promise<boolean> {
  if (!isAppleServerConfigured() || !refreshToken) return false;
  try {
    const res = await post('revoke', {
      client_id: clientID,
      client_secret: clientSecret(clientID),
      token: refreshToken,
      token_type_hint: 'refresh_token',
    });
    return res.ok;
  } catch {
    return false;
  }
}
