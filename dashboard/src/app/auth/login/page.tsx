'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/hooks/useAuthStore';
import { AlertBanner, Spinner } from '@/components/ui';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';
const GSI_SRC = 'https://accounts.google.com/gsi/client';
// Sign in with Apple on the web needs a Services ID (Apple Developer →
// Identifiers → Services IDs) with this page's origin as a return URL.
const APPLE_SERVICES_ID = process.env.NEXT_PUBLIC_APPLE_SERVICES_ID ?? '';
const APPLE_SRC = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

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
    AppleID?: {
      auth: {
        init: (config: Record<string, unknown>) => void;
        signIn: () => Promise<{ authorization?: { id_token?: string } }>;
      };
    };
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing?.dataset.loaded) return resolve();
    const el = existing ?? document.createElement('script');
    el.addEventListener('load', () => { el.dataset.loaded = '1'; resolve(); });
    el.addEventListener('error', () => reject(new Error('load failed')));
    if (!existing) {
      el.src = src;
      el.async = true;
      document.head.appendChild(el);
    }
  });
}

export default function LoginPage() {
  const router = useRouter();
  const { loginWithGoogle, loadUser, isAuthenticated } = useAuthStore();

  const buttonRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If the visitor already has a session, skip the login form.
  useEffect(() => { loadUser(); }, [loadUser]);
  useEffect(() => { if (isAuthenticated) router.replace('/dashboard'); }, [isAuthenticated, router]);

  // Load the Google Identity Services script ourselves (rather than next/script)
  // so we control load/error handling and surface a clear message on failure
  // instead of leaving a blank button area.
  useEffect(() => {
    if (window.google) { setScriptReady(true); return; }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const el = existing ?? document.createElement('script');
    const onLoad = () => setScriptReady(true);
    const onError = () => setError('Failed to load Google sign-in. Check your connection and reload.');
    el.addEventListener('load', onLoad);
    el.addEventListener('error', onError);
    if (!existing) {
      el.src = GSI_SRC;
      el.async = true;
      el.defer = true;
      document.head.appendChild(el);
    }
    return () => {
      el.removeEventListener('load', onLoad);
      el.removeEventListener('error', onError);
    };
  }, []);

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

  const signInWithApple = async () => {
    setError(null);
    try {
      await loadScript(APPLE_SRC);
      window.AppleID!.auth.init({
        clientId: APPLE_SERVICES_ID,
        scope: 'email',
        redirectURI: `${window.location.origin}/auth/login`,
        usePopup: true,
      });
      const res = await window.AppleID!.auth.signIn();
      const idToken = res.authorization?.id_token;
      if (!idToken) throw new Error('No credential returned by Apple.');
      setBusy(true);
      await loginWithGoogle(idToken, 'apple');
      router.replace('/dashboard');
    } catch (err: unknown) {
      // Closing the Apple popup rejects with {error: 'popup_closed_by_user'}.
      const msg = (err as { error?: string })?.error;
      if (msg !== 'popup_closed_by_user' && msg !== 'user_cancelled_authorize') {
        setError(err instanceof Error ? err.message : 'Apple sign-in failed. Please try again.');
      }
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-phantom-bg flex items-center justify-center px-4">
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
              <>
                {APPLE_SERVICES_ID && (
                  <button
                    type="button"
                    onClick={signInWithApple}
                    className="w-[320px] h-10 rounded-full bg-white text-black text-sm font-medium flex items-center justify-center gap-2 hover:bg-white/90"
                  >
                    <svg aria-hidden="true" width="14" height="17" viewBox="0 0 814 1000" fill="currentColor"><path d="M788 341c-6 4-108 62-108 190 0 148 130 200 134 202-1 3-21 72-69 142-43 62-88 124-156 124s-86-40-165-40c-77 0-104 41-167 41s-106-57-156-128C44 790 0 669 0 555c0-184 120-282 238-282 63 0 115 41 155 41 38 0 97-44 169-44 27 0 126 3 191 71zM557 170c30-35 51-84 51-133 0-7-1-14-2-19-48 2-106 32-140 72-27 31-53 80-53 130 0 8 1 15 2 17 3 1 8 1 13 1 43 0 97-29 129-68z"/></svg>
                    Continue with Apple
                  </button>
                )}
                <div ref={buttonRef} />
              </>
            )}
          </div>

          <p className="text-center text-xs text-phantom-faint">
            Use the same Apple or Google account you sign in with in the PhantomShield app.
          </p>
        </div>

        <p className="text-center text-xs text-phantom-faint">
          Every plan includes the dashboard — so you can still see what happened even if your phone is gone.
        </p>
        <p className="text-center text-xs text-phantom-faint space-x-3">
          <a href="/privacy" className="hover:text-phantom-text underline">Privacy</a>
          <a href="/terms" className="hover:text-phantom-text underline">Terms</a>
          <a href="/support" className="hover:text-phantom-text underline">Support</a>
        </p>
      </div>
    </div>
  );
}
