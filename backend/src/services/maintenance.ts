/**
 * Scheduled maintenance.
 *
 * Two jobs that previously either ran on the request path or did not exist:
 *
 *  1. RETENTION — trimming events past each plan's history window was fired
 *     from `POST /sync/events`, so a busy device triggered delete scans on the
 *     ingest path. It belongs on a schedule.
 *
 *  2. PHOTO RETENTION — photos follow the same per-plan history window as the
 *     events they belong to (the collection TTL is only the 365-day ceiling).
 *
 * Scheduled with plain timers; a short-lived lock row in MongoDB makes sure
 * only one instance runs each job per tick.
 */
import { PLAN_LIMITS } from '@/types';
import { kvSetNX } from '@/config/kv';
import { captureError } from '@/config/monitoring';

const ROW_TTL_DAYS = 365;

/** Trim each active user's events to their plan's history window. */
export const runRetention = async (): Promise<{ users: number; deleted: number }> => {
  const { User, ActivityEvent, LocationPing, IntruderEvent } = await import('@/models');
  const { deletePhotos } = await import('@/services/storage');

  let users = 0;
  let deleted = 0;

  // Only users whose plan window is shorter than the collection TTL need work.
  for (const planId of ['free', 'starter', 'pro'] as const) {
    const days = PLAN_LIMITS[planId].historyDays;
    if (days >= ROW_TTL_DAYS) continue;

    const cutoff = new Date(Date.now() - days * 86_400_000);
    // Legacy plan names map onto the current tiers.
    const names = planId === 'starter' ? ['starter', 'guard'] : planId === 'pro' ? ['pro', 'elite'] : ['free'];
    const ids = await User.find({ plan: { $in: names } } as Record<string, unknown>).select('_id').lean();
    if (ids.length === 0) continue;

    users += ids.length;
    const userIds = ids.map((u) => u._id);

    const res = await ActivityEvent.deleteMany({
      userId: { $in: userIds },
      timestamp: { $lt: cutoff },
    });
    deleted += res.deletedCount ?? 0;

    // Location history is the most sensitive series the product holds, so it
    // must honour the plan window too rather than sitting at the collection TTL.
    const loc = await LocationPing.deleteMany({
      userId: { $in: userIds },
      recordedAt: { $lt: cutoff },
    });
    deleted += loc.deletedCount ?? 0;

    // Intruder evidence (rows and the photos themselves) honours the window too.
    const [ev, ph] = await Promise.all([
      IntruderEvent.deleteMany({ userId: { $in: userIds }, timestamp: { $lt: cutoff } }),
      deletePhotos({ userId: { $in: userIds }, createdAt: { $lt: cutoff } }),
    ]);
    deleted += (ev.deletedCount ?? 0) + ph;
  }

  return { users, deleted };
};

/**
 * Detect a silently-broken billing webhook.
 *
 * The webhook fails CLOSED when `REVENUECAT_WEBHOOK_SECRET` is unset (503) —
 * which is the DEFAULT. Combined with no monitoring, purchases would simply
 * never apply and nothing would say so. This checks that the ledger is still
 * receiving events and shouts if it has gone quiet while paid users exist.
 */
export const runBillingReconciliation = async (): Promise<{ healthy: boolean; reason?: string }> => {
  const { SubscriptionEvent, User } = await import('@/models');

  // Only accounts that actually bought through the store (a referral grant also
  // sets a paid plan but produces no RevenueCat traffic).
  const payers = await SubscriptionEvent.distinct('userId');
  const paidUsers = await User.countDocuments({ _id: { $in: payers }, plan: { $in: ['starter', 'pro'] } });
  if (paidUsers === 0) return { healthy: true };

  // Every monthly subscription renews (and emits an event) within ~31 days.
  const windowStart = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
  const recent = await SubscriptionEvent.countDocuments({ createdAt: { $gte: windowStart } });

  if (recent === 0) {
    const reason =
      `No RevenueCat events recorded in 35 days while ${paidUsers} paying user(s) exist. ` +
      'The webhook may be misconfigured (a missing REVENUECAT_WEBHOOK_SECRET makes it 503).';
    console.error(`[Maintenance] BILLING ALERT: ${reason}`);
    captureError(new Error('Billing webhook silent for 35 days'), { scope: 'billing', paidUsers });
    return { healthy: false, reason };
  }

  // Anyone whose paid plan lapsed but whose row still claims it — the symptom
  // of a missed EXPIRATION delivery.
  const stale = await User.countDocuments({
    plan: { $in: ['starter', 'pro'] },
    planExpiresAt: { $lt: new Date(Date.now() - 48 * 60 * 60 * 1000) },
  });
  if (stale > 0) {
    console.warn(`[Maintenance] ${stale} user(s) hold an expired paid plan — missed EXPIRATION events?`);
  }

  return { healthy: true };
};

const HOUR = 3_600_000;

/** Run `fn` on this instance only if no other instance claimed this slot. */
async function runOnce(name: string, slotMs: number, fn: () => Promise<void>): Promise<void> {
  try {
    const slot = Math.floor(Date.now() / slotMs);
    if (!(await kvSetNX(`maint:${name}:${slot}`, 1, Math.ceil(slotMs / 1000)))) return;
    await fn();
  } catch (err) {
    console.error(`[Maintenance] ${name} failed:`, (err as Error)?.message ?? err);
    captureError(err, { scope: 'maintenance', job: name });
  }
}

/** Start the maintenance schedule. Returns a handle with `close()` for shutdown. */
export const startMaintenanceWorker = (): { close: () => Promise<void> } => {
  const tick = () => {
    void runOnce('retention', 24 * HOUR, async () => {
      const r = await runRetention();
      console.log(`[Maintenance] Retention: ${r.deleted} records across ${r.users} users`);
    });
    void runOnce('billing-reconcile', 24 * HOUR, async () => {
      const r = await runBillingReconciliation();
      if (!r.healthy) console.error(`[Maintenance] Billing unhealthy: ${r.reason}`);
    });
  };

  // First run shortly after boot, then every 15 minutes; the per-slot lock
  // means each job still runs at most once per its own period.
  const first = setTimeout(tick, 60_000);
  const timer = setInterval(tick, 15 * 60_000);
  first.unref();
  timer.unref();

  console.log('[Maintenance] Scheduler started (retention + billing reconcile)');
  return {
    close: async () => {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
};
