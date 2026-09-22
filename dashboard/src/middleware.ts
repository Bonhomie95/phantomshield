import { NextRequest, NextResponse } from 'next/server';

// Server-side gate: without a session cookie, /dashboard/* is redirected to the
// login page before any dashboard code is served (the client-side redirect in
// the layout still runs as a second line of defense). Token *validity* is
// enforced by the backend on every proxied request; this only checks presence.
const ACCESS_COOKIE = 'ps_access_token';
const REFRESH_COOKIE = 'ps_refresh_token';

export function middleware(req: NextRequest) {
  const hasSession =
    req.cookies.has(ACCESS_COOKIE) || req.cookies.has(REFRESH_COOKIE);

  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/auth/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
