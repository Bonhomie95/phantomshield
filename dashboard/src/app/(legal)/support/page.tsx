import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Support',
  description: 'Get help with PhantomShield.',
  robots: { index: true, follow: true },
};

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-medium text-phantom-text mt-8 mb-2">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-phantom-muted leading-relaxed mb-3">{children}</p>;
}

export default function SupportPage() {
  return (
    <article>
      <h1 className="text-2xl font-light tracking-wide">PhantomShield Support</h1>
      <P>
        Email <a className="text-phantom-accent" href="mailto:support@phantomshield.app">support@phantomshield.app</a> —
        we reply within two business days.
      </P>

      <H>My phone is lost or stolen</H>
      <P>
        Sign in to <a className="text-phantom-accent" href="/auth/login">the web dashboard</a> with the same Apple or
        Google account you use in the app. The Map shows where your phone last reported (if Find My Phone was on), and the
        Live page lets you sound an alarm, lock PhantomShield or request its location (Starter and Pro).
      </P>

      <H>I forgot my PIN</H>
      <P>
        PINs are stored only on your phone and we can&apos;t see or reset them. Sign out from Settings (or reinstall the
        app) and sign back in; you&apos;ll set new PINs. Evidence already backed up to your account stays available on the
        web dashboard.
      </P>

      <H>Subscriptions and refunds</H>
      <P>
        Subscriptions are billed by Apple or Google. Manage or cancel them in your App Store or Google Play account.
        Refunds are handled by the store. In the app, use Settings → Manage Plan → Restore purchases after reinstalling.
      </P>

      <H>Privacy and your data</H>
      <P>
        See our <a className="text-phantom-accent" href="/privacy">Privacy Policy</a>, or{' '}
        <a className="text-phantom-accent" href="/delete-account">delete your account</a>.
      </P>
    </article>
  );
}
