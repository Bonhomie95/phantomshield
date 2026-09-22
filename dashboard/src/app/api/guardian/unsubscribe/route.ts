import { NextRequest, NextResponse } from 'next/server';
import { BACKEND } from '@/lib/server/backend';
import { isSameOrigin } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

// Public (no session): a guardian stops alert emails. POST-only — email
// scanners prefetch GET links and must not unsubscribe anyone.
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked.' }, { status: 403 });
  }
  const { token } = await req.json().catch(() => ({ token: undefined }));
  const res = await fetch(`${BACKEND}/public/guardians/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
    cache: 'no-store',
  }).catch(() => null);
  if (!res) return NextResponse.json({ error: 'Service unavailable.' }, { status: 502 });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
