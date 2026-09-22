/**
 * Send one test email through the configured SES account.
 *   node dist/scripts/testEmail.js you@example.com
 * (On Render: open the service's Shell tab and run the same command.)
 */
import 'dotenv/config';
import { isEmailConfigured, sendEmail } from '@/services/emailService';

const to = process.argv[2];
if (!to) {
  console.error('Usage: node dist/scripts/testEmail.js <recipient>');
  process.exit(1);
}
if (!isEmailConfigured()) {
  console.error('SES is not configured: set AWS_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.');
  process.exit(1);
}
void sendEmail({
  to,
  subject: 'PhantomShield test email',
  text: 'If you can read this, PhantomShield can send alert emails through Amazon SES.',
}).then((ok) => {
  console.log(ok ? `Sent to ${to}.` : 'Send failed — see the error above (identity not verified? wrong region?).');
  process.exit(ok ? 0 : 1);
});
