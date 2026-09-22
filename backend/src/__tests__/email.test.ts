/** The SES path: nothing is sent without credentials, and the message is shaped correctly. */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const send = jest.fn<(cmd: { input: unknown }) => Promise<unknown>>();
jest.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: jest.fn().mockImplementation(() => ({ send })),
  SendEmailCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

describe('emailService (SES)', () => {
  beforeEach(() => {
    jest.resetModules();
    send.mockReset();
    delete process.env.AWS_REGION;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
  });

  it('does nothing without credentials', async () => {
    const email = await import('../services/emailService');
    expect(email.isEmailConfigured()).toBe(false);
    expect(await email.sendEmail({ to: 'a@example.com', subject: 's', text: 't' })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends subject, text and html through SES', async () => {
    Object.assign(process.env, { AWS_REGION: 'eu-central-1', AWS_ACCESS_KEY_ID: 'x', AWS_SECRET_ACCESS_KEY: 'y' });
    send.mockResolvedValue({ MessageId: '1' });
    const email = await import('../services/emailService');
    expect(await email.sendEmail({ to: 'a@example.com', subject: 'Hi', text: 'Body', html: '<b>Body</b>' })).toBe(true);
    const input = send.mock.calls[0][0].input as {
      Destination: { ToAddresses: string[] };
      Content: { Simple: { Subject: { Data: string }; Body: { Text: { Data: string }; Html: { Data: string } } } };
    };
    expect(input.Destination.ToAddresses).toEqual(['a@example.com']);
    expect(input.Content.Simple.Subject.Data).toBe('Hi');
    expect(input.Content.Simple.Body.Html.Data).toBe('<b>Body</b>');
  });

  it('reports failure instead of throwing when SES rejects', async () => {
    Object.assign(process.env, { AWS_REGION: 'eu-central-1', AWS_ACCESS_KEY_ID: 'x', AWS_SECRET_ACCESS_KEY: 'y' });
    send.mockRejectedValue(new Error('MessageRejected'));
    const email = await import('../services/emailService');
    expect(await email.sendEmail({ to: 'a@example.com', subject: 's', text: 't' })).toBe(false);
  });
});
