import { FastifyPluginAsync } from 'fastify';
import { User } from '@/models';
import { authenticate } from '@/middleware/auth';
import { JWTPayload, PLAN_LIMITS } from '@/types';
import { planFromEntitlements } from '@/lib/plans';
import { getRedis } from '@/config/redis';

const ACTIVE_EVENTS = new Set([
  'INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'NON_RENEWING_PURCHASE',
]);
const INACTIVE_EVENTS = new Set(['CANCELLATION', 'EXPIRATION', 'BILLING_ISSUE', 'SUBSCRIPTION_PAUSED']);

const billingRoutes: FastifyPluginAsync = async (fastify) => {

  // ── POST /webhooks/revenuecat — subscription state changes ────────────────
  // RevenueCat is configured with app_user_id === our user _id, and posts here
  // on every subscription event. Auth is a shared bearer secret.
  fastify.post('/webhooks/revenuecat', async (request, reply) => {
    const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
    const auth = request.headers.authorization;
    if (secret && auth !== `Bearer ${secret}`) {
      return reply.code(401).send({ error: 'Unauthorized webhook.' });
    }

    const event = (request.body as any)?.event;
    if (!event?.app_user_id || !event?.type) {
      return reply.code(400).send({ error: 'Malformed event.' });
    }

    // Idempotency: RevenueCat can retry/replay deliveries. Ignore an event id
    // we've already applied so a replay can't re-toggle a plan.
    if (event.id) {
      const fresh = await getRedis().set(`rc:evt:${event.id}`, '1', 'EX', 172800, 'NX');
      if (fresh === null) return reply.code(200).send({ ok: true, duplicate: true });
    }

    const user = await User.findById(event.app_user_id).catch(() => null);
    if (!user) return reply.code(200).send({ ok: true }); // ack unknown users

    if (ACTIVE_EVENTS.has(event.type)) {
      user.plan = planFromEntitlements(event.entitlement_ids ?? []);
      user.planExpiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : null;
    } else if (INACTIVE_EVENTS.has(event.type)) {
      user.plan = 'free';
      user.planExpiresAt = null;
    }
    await user.save();

    request.log.info({ userId: user.id, type: event.type, plan: user.plan }, 'RevenueCat event applied');
    return reply.code(200).send({ ok: true });
  });

  // ── GET /billing/plan — current plan + limits (for the paywall/app) ───────
  fastify.get('/billing/plan', { preHandler: [authenticate] }, async (request, reply) => {
    const jwt = request.user as JWTPayload;
    const user = await User.findById(jwt.userId).select('plan planExpiresAt').lean();
    if (!user) return reply.code(404).send({ error: 'User not found.' });
    return reply.code(200).send({
      plan: user.plan,
      planExpiresAt: user.planExpiresAt,
      limits: PLAN_LIMITS[user.plan],
    });
  });
};

export default billingRoutes;
