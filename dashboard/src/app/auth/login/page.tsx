'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { useAuthStore } from '@/hooks/useAuthStore';
import { AlertBanner, Spinner } from '@/components/ui';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';

// Minimal shape of the Google Identity Services global we use.
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (res: { credential?: string }) => void;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

export default function LoginPage() {
  const router = useRouter();
  const { loginWithGoogle } = useAuthStore();

  const buttonRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!scriptReady || !window.google || !buttonRef.current) return;
    if (!GOOGLE_CLIENT_ID) {
      setError('Google sign-in is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID.');
      return;
    }

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async (res) => {
        if (!res.credential) {
          setError('No credential returned by Google.');
          return;
        }
        setBusy(true);
        setError(null);
        try {
          await loginWithGoogle(res.credential);
          router.replace('/dashboard');
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
          setBusy(false);
        }
      },
    });

    window.google.accounts.id.renderButton(buttonRef.current, {
      theme: 'filled_black',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      width: 320,
    });
  }, [scriptReady, loginWithGoogle, router]);

  return (
    <div className="min-h-screen bg-phantom-bg flex items-center justify-center px-4">
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={() => setScriptReady(true)} />

      {/* Grid background */}
      <div className="fixed inset-0 bg-grid-pattern bg-grid opacity-30 pointer-events-none" />

      <div className="w-full max-w-md space-y-8 relative">
        {/* Brand */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-phantom-accent/10 border border-phantom-accent/20 mx-auto">
            <span className="text-phantom-accent text-3xl">⬡</span>
          </div>
          <div>
            <h1 className="text-2xl font-light tracking-widest text-phantom-text">PHANTOMSHIELD</h1>
            <p className="text-phantom-faint text-xs tracking-widest mt-1">INTELLIGENCE DASHBOARD</p>
          </div>
        </div>

        {/* Sign-in card */}
        <div className="bg-phantom-surface border border-phantom-border rounded-2xl p-8 space-y-6">
          <h2 className="text-lg font-light text-phantom-text text-center">Sign in to your account</h2>

          {error && <AlertBanner title={error} variant="danger" onDismiss={() => setError(null)} />}

          <div className="flex flex-col items-center gap-4 min-h-[52px] justify-center">
            {busy ? (
              <div className="flex items-center gap-3 text-phantom-muted text-sm">
                <Spinner size="sm" /> Signing you in…
              </div>
            ) : (
              <div ref={buttonRef} />
            )}
          </div>

          <p className="text-center text-xs text-phantom-faint">
            Use the same Google account you sign in with on the PhantomShield app.
          </p>
        </div>

        <p className="text-center text-xs text-phantom-faint">
          This dashboard is for Phantom Guard and Elite plan members.
        </p>
      </div>
    </div>
  );
}
