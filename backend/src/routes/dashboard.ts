import { FastifyPluginAsync } from 'fastify';
import { Types } from 'mongoose';
import { authenticate, requirePlan } from '@/middleware/auth';
import { ActivityEvent, IntruderEvent, Device, User, RefreshToken } from '@/models';
import { JWTPayload, PLAN_LIMITS } from '@/types';
import { cacheGet, cacheSet } from '@/config/redis';
import { wsGetConnectionCount } from '@/services/wsService';

const dashboardRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /dashboard/overview — main stats for web dashboard ────────
  fastify.get('/overview', {
    preHandler: [authenticate, requirePlan('guard', 'elite')],
  }, async (request, reply) => {
    const user  = request.user as JWTPayload;
    const cacheKey = `overview:${user.userId}`;

    const cached = await cacheGet<unknown>(cacheKey);
    if (cached) return reply.code(200).send(cached);

    const [
      totalEvents,
      totalAnomalies,
      totalIntruders,
      deviceCount,
      recentAnomalies,
      recentIntruders,
      todayStats,
      weekStats,
    ] = await Promise.all([
      ActivityEvent.countDocuments({ userId: user.userId }),
      ActivityEvent.countDocuments({ userId: user.userId, isAnomalous: true }),
      IntruderEvent.countDocuments({ userId: user.userId }),
      Device.countDocuments({ userId: user.userId, isActive: true }),

      ActivityEvent.find({ userId: user.userId, isAnomalous: true })
        .sort({ timestamp: -1 })
        .limit(5)
        .select('type appName timestamp anomalyReason deviceId')
        .lean(),

      IntruderEvent.find({ userId: user.userId })
        .sort({ timestamp: -1 })
        .limit(5)
        .select('timestamp pinLayer failedAttempt photoUrl location')
        .lean(),

      // Today's stats
      ActivityEvent.aggregate([
        {
          $match: {
            userId: { $eq: new Types.ObjectId(user.userId) },
            timestamp: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          },
        },
        {
          $group: {
            _id:         null,
            unlocks:     { $sum: { $cond: [{ $eq: ['$type', 'screen_unlocked'] }, 1, 0] } },
            anomalies:   { $sum: { $cond: ['$isAnomalous', 1, 0] } },
            screenTime:  { $sum: { $ifNull: ['$duration', 0] } },
            totalEvents: { $sum: 1 },
          },
        },
      ]),

      // 7-day trend
      ActivityEvent.aggregate([
        {
          $match: {
            userId: { $eq: new Types.ObjectId(user.userId) },
            timestamp: { $gte: new Date(Date.now() - 7 * 86_400_000) },
          },
        },
        {
          $group: {
            _id:       { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            events:    { $sum: 1 },
            anomalies: { $sum: { $cond: ['$isAnomalous', 1, 0] } },
            unlocks:   { $sum: { $cond: [{ $eq: ['$type', 'screen_unlocked'] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const overview = {
      totals: { totalEvents, totalAnomalies, totalIntruders, deviceCount },
      today:  todayStats[0] ?? { unlocks: 0, anomalies: 0, screenTime: 0, totalEvents: 0 },
      weekTrend: weekStats,
      recentAnomalies,
      recentIntruders,
      plan: {
        current:  user.plan,
        limits:   PLAN_LIMITS[user.plan],
      },
    };

    await cacheSet(cacheKey, overview, 30); // cache for 30 seconds

    return reply.code(200).send(overview);
  });

  // ── GET /dashboard/activity — paginated activity log ──────────────
  fastify.get('/activity', {
    preHandler: [authenticate, requirePlan('guard', 'elite')],
  }, async (request, reply) => {
    const user   = request.user as JWTPayload;
    const query  = request.query as {
      page?: string; limit?: string; deviceId?: string;
      from?: string; to?: string; type?: string; anomalous?: string;
    };

    const page  = Math.max(1, parseInt(query.page ?? '1'));
    const limit = Math.min(parseInt(query.limit ?? '50'), 200);
    const skip  = (page - 1) * limit;

    const maxDays = PLAN_LIMITS[user.plan].historyDays;
    const from = query.from
      ? new Date(query.from)
      : new Date(Date.now() - maxDays * 86_400_000);
    const to = query.to ? new Date(query.to) : new Date();

    const filter: Record<string, unknown> = {
      userId:    user.userId,
      timestamp: { $gte: from, $lte: to },
    };
    if (query.deviceId)       filter.deviceId    = query.deviceId;
    if (query.type)           filter.type        = query.type;
    if (query.anomalous === 'true') filter.isAnomalous = true;

    const [events, total] = await Promise.all([
      ActivityEvent.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .select('-__v -userId')
        .lean(),
      ActivityEvent.countDocuments(filter),
    ]);

    return reply.code(200).send({
      events,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  });

  // ── GET /dashboard/me — user profile ──────────────────────────────
  fastify.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const jwtUser = request.user as JWTPayload;
    const user = await User.findById(jwtUser.userId)
      .select('email name photo provider plan planExpiresAt createdAt lastLoginAt')
      .lean();

    if (!user) return reply.code(404).send({ error: 'User not found.' });

    return reply.code(200).send({
      user: {
        ...user,
        planLimits: PLAN_LIMITS[user.plan as keyof typeof PLAN_LIMITS],
      },
    });
  });

  // ── DELETE /dashboard/me — delete account ─────────────────────────
  // Accounts are OAuth-only (no password), so deletion is gated on an explicit
  // typed confirmation string rather than a password re-check.
  fastify.delete('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const jwtUser = request.user as JWTPayload;
    const body = request.body as { confirm?: string };

    if (body.confirm !== 'DELETE MY ACCOUNT') {
      return reply.code(400).send({ error: 'Confirm with: "DELETE MY ACCOUNT"' });
    }

    const user = await User.findById(jwtUser.userId).select('_id').lean();
    if (!user) return reply.code(404).send({ error: 'User not found.' });

    // Cascade delete — including any refresh tokens so no session survives.
    await Promise.all([
      ActivityEvent.deleteMany({ userId: jwtUser.userId }),
      IntruderEvent.deleteMany({ userId: jwtUser.userId }),
      Device.deleteMany({ userId: jwtUser.userId }),
      RefreshToken.deleteMany({ userId: jwtUser.userId }),
      User.deleteOne({ _id: jwtUser.userId }),
    ]);

    return reply.code(200).send({ message: 'Account and all data deleted.' });
  });

  // ── GET /dashboard/health — system health (internal/monitoring) ───
  fastify.get('/health', async (_request, reply) => {
    return reply.code(200).send({
      status: 'ok',
      uptime: process.uptime(),
      wsConnections: wsGetConnectionCount(),
      timestamp: new Date().toISOString(),
    });
  });
};

export default dashboardRoutes;
