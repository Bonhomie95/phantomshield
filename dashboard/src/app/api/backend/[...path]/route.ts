import { NextRequest, NextResponse } from 'next/server';
import { BACKEND, getAccessToken, getDeviceId, refreshSession } from '@/lib/server/backend';
import { isSameOrigin } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

// The only backend route prefixes the dashboard is ever allowed to reach. This
// is an allowlist, not a denylist: it keeps the catch-all proxy from being used
// to reach backend auth/internal routes (e.g. /auth/refresh, /webhooks/*) with
// the user's bearer token attached, and blocks path-traversal escapes.
const ALLOWED_PREFIXES = ['dashboard', 'sync', 'devices', 'push', 'billing', 'guardians', 'share-links'];

function isSafePath(path: string[]): boolean {
  if (path.length === 0) return false;
  if (!ALLOWED_PREFIXES.includes(path[0])) return false;
  // Reject any traversal or still-encoded segment.
  return path.every((seg) => seg !== '.' && seg !== '..' && !seg.includes('%') && !seg.includes('/') && !seg.includes('\\'));
}

// Response headers worth forwarding to the browser (skip hop-by-hop / auth).
const PASS_THROUGH_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified', 'x-content-type-options'];

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  // State-changing requests must originate from our own site (CSRF defense —
  // the session rides in a SameSite=lax cookie, which is not sufficient alone).
  const method = req.method;
  if (method !== 'GET' && method !== 'HEAD' && !isSameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request blocked.' }, { status: 403 });
  }

  if (!isSafePath(path)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const target = `${BACKEND}/${path.join('/')}${req.nextUrl.search}`;
  // The server-side device binding (set at login) — also covers <img> requests,
  // which can't carry custom headers.
  const deviceId = getDeviceId() ?? req.headers.get('x-device-id') ?? '';
  const hasBody = !['GET', 'HEAD'].includes(method);
  const body = hasBody ? await req.text() : undefined;
  const contentType = req.headers.get('content-type') ?? 'application/json';

  const send = (token?: string) =>
    fetch(target, {
      method,
      headers: {
        'Content-Type': contentType,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(deviceId ? { 'X-Device-Id': deviceId } : {}),
      },
      body,
      cache: 'no-store',
    });

  let res = await send(getAccessToken());
  if (res.status === 401) {
    const refreshed = await refreshSession(deviceId);
    if (refreshed) res = await send(refreshed);
  }

  // Bytes, not text: photo responses are binary and a text round-trip corrupts them.
  const out = res.status === 204 ? null : await res.arrayBuffer();
  const headers = new Headers();
  for (const h of PASS_THROUGH_HEADERS) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new NextResponse(out, { status: res.status, headers });
}

type Ctx = { params: { path: string[] } };

export const GET = (req: NextRequest, { params }: Ctx) => proxy(req, params.path);
export const POST = (req: NextRequest, { params }: Ctx) => proxy(req, params.path);
export const PUT = (req: NextRequest, { params }: Ctx) => proxy(req, params.path);
export const PATCH = (req: NextRequest, { params }: Ctx) => proxy(req, params.path);
export const DELETE = (req: NextRequest, { params }: Ctx) => proxy(req, params.path);
