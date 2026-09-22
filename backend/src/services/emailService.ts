/**
 * Transactional email.
 *
 * This exists because push alone cannot deliver this product's core alert.
 * Intruder pushes deliberately exclude the device the event came from (never
 * light up the handset in a thief's hand) — so a user with ONE device, which is
 * the entire free tier, received nothing at all. Email is the channel that
 * still works when the phone is the thing that's missing.
 *
 * Sent through Amazon SES (API v2). Configure:
 *   AWS_REGION             the SES region your identity is verified in
 *   AWS_ACCESS_KEY_ID      an IAM user allowed ses:SendEmail
 *   AWS_SECRET_ACCESS_KEY
 *   EMAIL_FROM             an address on a verified SES identity
 * Without credentials this no-ops loudly, exactly like Sentry.
 */
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { captureError } from '@/config/monitoring';

const FROM = process.env.EMAIL_FROM ?? 'PhantomShield <alerts@phantomshield.app>';
const DASHBOARD_URL = process.env.DASHBOARD_URL ?? 'https://app.phantomshield.app';
/** Optional SES configuration set, for bounce/complaint tracking. */
const CONFIGURATION_SET = process.env.SES_CONFIGURATION_SET || undefined;

export const isEmailConfigured = (): boolean =>
  Boolean(process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

let ses: SESv2Client | null = null;
const client = () => (ses ??= new SESv2Client({ region: process.env.AWS_REGION }));

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Send one email. Never throws — alerting must not take down a request. */
export async function sendEmail(msg: EmailMessage): Promise<boolean> {
  if (!isEmailConfigured()) return false;
  try {
    await client().send(
      new SendEmailCommand({
        FromEmailAddress: FROM,
        Destination: { ToAddresses: [msg.to] },
        ConfigurationSetName: CONFIGURATION_SET,
        Content: {
          Simple: {
            Subject: { Data: msg.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: msg.text, Charset: 'UTF-8' },
              ...(msg.html ? { Html: { Data: msg.html, Charset: 'UTF-8' } } : {}),
            },
          },
        },
      }),
    );
    return true;
  } catch (err) {
    captureError(err, { scope: 'sendEmail', to: msg.to.split('@')[1] });
    return false;
  }
}

// ─── Templates ────────────────────────────────────────────────────────────────

/** Event text (e.g. an anomaly reason) originates on the device: escape it. */
const esc = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const shell = (heading: string, body: string, cta = 'Open your dashboard') => `
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0A0E1A;color:#EEF2FF;padding:32px">
  <div style="max-width:520px;margin:0 auto;background:#111827;border:1px solid #1E2D45;border-radius:16px;padding:28px">
    <p style="letter-spacing:3px;font-size:11px;color:#7A8CA0;margin:0 0 18px">PHANTOMSHIELD</p>
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px">${heading}</h1>
    ${body}
    <a href="${DASHBOARD_URL}/dashboard/live"
       style="display:inline-block;margin-top:22px;background:#00D4FF;color:#0A0E1A;text-decoration:none;
              padding:11px 20px;border-radius:10px;font-weight:600;font-size:14px">${cta}</a>
    <p style="font-size:11px;color:#7A8CA0;margin-top:24px;line-height:1.6">
      You're receiving this because security alerts are enabled for your PhantomShield account.
      Manage alerts in the app under Settings.
    </p>
  </div>
</div>`;

export async function emailIntruderAlert(
  to: string,
  details: { pinLayer: string; failedAttempt: number; at: Date; hasPhoto: boolean },
): Promise<boolean> {
  const when = details.at.toUTCString();
  const where = details.pinLayer === 'guard' ? 'while Guard Mode was armed' : `on your ${details.pinLayer} PIN`;

  return sendEmail({
    to,
    subject: '🚨 Someone tried to unlock your phone',
    text:
      `Someone entered the wrong PIN ${where} (attempt #${details.failedAttempt}) at ${when}.\n` +
      (details.hasPhoto ? 'A photo was captured.\n' : '') +
      `\nSee it now: ${DASHBOARD_URL}/dashboard/live\n`,
    html: shell(
      'Someone tried to unlock your phone',
      `<p style="color:#8899BB;font-size:14px;line-height:1.7;margin:0">
         A wrong PIN was entered <strong style="color:#EEF2FF">${esc(where)}</strong>
         (attempt #${details.failedAttempt}) at <strong style="color:#EEF2FF">${when}</strong>.
         ${details.hasPhoto ? 'A photo of whoever did it was captured.' : ''}
       </p>`,
      'See what happened',
    ),
  });
}

/** Any other security notice (e.g. a remote lock ran) when no push got through. */
export async function emailSecurityNotice(to: string, message: string): Promise<boolean> {
  return sendEmail({
    to,
    subject: 'PhantomShield security notice',
    text: `${message}\n\nSee details: ${DASHBOARD_URL}/dashboard/live\n`,
    html: shell(
      'Security notice',
      `<p style="color:#8899BB;font-size:14px;line-height:1.7;margin:0">${esc(message)}</p>`,
      'See details',
    ),
  });
}

export async function emailTheftSignal(to: string, body: string): Promise<boolean> {
  return sendEmail({
    to,
    subject: '🚨 Your phone may have been taken',
    text:
      `${body}\n\n` +
      `See its last known location and lock it: ${DASHBOARD_URL}/dashboard/live\n`,
    html: shell(
      'Your phone may have been taken',
      `<p style="color:#8899BB;font-size:14px;line-height:1.7;margin:0">${esc(body)}</p>
       <p style="color:#8899BB;font-size:13px;line-height:1.7;margin:12px 0 0">
         The dashboard shows the last place your phone reported from, and lets you
         sound an alarm or lock it remotely.
       </p>`,
      'See where it is',
    ),
  });
}

// ─── Guardians ────────────────────────────────────────────────────────────────
// Sent to someone who is NOT a PhantomShield user, so every email says who
// added them and carries a one-click way to stop receiving them.

const guardianFooter = (ownerName: string, unsubscribeUrl: string) => `
    <p style="font-size:11px;color:#7A8CA0;margin-top:24px;line-height:1.6">
      ${esc(ownerName)} added you as a guardian in PhantomShield, a phone anti-theft app.
      <a href="${unsubscribeUrl}" style="color:#7A8CA0">Stop receiving these emails</a>.
    </p>`;

const guardianShell = (heading: string, body: string, footer: string, cta?: { href: string; label: string }) => `
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0A0E1A;color:#EEF2FF;padding:32px">
  <div style="max-width:520px;margin:0 auto;background:#111827;border:1px solid #1E2D45;border-radius:16px;padding:28px">
    <p style="letter-spacing:3px;font-size:11px;color:#7A8CA0;margin:0 0 18px">PHANTOMSHIELD</p>
    <h1 style="font-size:20px;font-weight:600;margin:0 0 12px">${heading}</h1>
    ${body}
    ${cta ? `<a href="${cta.href}" style="display:inline-block;margin-top:22px;background:#00D4FF;color:#0A0E1A;text-decoration:none;padding:11px 20px;border-radius:10px;font-weight:600;font-size:14px">${cta.label}</a>` : ''}
    ${footer}
  </div>
</div>`;

export async function emailGuardianAdded(
  to: string,
  d: { guardianName: string; ownerName: string; unsubscribeUrl: string },
): Promise<boolean> {
  return sendEmail({
    to,
    subject: `${d.ownerName} added you as a PhantomShield guardian`,
    text:
      `Hi ${d.guardianName},\n\n${d.ownerName} added you as a guardian. If their phone looks stolen ` +
      `(for example the SIM card is swapped), you'll get an email with a link showing where the phone is.\n\n` +
      `You don't need to install anything. To stop these emails: ${d.unsubscribeUrl}\n`,
    html: guardianShell(
      `${esc(d.ownerName)} added you as a guardian`,
      `<p style="color:#8899BB;font-size:14px;line-height:1.7;margin:0">
         Hi ${esc(d.guardianName)}, if ${esc(d.ownerName)}'s phone looks stolen (for example its SIM
         card is swapped), you'll get an email with a private link showing where the phone is, so you
         can help. You don't need to install anything.
       </p>`,
      guardianFooter(d.ownerName, d.unsubscribeUrl),
    ),
  });
}

export async function emailGuardianAlert(
  to: string,
  d: { guardianName: string; ownerName: string; reason: string; link: string; hours: number; unsubscribeUrl: string },
): Promise<boolean> {
  return sendEmail({
    to,
    subject: `🚨 ${d.ownerName}'s phone may have been taken`,
    text:
      `Hi ${d.guardianName},\n\n${d.reason}\n\nSee where ${d.ownerName}'s phone is: ${d.link}\n` +
      `(This link stops working after ${d.hours} hours.)\n\n` +
      `Please get in touch with ${d.ownerName} another way. Don't try to recover the phone yourself.\n\n` +
      `Stop these emails: ${d.unsubscribeUrl}\n`,
    html: guardianShell(
      `${esc(d.ownerName)}'s phone may have been taken`,
      `<p style="color:#8899BB;font-size:14px;line-height:1.7;margin:0">Hi ${esc(d.guardianName)}, ${esc(d.reason)}</p>
       <p style="color:#8899BB;font-size:13px;line-height:1.7;margin:12px 0 0">
         Please get in touch with ${esc(d.ownerName)} another way. Don't try to recover the phone yourself.
         The link stops working after ${d.hours} hours.
       </p>`,
      guardianFooter(d.ownerName, d.unsubscribeUrl),
      { href: d.link, label: 'See where the phone is' },
    ),
  });
}
