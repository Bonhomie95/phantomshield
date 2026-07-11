import { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';
import { Types } from 'mongoose';
import { z } from 'zod';
import { authenticate, requirePlan } from '@/middleware/auth';
import { ActivityEvent, IntruderEvent, Device } from '@/models';
import { JWTPayload, PLAN_LIMITS, SyncBatchPayload } from '@/types';
import { wsBroadcastToUser } from '@/services/wsService';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const EventSchema = z.object({
  id:               z.string().max(64),
  type:             z.string().max(64),
  appName:          z.string().max(128).optional(),
  timestamp:        z.number(),
  duration:         z.number().optional(),
  isAnomalous:      z.boolean(),
  anomalyReason:    z.string().max(255).optional(),
  encryptedPayload: z.string().optional(),
});

const BatchSchema = z.object({
  deviceId: z.string().max(128),
  events:   z.array(EventSchema).max(200), // cap at 200 per batch
  // Optional client-computed sha256 over JSON.stringify(events). When present
  // we verify it to catch payload corruption; when omitted we skip the check.
  // (This is a corruption guard, not a security control — TLS covers the wire.)
  checksum: z.string().max(128).optional(),
});

const IntruderSchema = z.object({
  id:               z.string().max(64),
  timestamp:        z.number(),
  pinLayer:         z.string().max(32),
  failedAttempt:    z.number().int().min(1).max(20),
  photoBase64:      z.string().optional(), // encrypted on client
  encryptedPhotoKey: z.string().optional(),
  location: z.object({
    lat:      z.number(),
    lng:      z.number(),
    accuracy: z.number(),
  }).optional(),
});

// ─── Sync Plugin ──────────────────────────────────────────────────────────────

const syncRoutes: FastifyPluginAsync = async (fastify) => {

  // ── POST /sync/events — batch upload encrypted events ─────────────
  fastify.post('/events', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const parsed = BatchSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.flatten() });
    }

    const { deviceId, events, checksum } = parsed.data;

    // Corruption check — verify checksum only when the client supplied one
    if (checksum) {
      const eventsJson = JSON.stringify(events);
      const expected = crypto.createHash('sha256').update(eventsJson).digest('hex');
      if (expected !== checksum) {
        return reply.code(400).send({ error: 'Checksum mismatch. Payload may be corrupted.' });
      }
    }

    // Get plan limits
    const limits = PLAN_LIMITS[user.plan];

    // Deduplicate: find already-stored event IDs
    const incomingIds = events.map(e => e.id);
    const existing = await ActivityEvent.find(
      { eventId: { $in: incomingIds } },
      { eventId: 1 }
    ).lean();
    const existingIds = new Set(existing.map(e => e.eventId));
    const newEvents = events.filter(e => !existingIds.has(e.id));

    if (newEvents.length === 0) {
      return reply.code(200).send({ inserted: 0, skipped: events.length, message: 'All events already synced.' });
    }

    // Bulk insert
    const docs = newEvents.map(e => ({
      userId:           user.userId,
      deviceId,
      eventId:          e.id,
      type:             e.type,
      appName:          e.appName,
      timestamp:        new Date(e.timestamp),
      duration:         e.duration,
      isAnomalous:      e.isAnomalous,
      anomalyReason:    e.anomalyReason,
      encryptedPayload: e.encryptedPayload,
    }));

    await ActivityEvent.insertMany(docs, { ordered: false });

    // Apply retention limits: remove events older than plan's history window
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - limits.historyDays);
    await ActivityEvent.deleteMany({ userId: user.userId, timestamp: { $lt: cutoff } });

    // Real-time broadcast to dashboard (Phase 2)
    const anomalous = newEvents.filter(e => e.isAnomalous);
    if (anomalous.length > 0) {
      wsBroadcastToUser(user.userId, {
        type: 'anomaly_alert',
        payload: { count: anomalous.length, events: anomalous.slice(0, 5) },
        timestamp: Date.now(),
      });
    }

    return reply.code(201).send({
      inserted: newEvents.length,
      skipped:  existingIds.size,
    });
  });

  // ── GET /sync/events — fetch events for dashboard ─────────────────
  fastify.get('/events', { preHandler: [authenticate, requirePlan('guard', 'elite')] }, async (request, reply) => {
    const user  = request.user as JWTPayload;
    const query = request.query as {
      deviceId?: string;
      from?: string;
      to?: string;
      limit?: string;
      anomalousOnly?: string;
    };

    const limits  = PLAN_LIMITS[user.plan];
    const maxDays = limits.historyDays;

    const from = query.from
      ? new Date(query.from)
      : new Date(Date.now() - maxDays * 86_400_000);
    const to   = query.to ? new Date(query.to) : new Date();
    const limit = Math.min(parseInt(query.limit ?? '200'), 500);

    const filter: Record<string, unknown> = {
      userId:    user.userId,
      timestamp: { $gte: from, $lte: to },
    };
    if (query.deviceId)     filter.deviceId    = query.deviceId;
    if (query.anomalousOnly === 'true') filter.isAnomalous = true;

    const events = await ActivityEvent.find(filter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .select('-__v -_id -userId')
      .lean();

    return reply.code(200).send({ events, count: events.length });
  });

  // ── GET /sync/stats — daily stats summary ─────────────────────────
  fastify.get('/stats', { preHandler: [authenticate] }, async (request, reply) => {
    const user  = request.user as JWTPayload;
    const query = request.query as { days?: string };
    const days  = Math.min(parseInt(query.days ?? '7'), PLAN_LIMITS[user.plan].historyDays);

    const from = new Date(Date.now() - days * 86_400_000);

    const stats = await ActivityEvent.aggregate([
      {
        $match: {
          userId:    { $eq: new Types.ObjectId(user.userId) },
          timestamp: { $gte: from },
        },
      },
      {
        $group: {
          _id:             { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          totalEvents:     { $sum: 1 },
          unlocks:         { $sum: { $cond: [{ $eq: ['$type', 'screen_unlocked'] }, 1, 0] } },
          anomalies:       { $sum: { $cond: ['$isAnomalous', 1, 0] } },
          totalScreenTime: { $sum: { $ifNull: ['$duration', 0] } },
        },
      },
      { $sort: { _id: -1 } },
    ]);

    return reply.code(200).send({ stats, days });
  });

  // ── POST /sync/intruder — upload intruder event ───────────────────
  fastify.post('/intruder', { preHandler: [authenticate] }, async (request, reply) => {
    const user   = request.user as JWTPayload;
    const limits = PLAN_LIMITS[user.plan];

    if (limits.intruderSnapshots === 0) {
      return reply.code(403).send({ error: 'Intruder snapshots require Phantom Guard or Elite.' });
    }

    const parsed = IntruderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.flatten() });
    }

    const data = parsed.data;

    // Check monthly snapshot limit (Guard plan)
    if (limits.intruderSnapshots !== -1) {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const count = await IntruderEvent.countDocuments({
        userId: user.userId,
        createdAt: { $gte: monthStart },
      });
      if (count >= limits.intruderSnapshots) {
        return reply.code(429).send({
          error: 'Monthly intruder snapshot limit reached.',
          limit: limits.intruderSnapshots,
          upgradeUrl: 'https://phantomshield.app/upgrade',
        });
      }
    }

    // Photo is already encrypted by the client — store URL placeholder
    // In production: upload to Cloudflare R2 here
    const event = await IntruderEvent.create({
      userId:           user.userId,
      deviceId:         (request.headers['x-device-id'] as string) ?? 'unknown',
      eventId:          data.id,
      timestamp:        new Date(data.timestamp),
      pinLayer:         data.pinLayer,
      failedAttempt:    data.failedAttempt,
      photoUrl:         data.photoBase64 ? `r2://intruder/${user.userId}/${data.id}.enc` : undefined,
      location:         data.location,
      encryptedPhotoKey: data.encryptedPhotoKey,
    });

    // Real-time alert to dashboard
    wsBroadcastToUser(user.userId, {
      type: 'intruder_alert',
      payload: {
        id:           event.id,
        timestamp:    data.timestamp,
        pinLayer:     data.pinLayer,
        failedAttempt: data.failedAttempt,
        hasPhoto:     !!data.photoBase64,
        location:     data.location,
      },
      timestamp: Date.now(),
    });

    return reply.code(201).send({ id: event.id, message: 'Intruder event recorded.' });
  });

  // ── GET /sync/intruder — fetch intruder events ────────────────────
  fastify.get('/intruder', { preHandler: [authenticate, requirePlan('guard', 'elite')] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const events = await IntruderEvent.find({ userId: user.userId })
      .sort({ timestamp: -1 })
      .limit(50)
      .select('-__v -_id -userId')
      .lean();

    return reply.code(200).send({ events, count: events.length });
  });
};

export default syncRoutes;
