import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Delete your account',
  description: 'How to delete your PhantomShield account and data.',
  robots: { index: true, follow: true },
};

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-medium text-phantom-text mt-8 mb-2">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-phantom-muted leading-relaxed mb-3">{children}</p>;
}

// Google Play requires a public web page explaining how to request account and
// data deletion, reachable without installing the app.
export default function DeleteAccountPage() {
  return (
    <article>
      <h1 className="text-2xl font-light tracking-wide">Delete your PhantomShield account</h1>

      <H>In the app</H>
      <ol className="list-decimal pl-5 space-y-1 text-sm text-phantom-muted">
        <li>Open PhantomShield and go to <strong className="text-phantom-text">Settings</strong>.</li>
        <li>Tap <strong className="text-phantom-text">Delete Account</strong> and confirm.</li>
      </ol>

      <H>On the web</H>
      <P>
        Sign in at <a className="text-phantom-accent" href="/auth/login">the PhantomShield dashboard</a>, open{' '}
        <strong className="text-phantom-text">Settings</strong>, and choose <strong className="text-phantom-text">Delete My Account</strong>.
      </P>

      <H>By email</H>
      <P>
        If you can&apos;t sign in, email{' '}
        <a className="text-phantom-accent" href="mailto:privacy@phantomshield.app?subject=Delete%20my%20account">privacy@phantomshield.app</a>{' '}
        from the address on your account. We&apos;ll confirm it&apos;s you and delete the account within 30 days.
      </P>

      <H>What is deleted</H>
      <P>
        Your account, profile, devices, security events, intruder photos, location history, guardians, referral
        records and subscription records are permanently deleted from our servers straight away. Nothing is kept.
        Sign in with Apple access is revoked.
      </P>

      <H>Subscriptions</H>
      <P>
        Deleting your account does not cancel a subscription. Cancel it in your App Store or Google Play account
        settings to stop future charges.
      </P>
    </article>
  );
}
