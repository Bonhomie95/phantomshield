/** @type {import('next').NextConfig} */

// Content-Security-Policy for a private dashboard. Google Identity Services and
// Sign in with Apple need their script/frame/connect hosts; 'unsafe-inline' on
// style is required by Tailwind's injected styles.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com https://appleid.cdn-apple.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "font-src 'self' https://fonts.gstatic.com",
  // Intruder photos are same-origin (served through the /api/backend proxy).
  // Map tiles come from CARTO/OSM; avatars from Google.
  "img-src 'self' data: blob: https://*.googleusercontent.com https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org",
  "connect-src 'self' https://accounts.google.com https://appleid.apple.com https://*.posthog.com wss: ws:",
  "frame-src https://accounts.google.com https://appleid.apple.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://appleid.apple.com",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.googleusercontent.com' },
    ],
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

module.exports = nextConfig;
