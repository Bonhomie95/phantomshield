import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { BACKEND, REFRESH_COOKIE, clearAuthCookies, getAccessToken, getDeviceId, refreshSession } from '@/lib/server/backend';
import { isSameOrigin } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Prevent forced-logout CSRF: only same-origin requests may end the session.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked.' }, { status: 403 });
  }

  // /auth/logout is authenticated: without the bearer token it 401s and the
  // session was never actually revoked server-side.
  const refreshToken = cookies().get(REFRESH_COOKIE)?.value;
  const deviceId = getDeviceId() ?? '';
  const call = (token: string) =>
    fetch(`${BACKEND}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Device-Id': deviceId },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    }).catch(() => null);

  let token = getAccessToken();
  if (!token && refreshToken) token = (await refreshSession()) ?? undefined;
  if (token) {
    const res = await call(token);
    if (res?.status === 401 && refreshToken) {
      const fresh = await refreshSession();
      if (fresh) await call(fresh);
    }
  }
  clearAuthCookies();
  return NextResponse.json({ ok: true });
}
