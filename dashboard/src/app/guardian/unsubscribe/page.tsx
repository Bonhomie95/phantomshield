import type { Metadata } from 'next';
import { Unsubscribe } from './Unsubscribe';

export const metadata: Metadata = {
  title: 'Stop guardian alerts',
  robots: { index: false, follow: false },
};

// Public, no sign-in. Nothing happens on page load — only the button unsubscribes.
export default function GuardianUnsubscribePage({ searchParams }: { searchParams: { t?: string } }) {
  const token = typeof searchParams.t === 'string' ? searchParams.t : '';

  return (
    <div className="min-h-screen bg-phantom-bg text-phantom-text">
      <main className="max-w-md mx-auto px-4 py-16 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-phantom-accent text-xl" aria-hidden="true">⬡</span>
          <span className="tracking-widest text-sm">PHANTOMSHIELD</span>
        </div>
        <h1 className="text-2xl font-light">Stop guardian alerts</h1>
        {token ? (
          <>
            <p className="text-sm text-phantom-muted">
              Someone added you as a guardian for their phone, so you get an email if it looks stolen. You can stop
              these emails at any time.
            </p>
            <Unsubscribe token={token} />
          </>
        ) : (
          <p className="text-sm text-phantom-muted">This link is incomplete. Use the unsubscribe link from the email.</p>
        )}
      </main>
    </div>
  );
}
