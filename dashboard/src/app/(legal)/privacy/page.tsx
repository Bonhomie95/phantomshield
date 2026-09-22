import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How PhantomShield collects, uses, and protects your data.',
  robots: { index: true, follow: true },
};

const UPDATED = 'September 22, 2026';

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-medium text-phantom-text mt-8 mb-2">{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-phantom-muted leading-relaxed mb-3">{children}</p>;
}
function Li({ children }: { children: React.ReactNode }) {
  return <li className="text-sm text-phantom-muted leading-relaxed">{children}</li>;
}
function B({ children }: { children: React.ReactNode }) {
  return <strong className="text-phantom-text">{children}</strong>;
}

export default function PrivacyPage() {
  return (
    <article>
      <h1 className="text-2xl font-light tracking-wide">Privacy Policy</h1>
      <p className="text-xs text-phantom-faint mt-1">Last updated: {UPDATED}</p>

      <div className="mt-4 rounded-lg border border-phantom-accent/30 bg-phantom-accent/5 p-3">
        <p className="text-xs text-phantom-muted">
          <B>Summary:</B> PhantomShield protects the phone it is installed on, for that phone&apos;s
          owner. Nothing below is collected until you switch the related feature on. We use your data
          only to run PhantomShield for you. We do not sell it, share it for advertising, or track you
          across other apps. You can delete everything at any time.
        </p>
      </div>

      <H>1. Who we are</H>
      <P>
        PhantomShield (&quot;we&quot;, &quot;us&quot;) provides an anti-theft app for iPhone and Android
        and a web dashboard. Contact:{' '}
        <a className="text-phantom-accent" href="mailto:privacy@phantomshield.app">privacy@phantomshield.app</a>.
      </P>

      <H>2. What we collect, and when</H>
      <ul className="list-disc pl-5 space-y-2">
        <Li><B>Account:</B> your email address and name from Sign in with Apple or Google (Apple may give us a
          private relay address, or none), and an account identifier.</Li>
        <Li><B>Device information:</B> a random identifier created by the app, device model, OS and app version,
          and a push-notification token.</Li>
        <Li><B>Intruder photos</B> (only if you turn on Intruder photos): a front-camera photo taken when a wrong
          PIN is entered in PhantomShield or when Guard Mode detects your phone being moved, plugged in or unplugged.</Li>
        <Li><B>Location on events</B> (only if you turn it on): your phone&apos;s location at the moment of such an
          event.</Li>
        <Li><B>Find My Phone</B> (only while switched on): your phone&apos;s location, collected in the background —
          including when the app is closed — so you can see where it is on the web dashboard. Your phone shows the
          system location indicator while this runs. Battery level is included so you can tell why a trail stopped.</Li>
        <Li><B>Security events:</B> failed PIN attempts in PhantomShield and Guard Mode events.</Li>
        <Li><B>SIM change signal:</B> the mobile carrier name and network codes (MCC/MNC) are compared on the phone to
          detect a SIM swap; if one happens, the fact and the new carrier name are sent to your account. We do not
          read your phone number or SIM serial.</Li>
        <Li><B>Guardians</B> (only if you add them): the name and email address you enter for each person. We use them
          only to email that person alerts about your phone. Each email includes a link to stop further alerts, and
          guardians are deleted with your account.</Li>
        <Li><B>Lost mode</B> (only if you turn it on): the message and optional contact detail you write, which are shown
          on your lost phone for whoever finds it.</Li>
        <Li><B>Shared location links:</B> when your phone looks stolen, guardians get a private link to its location. A
          link shows only locations from shortly before the alert onward, expires after 24 hours, and you can turn off
          every link at any time from the web dashboard.</Li>
        <Li><B>End-to-end encrypted photos</B> (optional): if you turn this on, intruder photos are encrypted on your
          phone with a key only you hold. We store only the encrypted photos and a hash of the key (used to check the
          recovery key you type). If you lose your recovery key, the photos can&apos;t be recovered by anyone, including us.</Li>
        <Li><B>Subscription status:</B> your plan and its expiry, from Apple / Google via our billing provider. We never
          receive your payment card details.</Li>
        <Li><B>Diagnostics:</B> crash reports and basic product-usage events (e.g. &quot;Guard Mode started&quot;), without
          your name, email, photos or locations.</Li>
      </ul>
      <P>
        Your <B>PINs are never collected</B>. They are stored only on your phone, as salted hashes in the system keychain.
      </P>

      <H>3. How we use it</H>
      <P>
        Only to provide PhantomShield to you: to detect and record attempts to use your phone, alert you, show your
        evidence and your phone&apos;s location in the app and on the web dashboard, carry out remote commands you send
        (lock, alarm, locate, lost mode), alert the guardians you added, manage your subscription, and keep the service secure and working. We do not use
        your data for advertising, and the app contains no ads and no advertising or tracking SDKs.
      </P>

      <H>4. Who processes it for us</H>
      <P>We use a small number of service providers, each only for the purpose listed:</P>
      <ul className="list-disc pl-5 space-y-1">
        <Li>Apple and Google — sign-in and in-app purchases.</Li>
        <Li>MongoDB Atlas — our database, where your account data, events, locations and intruder photos are stored.</Li>
        <Li>Our hosting provider — runs the PhantomShield API and web dashboard.</Li>
        <Li>RevenueCat — subscription status.</Li>
        <Li>Expo — push-notification delivery.</Li>
        <Li>Our email provider (Resend or Mailgun) — security alert emails to you and to guardians you add.</Li>
        <Li>Sentry — crash reports; PostHog — product analytics (both configured to exclude personal content).</Li>
        <Li>CARTO / OpenStreetMap — map images on the web dashboard (they receive no information about you).</Li>
      </ul>
      <P>We never sell your personal information and never share it with data brokers or advertisers.</P>

      <H>5. Security</H>
      <P>
        All traffic is encrypted in transit (TLS). Intruder photos can only be retrieved through your signed-in account,
        and if you turn on end-to-end encrypted photos they are decrypted only on your own devices.
        On your phone, sign-in tokens and PINs are kept in the system keychain and photos in the app&apos;s private storage.
        On the web, your session is held in secure, httpOnly cookies. No system is perfectly secure, but we work to protect
        your data and limit who can access it.
      </P>

      <H>6. How long we keep it</H>
      <P>
        Events, locations and photos are kept for your plan&apos;s history window — 7 days on Free, 30 days on
        Starter, 365 days on Pro — and then deleted automatically. Shared location links expire after 24 hours.
        Everything else is kept while your account exists.
      </P>

      <H>7. Deleting your data</H>
      <P>
        You can delete your account and all associated data at any time: in the app under Settings → Delete Account, on
        the web dashboard under Settings, or by emailing us. Deletion removes your account, devices, events, locations,
        photos and guardians from our servers immediately; database backups, if any, are overwritten on a rolling schedule. Signing out of the app also removes
        PhantomShield&apos;s data from that phone. See <a className="text-phantom-accent" href="/delete-account">Delete your account</a>.
      </P>

      <H>8. Your rights</H>
      <P>
        Depending on where you live (for example under the GDPR or CCPA/CPRA), you may have the right to access, correct,
        export or delete your data and to object to or restrict processing. Email{' '}
        <a className="text-phantom-accent" href="mailto:privacy@phantomshield.app">privacy@phantomshield.app</a> and we will
        respond within 30 days. You can also withdraw any permission at any time in your phone&apos;s Settings.
      </P>

      <H>9. Children</H>
      <P>PhantomShield is not directed to children under 13 (or the minimum age in your country), and we do not knowingly collect their data.</P>

      <H>10. Changes</H>
      <P>We will update this page and the &quot;last updated&quot; date when this policy changes, and tell you in the app about material changes.</P>
    </article>
  );
}
