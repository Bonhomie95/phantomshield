import { NextRequest, NextResponse } from 'next/server';
import { BACKEND, setAuthCookies, setDeviceCookie } from '@/lib/server/backend';
import { isSameOrigin } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

// Exchange a Google ID token for a session, storing the tokens in httpOnly
// cookies. The browser never sees them.
export async function POST(req: NextRequest) {
  // Login CSRF (forcing a victim into the attacker's session) is prevented by
  // requiring the request to originate from our own site.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked.' }, { status: 403 });
  }

  const { idToken, deviceId, provider = 'google' } = await req.json().catch(() => ({}));
  if (typeof idToken !== 'string' || typeof deviceId !== 'string' || !/^web_[\w-]{8,64}$/.test(deviceId)) {
    return NextResponse.json({ error: 'Missing idToken or deviceId.' }, { status: 400 });
  }
  if (provider !== 'google' && provider !== 'apple') {
    return NextResponse.json({ error: 'Unsupported provider.' }, { status: 400 });
  }

  const res = await fetch(`${BACKEND}/auth/oauth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider,
      idToken,
      device: { deviceId, platform: 'web' },
    }),
    cache: 'no-store',
  }).catch(() => null);

  const data = res ? await res.json().catch(() => null) : null;
  if (!res || !res.ok || !data?.accessToken) {
    return NextResponse.json(
      { error: data?.error ?? 'Sign-in failed.' },
      { status: res?.status ?? 502 },
    );
  }

  setAuthCookies(data.accessToken, data.refreshToken);
  // Bind the device server-side so refresh/ws-ticket don't depend on a
  // client-supplied deviceId (which the backend binds tokens to).
  setDeviceCookie(deviceId);
  return NextResponse.json({ user: data.user, isNewUser: data.isNewUser });
}
