import { NextRequest } from 'next/server';

/**
 * True when a request demonstrably comes from our own site.
 *
 * The session is a SameSite=lax cookie, which stops most cross-site POSTs but
 * is not a complete CSRF defense on its own. For state-changing requests we
 * additionally require the `Origin` (or, failing that, `Referer`) to match the
 * request host. A same-origin browser fetch always sends a matching Origin;
 * a cross-site form/`fetch` cannot forge it.
 */
export function isSameOrigin(req: NextRequest): boolean {
  const host = req.headers.get('host');
  if (!host) return false;

  const origin = req.headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  // Some legitimate same-origin requests omit Origin; fall back to Referer.
  const referer = req.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }

  // No Origin and no Referer: reject for safety on mutating requests.
  return false;
}
