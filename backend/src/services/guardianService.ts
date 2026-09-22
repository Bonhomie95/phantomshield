/**
 * Guardians: people the owner trusts, alerted when the phone may be stolen.
 *
 * An alert mints a share link (random token, only its hash stored) that shows
 * the phone's location for a limited time to anyone holding the link — no app
 * or account needed. Alerts are throttled per device and trigger so one theft
 * doesn't flood someone's inbox.
 */
import crypto from 'crypto';
import { Device, Guardian, ShareLink, User } from '@/models';
import { kvSetNX } from '@/config/kv';
import { emailGuardianAlert } from '@/services/emailService';

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? 'https://app.phantomshield.app';

export const SHARE_LINK_HOURS = 24;

export type GuardianTrigger = 'theft' | 'guard' | 'manual';

const THROTTLE_SECONDS: Record<GuardianTrigger, number> = {
  theft: 30 * 60,
  guard: 30 * 60,
  manual: 5 * 60,
};

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export const unsubscribeUrl = (token: string) => `${DASHBOARD_URL}/guardian/unsubscribe?t=${token}`;

export const displayName = (u: { name?: string | null; email?: string | null } | null) =>
  u?.name?.trim() || u?.email?.split('@')[0] || 'Your contact';

/** Mint a share link for one device. Returns the raw token (never stored). */
export async function createShareLink(
  userId: string,
  deviceId: string,
  reason: string,
  hours = SHARE_LINK_HOURS,
): Promise<string> {
  const token = crypto.randomBytes(24).toString('base64url');
  await ShareLink.create({
    userId,
    deviceId,
    tokenHash: hashToken(token),
    reason: reason.slice(0, 200),
    expiresAt: new Date(Date.now() + hours * 3_600_000),
  });
  return token;
}

/**
 * Email every eligible guardian a live-location link. Returns how many were
 * emailed (0 when throttled, none are eligible, or email isn't configured).
 */
export async function alertGuardians(
  userId: string,
  deviceId: string,
  reason: string,
  trigger: GuardianTrigger,
): Promise<number> {
  const filter: Record<string, unknown> = { userId };
  if (trigger === 'guard') filter.alertOnGuard = true;
  const guardians = await Guardian.find(filter).lean();
  if (guardians.length === 0) return 0;

  const device = await Device.findOne({ userId, deviceId }).select('_id').lean();
  if (!device) return 0;

  const fresh = await kvSetNX(`guardian-alert:${userId}:${deviceId}:${trigger}`, 1, THROTTLE_SECONDS[trigger]);
  if (!fresh) return 0;

  const owner = await User.findById(userId).select('name email').lean();
  const ownerName = displayName(owner);
  const token = await createShareLink(userId, deviceId, reason);
  const link = `${DASHBOARD_URL}/l/${token}`;

  const sent = await Promise.all(
    guardians.map((g) =>
      emailGuardianAlert(g.email, {
        guardianName: g.name,
        ownerName,
        reason,
        link,
        hours: SHARE_LINK_HOURS,
        unsubscribeUrl: unsubscribeUrl(g.unsubscribeToken),
      }),
    ),
  );
  return sent.filter(Boolean).length;
}
