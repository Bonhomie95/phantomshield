import { FastifyPluginAsync } from 'fastify';
import { authenticate } from '@/middleware/auth';
import {
  ActivityEvent, IntruderEvent, Device, User, RefreshToken, Referral, GuardSessionCount, LocationPing,
  DeviceCommand, SubscriptionEvent, Guardian, ShareLink,
} from '@/models';
import { deleteUserPhotos } from '@/services/storage';
import { revokeAppleToken } from '@/lib/apple';
import { JWTPayload, PLAN_LIMITS } from '@/types';
import { kvGet as cacheGet, kvSet as cacheSet, forgetUserState } from '@/config/kv';
import { wsGetConnectionCount } from '@/services/wsService';

const dashboardRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /dashboard/overview — main stats for web dashboard ────────
  // Every tier can see its own overview — that is the whole promise of the web
  // dashboard when the phone is missing.
  fastify.get('/overview', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const user  = request.user as JWTPayload;
    const cacheKey = `overview:${user.userId}`;

    const cached = await cacheGet<unknown>(cacheKey);
    if (cached) return reply.code(200).send(cached);

    const [totalIntruders, deviceCount, recentIntruders] = await Promise.all([
      IntruderEvent.countDocuments({ userId: user.userId }),
      Device.countDocuments({ userId: user.userId, isActive: true }),
      IntruderEvent.find({ userId: user.userId })
        .sort({ timestamp: -1 })
        .limit(5)
        .select('timestamp pinLayer failedAttempt photoUrl location')
        .lean(),
    ]);

    const overview = {
      totals: { totalIntruders, deviceCount },
      recentIntruders,
      plan: {
        current:  user.plan,
        limits:   PLAN_LIMITS[user.plan],
      },
    };

    await cacheSet(cacheKey, overview, 30); // cache for 30 seconds

    return reply.code(200).send(overview);
  });

  // ── GET /dashboard/me — user profile ──────────────────────────────
  fastify.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const jwtUser = request.user as JWTPayload;
    const user = await User.findById(jwtUser.userId)
      .select('email name photo provider plan planExpiresAt createdAt lastLoginAt')
      .lean();

    if (!user) return reply.code(404).send({ error: 'User not found.' });

    // The plan in force (normalised legacy tiers, expiry honoured).
    const plan = jwtUser.plan;
    return reply.code(200).send({
      user: {
        ...user,
        plan,
        planLimits: PLAN_LIMITS[plan],
      },
    });
  });

  // ── DELETE /dashboard/me — delete account ─────────────────────────
  // Accounts are OAuth-only (no password), so deletion is gated on an explicit
  // typed confirmation string rather than a password re-check.
  fastify.delete('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const jwtUser = request.user as JWTPayload;
    const body = (request.body ?? {}) as { confirm?: string };

    if (body.confirm !== 'DELETE MY ACCOUNT') {
      return reply.code(400).send({ error: 'Confirm with: "DELETE MY ACCOUNT"' });
    }

    const user = await User.findById(jwtUser.userId).select('_id +appleRefreshToken').lean();
    if (!user) return reply.code(404).send({ error: 'User not found.' });

    // Sign in with Apple: revoke the authorisation (App Store Guideline 5.1.1(v)).
    if (user.appleRefreshToken) await revokeAppleToken(user.appleRefreshToken);

    const photosDeleted = await deleteUserPhotos(jwtUser.userId);

    // Cascade delete — including any refresh tokens so no session survives.
    await Promise.all([
      DeviceCommand.deleteMany({ userId: jwtUser.userId }),
      SubscriptionEvent.deleteMany({ userId: jwtUser.userId }),
      forgetUserState(jwtUser.userId),
      ActivityEvent.deleteMany({ userId: jwtUser.userId }),
      IntruderEvent.deleteMany({ userId: jwtUser.userId }),
      Device.deleteMany({ userId: jwtUser.userId }),
      RefreshToken.deleteMany({ userId: jwtUser.userId }),
      LocationPing.deleteMany({ userId: jwtUser.userId }),
      Referral.deleteMany({ $or: [{ referrerId: jwtUser.userId }, { referredId: jwtUser.userId }] }),
      GuardSessionCount.deleteMany({ userId: jwtUser.userId }),
      Guardian.deleteMany({ userId: jwtUser.userId }),
      ShareLink.deleteMany({ userId: jwtUser.userId }),
      User.deleteOne({ _id: jwtUser.userId }),
    ]);

    request.log.info(
      { userId: jwtUser.userId, photosDeleted },
      'Account deleted (including stored photos)',
    );

    return reply.code(200).send({ message: 'Account and all data deleted.', photosDeleted });
  });

  // ── End-to-end photo encryption ───────────────────────────────────
  // The server only ever holds a SHA-256 of the owner's 256-bit photo key, so a
  // new phone or the web dashboard can check a typed recovery key is the right
  // one. It never sees the key, and can't decrypt a photo.
  fastify.get('/e2e', { preHandler: [authenticate] }, async (request, reply) => {
    const jwtUser = request.user as JWTPayload;
    const user = await User.findById(jwtUser.userId).select('e2eKeyCheck').lean();
    return reply.send({ enabled: !!user?.e2eKeyCheck, keyCheck: user?.e2eKeyCheck ?? null });
  });

  fastify.put('/e2e', { preHandler: [authenticate] }, async (request, reply) => {
    const jwtUser = request.user as JWTPayload;
    const body = (request.body ?? {}) as { keyCheck?: unknown; replace?: unknown };
    if (typeof body.keyCheck !== 'string' || !/^[a-f0-9]{64}$/.test(body.keyCheck)) {
      return reply.code(400).send({ error: 'Invalid key check.' });
    }
    const user = await User.findById(jwtUser.userId).select('e2eKeyCheck');
    if (!user) return reply.code(404).send({ error: 'User not found.' });
    // Swapping the key strands every photo encrypted with the old one, so it
    // must be asked for explicitly.
    if (user.e2eKeyCheck && user.e2eKeyCheck !== body.keyCheck && body.replace !== true) {
      return reply.code(409).send({ error: 'Encryption is already on with a different key.' });
    }
    user.e2eKeyCheck = body.keyCheck;
    await user.save();
    return reply.send({ enabled: true });
  });

  fastify.delete('/e2e', { preHandler: [authenticate] }, async (request, reply) => {
    const jwtUser = request.user as JWTPayload;
    await User.updateOne({ _id: jwtUser.userId }, { $set: { e2eKeyCheck: null } });
    return reply.send({ enabled: false });
  });

  // ── GET /dashboard/health — system health (internal/monitoring) ───
  fastify.get('/health', { preHandler: [authenticate] }, async (_request, reply) => {
    return reply.code(200).send({
      status: 'ok',
      uptime: process.uptime(),
      wsConnections: wsGetConnectionCount(),
      timestamp: new Date().toISOString(),
    });
  });
};

export default dashboardRoutes;
