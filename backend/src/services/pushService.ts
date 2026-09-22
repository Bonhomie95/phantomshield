import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { Device } from '@/models';
import { emailIntruderAlert, emailSecurityNotice, emailTheftSignal, isEmailConfigured } from '@/services/emailService';
import { THEFT_SIGNAL_LABEL, TheftSignalType } from '@/types';

const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

// ─── Alert delivery ───────────────────────────────────────────────────────────
// ponytail: delivered in-process with a short retry, not a durable queue — an
// alert in flight during a restart is lost. Move to a Mongo-backed job
// collection if delivery guarantees ever need to survive restarts.

interface AlertJob {
  userId: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  excludeDeviceId?: string;
  email?: string;
  /** Theft signals: email is primary, not a fallback. */
  alwaysEmail?: boolean;
}

const RETRY_DELAYS_MS = [0, 5_000, 20_000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function deliverAlert(job: AlertJob): Promise<void> {
  let delivered = 0;
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await sleep(delay);
    try {
      delivered = await sendPushToUser(job.userId, job.title, job.body, job.data, {
        excludeDeviceId: job.excludeDeviceId,
      });
      break;
    } catch (err) {
      console.error('[Push] Send attempt failed:', (err as Error)?.message ?? err);
    }
  }

  // Fallback channel. A push that excludes the originating device reaches
  // NOBODY when that's the user's only device — the whole free tier. Email
  // still works when the phone is the thing that's missing.
  if (job.email && (job.alwaysEmail || delivered === 0)) {
    await deliverEmailFallback(job.userId, job.email, job.data?.type, job.body);
  }
}

/** Fire-and-forget: the caller's request must never wait on Expo or email. */
const enqueue = (job: AlertJob): Promise<void> => {
  void deliverAlert(job).catch((err) => console.error('[Push] Alert delivery failed:', err));
  return Promise.resolve();
};

// ─── Core Send Functions ──────────────────────────────────────────────────────

export interface SendPushOptions {
  /**
   * Device that triggered the event — deliberately NOT notified.
   * An intruder alert must never light up the handset in the intruder's hand:
   * that both tips them off and tells them the owner is watching.
   */
  excludeDeviceId?: string;
  /** Deliver ONLY to this device (lost mode speaks to the finder holding it). */
  onlyDeviceId?: string;
}

export const sendPushToUser = async (
  userId: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
  opts: SendPushOptions = {}
): Promise<number> => {
  const filter: Record<string, unknown> = {
    userId,
    pushToken: { $ne: null },
    isActive: true,
  };
  if (opts.excludeDeviceId) filter.deviceId = { $ne: opts.excludeDeviceId };
  if (opts.onlyDeviceId) filter.deviceId = opts.onlyDeviceId;

  const devices = await Device.find(filter).select('pushToken').lean();

  // Returning the delivery count lets the caller fall back to email when a push
  // reached nobody (the single-device case).
  if (devices.length === 0) return 0;

  const messages: ExpoPushMessage[] = devices
    .filter(d => d.pushToken && Expo.isExpoPushToken(d.pushToken!))
    .map(d => ({
      to:    d.pushToken!,
      title,
      body,
      data,
      sound: 'default',
      priority: 'high',
      channelId: 'phantom-alerts', // must match the channel the app creates
    }));

  if (messages.length === 0) return 0;

  const chunks = expo.chunkPushNotifications(messages);
  const tickets: ExpoPushTicket[] = [];
  // Expo tickets don't echo the target token, so we keep a parallel array in
  // send order to map an error ticket back to the token that produced it.
  const ticketTokens: string[] = [];

  for (const chunk of chunks) {
    try {
      const result = await expo.sendPushNotificationsAsync(chunk);
      result.forEach((ticket, i) => {
        tickets.push(ticket);
        ticketTokens.push(chunk[i].to as string);
      });
    } catch (err) {
      console.error('[Push] Send error:', err);
    }
  }

  // Handle receipts asynchronously (production: store tickets, check later)
  handleTickets(tickets, ticketTokens, userId).catch(console.error);

  return messages.length;
};

/**
 * Send the alert by email when push could not reach a single device.
 * Best-effort and never throws — an alerting failure must not fail the job.
 */
async function deliverEmailFallback(
  userId: string,
  email: string,
  type: unknown,
  body: string,
): Promise<void> {
  try {
    if (!isEmailConfigured()) {
      console.warn(`[Push] No device reachable for user ${userId} and email is not configured — alert undelivered.`);
      return;
    }
    if (type === 'theft_signal') {
      await emailTheftSignal(email, body);
    } else if (type === 'intruder') {
      await emailIntruderAlert(email, {
        pinLayer: 'your device',
        failedAttempt: 1,
        at: new Date(),
        hasPhoto: false,
      });
    } else {
      await emailSecurityNotice(email, body);
    }
  } catch (err) {
    console.error('[Push] Email fallback failed:', err);
  }
}

// ─── Notification Templates ───────────────────────────────────────────────────

export const notifyIntruderDetected = async (
  userId: string,
  pinLayer: string,
  failedAttempt: number,
  excludeDeviceId?: string,
  email?: string
): Promise<void> => {
  await enqueue({
    userId,
    title: '🚨 PhantomShield — Intruder Alert',
    body:  `Wrong PIN entered on ${pinLayer} (attempt #${failedAttempt})`,
    data:  { type: 'intruder', pinLayer, failedAttempt },
    excludeDeviceId,
    email,
  });
};

export const notifyDeviceRemoteAction = async (
  userId: string,
  action: 'locked' | 'wiped',
  excludeDeviceId?: string,
  email?: string
): Promise<void> => {
  await enqueue({
    userId,
    title: `🔒 PhantomShield — Device ${action === 'locked' ? 'Locked' : 'Wiped'}`,
    body:  `A remote ${action} command was executed on your device.`,
    data:  { type: 'device_action', action },
    excludeDeviceId,
    email,
  });
};

/**
 * The highest-urgency alert in the product: an OS-level indication that the
 * phone may no longer be with its owner. Unlike other alerts this ALWAYS also
 * emails, because the most likely reader has just lost the device the push
 * would have gone to.
 */
export const notifyTheftSignal = async (
  userId: string,
  signal: string,
  excludeDeviceId?: string,
  email?: string,
): Promise<void> => {
  const label = THEFT_SIGNAL_LABEL[signal as TheftSignalType] ?? 'Unusual device activity';
  await enqueue({
    userId,
    title: '🚨 PhantomShield — Possible theft',
    body:  `${label}. Open PhantomShield to see where your phone is.`,
    data:  { type: 'theft_signal', signal },
    excludeDeviceId,
    email,
    alwaysEmail: true,
  });
};

/**
 * Lost mode: put the owner's message on the lock screen of the missing phone
 * itself. Sent straight to that device — it's the finder we're talking to.
 */
export const notifyLostMode = async (
  userId: string,
  deviceId: string,
  message: string,
  contact: string,
): Promise<number> =>
  sendPushToUser(
    userId,
    'This phone is lost',
    contact ? `${message} Contact: ${contact}` : message,
    { type: 'lost_mode', message, contact },
    { onlyDeviceId: deviceId },
  );

// ─── Receipt Handling ─────────────────────────────────────────────────────────

const handleTickets = async (
  tickets: ExpoPushTicket[],
  ticketTokens: string[],
  userId: string,
): Promise<void> => {
  const receiptIds: string[] = [];

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    if (ticket.status === 'ok' && ticket.id) {
      receiptIds.push(ticket.id);
    } else if (ticket.status === 'error') {
      if (ticket.details?.error === 'DeviceNotRegistered') {
        // Remove the specific token that Expo rejected.
        const token = ticketTokens[i];
        if (token) await Device.updateMany({ userId, pushToken: token }, { pushToken: null });
      }
    }
  }

  if (receiptIds.length === 0) return;

  // Check receipts after a delay
  setTimeout(async () => {
    const chunks = expo.chunkPushNotificationReceiptIds(receiptIds);
    for (const chunk of chunks) {
      try {
        const receipts = await expo.getPushNotificationReceiptsAsync(chunk);
        for (const [id, receipt] of Object.entries(receipts)) {
          if (receipt.status === 'error') {
            console.error(`[Push] Receipt ${id} error:`, receipt.message);
          }
        }
      } catch (err) {
        console.error('[Push] Receipt check error:', err);
      }
    }
  }, 30_000);
};
