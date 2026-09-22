/**
 * Send one test email through whichever transport is configured (SMTP or SES).
 *   node dist/scripts/testEmail.js you@example.com
 * (On Render: open the service's Shell tab and run the same command.)
 */
import 'dotenv/config';
import { isEmailConfigured, sendEmail, emailTransport } from '@/services/emailService';

const to = process.argv[2];
if (!to) {
  console.error('Usage: node dist/scripts/testEmail.js <recipient>');
  process.exit(1);
}
if (!isEmailConfigured()) {
  console.error(
    'Email is not configured. Set either SMTP_HOST/SMTP_USER/SMTP_PASSWORD, ' +
      'or AWS_REGION/AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY.',
  );
  process.exit(1);
}
console.log(`Sending via ${emailTransport().toUpperCase()}…`);
void sendEmail({
  to,
  subject: 'PhantomShield test email',
  text: 'If you can read this, PhantomShield can send its alert emails.',
}).then((ok) => {
  console.log(ok ? `Sent to ${to}.` : 'Send failed — see the error above (sender not verified? wrong region or SMTP password?).');
  process.exit(ok ? 0 : 1);
});
