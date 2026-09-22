import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms that govern your use of PhantomShield.',
};

const UPDATED = 'September 21, 2026';

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-medium text-phantom-text mt-8 mb-2">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-phantom-muted leading-relaxed mb-3">{children}</p>;
}

export default function TermsPage() {
  return (
    <article>
      <h1 className="text-2xl font-light tracking-wide">Terms of Service</h1>
      <p className="text-xs text-phantom-faint mt-1">Last updated: {UPDATED}</p>

      <H>1. Acceptance</H>
      <P>By using PhantomShield you agree to these Terms. If you don&apos;t agree, don&apos;t use the app.</P>

      <H>2. Lawful use — your own device only</H>
      <P>
        PhantomShield is designed to monitor and protect a device that <strong className="text-phantom-text">you own or are authorized to control</strong>.
        You must not use it to surveil, monitor, or capture images of another person without their
        knowledge and consent where required by law. Using the app to stalk, harass, or unlawfully
        monitor others is strictly prohibited and may be a crime. You are solely responsible for using
        the app in compliance with all applicable laws, including camera, recording, and privacy laws in
        your jurisdiction.
      </P>

      <H>3. Accounts</H>
      <P>You sign in with Google or Apple. Keep your account and device PINs secure. You&apos;re responsible for activity under your account.</P>

      <H>4. Subscriptions & billing</H>
      <P>
        Paid plans (Starter, Pro) are auto-renewing subscriptions billed through the Apple App Store or
        Google Play. Payment is charged to your store account when you confirm the purchase, and the
        subscription renews for the same period and price unless cancelled at least 24 hours before the
        end of the current period. You can manage or cancel it in your App Store or Google Play account
        settings. Deleting your PhantomShield account does not cancel a subscription. Prices are shown in
        the app before purchase. Refunds are handled by Apple or Google under their policies.
      </P>

      <H>5. Free features</H>
      <P>Guard Mode can be tried without an account. The Free plan includes core protection; some features require a paid plan. PhantomShield contains no ads.</P>

      <H>6. Acceptable use</H>
      <P>Don&apos;t reverse-engineer, abuse, overload, or attempt to breach the service, and don&apos;t use it for any unlawful purpose.</P>

      <H>7. Disclaimers</H>
      <P>
        PhantomShield is provided &quot;as is.&quot; It is a deterrent and evidence tool, not a guaranteed
        security or recovery service. Detection depends on device capabilities and OS limits (for example,
        background monitoring is constrained by iOS and Android). We don&apos;t guarantee it will prevent
        theft or recover a device.
      </P>

      <H>8. Limitation of liability</H>
      <P>To the maximum extent permitted by law, we are not liable for indirect, incidental, or consequential damages, or for any loss arising from device theft, data loss, or missed detections.</P>

      <H>9. Termination</H>
      <P>You may stop using the app and delete your account anytime. We may suspend accounts that violate these Terms.</P>

      <H>10. Apple users</H>
      <P>
        If you downloaded PhantomShield from the App Store, these Terms are between you and us, not Apple, and
        Apple&apos;s{' '}
        <a className="text-phantom-accent" href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/">Standard
        End User License Agreement</a> also applies. Apple has no obligation to provide maintenance or support
        for the app and is not responsible for any claims relating to it.
      </P>

      <H>11. Changes & contact</H>
      <P>
        We may update these Terms; continued use means acceptance. Questions:{' '}
        <a className="text-phantom-accent" href="mailto:support@phantomshield.app">support@phantomshield.app</a>.
      </P>
    </article>
  );
}
