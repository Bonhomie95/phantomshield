import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { Device } from '@/models';
import { Queue, Worker } from 'bullmq';
import { getRedis } from '@/config/redis';

const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

// ─── BullMQ Push Queue ────────────────────────────────────────────────────────

let pushQueue: Queue | null = null;

export const getPushQueue = (): Queue => {
  if (!pushQueue) {
    pushQueue = new Queue('push-notifications', {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });
  }
  return pushQueue;
};

// ─── Worker (runs in same process for simplicity; move to separate process for scale)

export const startPushWorker = () => {
  const worker = new Worker(
    'push-notifications',
    async (job) => {
      const { userId, title, body, data } = job.data;
      await sendPushToUser(userId, title, body, data);
    },
    { connection: getRedis() }
  );

  worker.on('failed', (job, err) => {
    console.error(`[Push] Job ${job?.id} failed:`, err.message);
  });

  console.log('[Push] Worker started');
  return worker;
};

// ─── Core Send Functions ──────────────────────────────────────────────────────

export const sendPushToUser = async (
  userId: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {}
): Promise<void> => {
  const devices = await Device.find({
    userId,
    pushToken: { $ne: null },
    isActive: true,
  }).select('pushToken').lean();

  if (devices.length === 0) return;

  const messages: ExpoPushMessage[] = devices
    .filter(d => d.pushToken && Expo.isExpoPushToken(d.pushToken!))
    .map(d => ({
      to:    d.pushToken!,
      title,
      body,
      data,
      sound: 'default',
      priority: 'high',
      channelId: 'phantomshield-alerts',
    }));

  if (messages.length === 0) return;

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
};

// ─── Notification Templates ───────────────────────────────────────────────────

export const notifyAnomalyDetected = async (
  userId: string,
  reason: string,
  timestamp: number
): Promise<void> => {
  await getPushQueue().add('anomaly', {
    userId,
    title: '⚠ PhantomShield — Anomaly Detected',
    body:  reason,
    data:  { type: 'anomaly', timestamp },
  });
};

export const notifyIntruderDetected = async (
  userId: string,
  pinLayer: string,
  failedAttempt: number
): Promise<void> => {
  await getPushQueue().add('intruder', {
    userId,
    title: '🚨 PhantomShield — Intruder Alert',
    body:  `Wrong PIN entered on ${pinLayer} (attempt #${failedAttempt})`,
    data:  { type: 'intruder', pinLayer, failedAttempt },
  });
};

export const notifyDeviceRemoteAction = async (
  userId: string,
  action: 'locked' | 'wiped'
): Promise<void> => {
  await getPushQueue().add('device_action', {
    userId,
    title: `🔒 PhantomShield — Device ${action === 'locked' ? 'Locked' : 'Wiped'}`,
    body:  `A remote ${action} command was executed on your device.`,
    data:  { type: 'device_action', action },
  });
};

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
