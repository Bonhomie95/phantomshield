import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'PhantomShield', template: '%s · PhantomShield' },
  description: 'Personal security intelligence. Monitor your device, detect threats, protect your data.',
  metadataBase: new URL('https://app.phantomshield.app'),
  icons: { icon: '/favicon.ico', apple: '/apple-touch-icon.png' },
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
  themeColor: '#0A0E1A',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-phantom-bg antialiased">{children}</body>
    </html>
  );
}
