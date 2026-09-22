import Link from 'next/link';

// Public, unauthenticated legal pages (privacy, terms). Kept outside the
// dashboard group so they render without a session.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-phantom-bg text-phantom-text">
      <header className="border-b border-phantom-border">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/auth/login" className="flex items-center gap-2">
            <span className="text-phantom-accent text-xl">⬡</span>
            <span className="tracking-widest text-sm">PHANTOMSHIELD</span>
          </Link>
          <nav className="flex gap-4 text-xs text-phantom-muted">
            <Link href="/privacy" className="hover:text-phantom-text">Privacy</Link>
            <Link href="/terms" className="hover:text-phantom-text">Terms</Link>
            <Link href="/support" className="hover:text-phantom-text">Support</Link>
          </nav>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-12">{children}</main>
    </div>
  );
}
