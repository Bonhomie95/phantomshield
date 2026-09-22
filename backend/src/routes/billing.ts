import { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';
import { User, SubscriptionEvent } from '@/models';
import { authenticate } from '@/middleware/auth';
import { JWTPayload, PLAN_LIMITS, normalizePlan, AppError } from '@/types';
import { planFromEntitlements, effectivePlan } from '@/lib/plans';

/** Constant-time bearer-secret comparison that tolerates length differences. */
export function bearerMatches(authHeader: string | undefined, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(authHeader ?? '');
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export { effectivePlan };

/** Events that (re)assert an entitlement and carry a fresh expiry. */
const ACTIVE_EVENTS = new Set([
  'INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'NON_RENEWING_PURCHASE',
  // A subscription moved to a different app_user_id (device transfer, account
  // re-link). Ignoring it left a paying customer with no access and no error.
  'TRANSFER',
]);

/**
 * The ONLY event that actually ends access.
 *
 * `CANCELLATION` in RevenueCat means "auto-renew was turned off" — the user has
 * paid through the end of the period and must keep what they bought. Treating
 * it as a revocation downgraded someone who cancelled on day 2 of a paid month
 * immediately, losing them 28 days they had already paid for: a refund, a
 * support ticket and a one-star review in a single line of code.
 *
 * `BILLING_ISSUE` fires during the grace period while access legitimately
 * continues, and `SUBSCRIPTION_PAUSED` (Play) has a future resume date. Neither
 * should revoke. Access simply lapses when `planExpiresAt` passes, which
 * `effectivePlan()` already enforces on every read.
 */
const EXPIRY_EVENTS = new Set(['EXPIRATION']);

/** Events worth recording as churn risk, but which must NOT revoke access. */
const CHURN_SIGNAL_EVENTS = new Set(['CANCELLATION', 'BILLING_ISSUE', 'SUBSCRIPTION_PAUSED']);

/** The RevenueCat webhook fields we read. */
interface RevenueCatEvent {
  id?: string;
  type: string;
  app_user_id: string;
  entitlement_ids?: string[];
  expiration_at_ms?: number;
  event_timestamp_ms?: number;
  product_id?: string;
  store?: string;
  environment?: string;
  period_type?: string;
  price?: number;
  currency?: string;
}

const billingRoutes: FastifyPluginAsync = async (fastify) => {

  // ── POST /webhooks/revenuecat — subscription state changes ────────────────
  // RevenueCat is configured with app_user_id === our user _id, and posts here
  // on every subscription event. Auth is a shared bearer secret.
  fastify.post('/webhooks/revenuecat', { config: { rateLimit: false } }, async (request, reply) => {
    const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
    // Fail CLOSED: with no secret configured we must reject, never accept — an
    // unset secret previously skipped the check and let anyone grant any plan.
    if (!secret) {
      request.log.error('REVENUECAT_WEBHOOK_SECRET not set — rejecting webhook.');
      return reply.code(503).send({ error: 'Webhook not configured.' });
    }
    if (!bearerMatches(request.headers.authorization, secret)) {
      return reply.code(401).send({ error: 'Unauthorized webhook.' });
    }

    const event = (request.body as { event?: RevenueCatEvent } | undefined)?.event;
    if (!event?.app_user_id || !event?.type) {
      return reply.code(400).send({ error: 'Malformed event.' });
    }

    // Idempotency: RevenueCat can retry/replay deliveries. The append-only
    // ledger (unique eventId) is the record of what was applied, so a replay of
    // an event already in it is acknowledged and ignored.
    if (event.id && (await SubscriptionEvent.exists({ eventId: event.id }))) {
      return reply.code(200).send({ ok: true, duplicate: true });
    }

    // TEST events from the RevenueCat dashboard (and anonymous ids) are not
    // ObjectIds — acknowledge them without touching any account.
    const user = /^[a-f0-9]{24}$/i.test(String(event.app_user_id))
      ? await User.findById(event.app_user_id).catch(() => null)
      : null;
    if (!user) return reply.code(200).send({ ok: true }); // ack unknown users

    const planBefore = normalizePlan(user.plan);

    if (ACTIVE_EVENTS.has(event.type)) {
      user.plan = planFromEntitlements(event.entitlement_ids ?? []);
      user.planExpiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : null;
    } else if (EXPIRY_EVENTS.has(event.type)) {
      user.plan = 'free';
      user.planExpiresAt = null;
    } else if (CHURN_SIGNAL_EVENTS.has(event.type)) {
      // Access is deliberately NOT revoked here — see EXPIRY_EVENTS above.
      // Keep the paid entitlement and let it lapse at `planExpiresAt`; if
      // RevenueCat told us when that is, trust it over whatever we hold.
      if (event.expiration_at_ms) {
        user.planExpiresAt = new Date(event.expiration_at_ms);
      }
      request.log.warn(
        { userId: user.id, type: event.type, expiresAt: user.planExpiresAt },
        'Churn signal received — access retained until expiry',
      );
    }
    await user.save();

    // Append to the billing ledger. `User.plan` is mutated in place with no
    // history, which made MRR, churn, trial→paid, refund rate and LTV
    // uncomputable and left support unable to reconstruct a customer's
    // subscription. This is the append-only record of what actually happened.
    try {
      await SubscriptionEvent.create({
        userId:      user._id,
        eventId:     event.id ?? `${event.type}:${event.app_user_id}:${event.event_timestamp_ms ?? Date.now()}`,
        type:        event.type,
        planBefore,
        planAfter:   normalizePlan(user.plan),
        productId:   event.product_id,
        store:       event.store,
        environment: event.environment,
        periodType:  event.period_type,
        // `price` is RevenueCat's USD-normalised amount, which is the one worth
        // summing for MRR; `price_in_purchased_currency` is the local charge.
        priceUsd:    typeof event.price === 'number' ? event.price : undefined,
        currency:    event.currency,
        expiresAt:   event.expiration_at_ms ? new Date(event.expiration_at_ms) : null,
        occurredAt:  event.event_timestamp_ms ? new Date(event.event_timestamp_ms) : new Date(),
      });
    } catch (caught) {
      const err = caught as AppError;
      // Unique eventId — a concurrent replay that slipped past the check above is a no-op.
      if (err?.code !== 11000) {
        request.log.error({ err, userId: user.id }, 'subscription ledger write failed');
      }
    }

    request.log.info({ userId: user.id, type: event.type, plan: user.plan }, 'RevenueCat event applied');
    return reply.code(200).send({ ok: true });
  });

  // ── GET /billing/plan — current plan + limits (for the paywall/app) ───────
  fastify.get('/billing/plan', { preHandler: [authenticate] }, async (request, reply) => {
    const jwt = request.user as JWTPayload;
    const user = await User.findById(jwt.userId).select('plan planExpiresAt').lean();
    if (!user) return reply.code(404).send({ error: 'User not found.' });
    // Report the plan actually in force — a referral/expired paid plan whose
    // expiry has passed must read as 'free', not its stale DB value.
    const plan = effectivePlan(normalizePlan(user.plan), user.planExpiresAt);
    return reply.code(200).send({
      plan,
      planExpiresAt: user.planExpiresAt,
      limits: PLAN_LIMITS[plan],
    });
  });
};

export default billingRoutes;
