import { NextResponse } from 'next/server';
import { BACKEND, getAccessToken, refreshSession } from '@/lib/server/backend';

export const dynamic = 'force-dynamic';

// The WebSocket connects directly to the backend and can't carry the httpOnly
// cookie. Rather than hand the browser the real access token, we exchange the
// server-side session for a single-use, ~30s WS ticket minted by the backend.
export async function GET() {
  const mint = async (token?: string) =>
    fetch(`${BACKEND}/auth/ws-ticket`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
    }).catch(() => null);

  let res = await mint(getAccessToken());
  if (!res || res.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) res = await mint(refreshed);
  }

  if (!res || !res.ok) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const data = await res.json().catch(() => null);
  if (!data?.ticket) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  return NextResponse.json({ ticket: data.ticket });
}
