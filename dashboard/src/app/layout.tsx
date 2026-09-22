import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'PhantomShield', template: '%s · PhantomShield' },
  description: 'Anti-theft dashboard for your own phone: intruder photos, location and remote lock.',
  metadataBase: new URL('https://app.phantomshield.app'),
  openGraph: {
    siteName: 'PhantomShield',
    type: 'website',
    locale: 'en_US',
  },
  robots: { index: false, follow: false }, // Private dashboard — no indexing
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#080C12',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-phantom-bg antialiased">{children}</body>
    </html>
  );
}
