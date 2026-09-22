import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticate } from '@/middleware/auth';
import { IntruderEvent, GuardSessionCount } from '@/models';
import { JWTPayload, PLAN_LIMITS, AppError } from '@/types';
import { wsBroadcastToUser } from '@/services/wsService';
import { notifyIntruderDetected } from '@/services/pushService';
import {
  intruderKey, savePhoto, getPhoto, hasPhoto, countPhotosSince, isJpeg, isEncryptedPhoto,
  MAX_PHOTO_BYTES, INTRUDER_CONTENT_TYPE, ENCRYPTED_PHOTO_CONTENT_TYPE, safeEventId,
} from '@/services/storage';
import { alertGuardians } from '@/services/guardianService';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const IntruderSchema = z.object({
  id:               z.string().max(64),
  timestamp:        z.number(),
  pinLayer:         z.string().max(32),
  // Attempts keep counting through lockouts, so a determined intruder can
  // exceed any small cap — rejecting the event then would lose the evidence.
  failedAttempt:    z.number().int().min(1).max(100_000),
  photoBase64:      z.string().max(0).optional(), // legacy field — photos use the upload route
  encryptedPhotoKey: z.string().max(256).optional(),
  location: z.object({
    lat:      z.number().min(-90).max(90),
    lng:      z.number().min(-180).max(180),
    accuracy: z.number().min(0),
  }).optional(),
});

// ─── Sync Plugin ──────────────────────────────────────────────────────────────

/** First instant of the current calendar month (server time). */
function monthStart(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

const syncRoutes: FastifyPluginAsync = async (fastify) => {

  // Raw JPEG bodies for the photo upload route. Registered on this plugin only.
  fastify.addContentTypeParser(
    [INTRUDER_CONTENT_TYPE, ENCRYPTED_PHOTO_CONTENT_TYPE],
    { parseAs: 'buffer', bodyLimit: MAX_PHOTO_BYTES },
    (_req, body, done) => done(null, body),
  );

  // ── POST /sync/intruder — upload intruder event ───────────────────
  fastify.post('/intruder', {
    preHandler: [authenticate],
    // Backstop for a runaway or hostile client. Guard Mode can legitimately
    // fire in bursts, so this is deliberately generous — it exists to bound
    // the worst case (thousands of events an hour from one device), not to
    // shape normal use.
    config: { rateLimit: { max: 120, timeWindow: 3_600_000 } },
  }, async (request, reply) => {
    const user   = request.user as JWTPayload;

    const parsed = IntruderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.flatten() });
    }

    const data = parsed.data;

    // The EVENT is always recorded, on every tier, without limit. Only the
    // PHOTO is metered — and that is enforced at upload time (PUT .../photo).
    // Here we simply link the event to a photo the device actually stored.
    const photoStored = !!data.encryptedPhotoKey && (await hasPhoto(user.userId, data.id));
    const derivedKey = photoStored ? intruderKey(user.userId, data.id) : undefined;
    let event;
    try {
      event = await IntruderEvent.create({
        userId:           user.userId,
        // The token's own device binding, never a client header.
        deviceId:         user.deviceId,
        eventId:          data.id,
        timestamp:        new Date(data.timestamp),
        pinLayer:         data.pinLayer,
        failedAttempt:    data.failedAttempt,
        photoUrl:         derivedKey,   // server-derived reference, or undefined
        location:         data.location,
        encryptedPhotoKey: derivedKey,
      });
    } catch (caught) {
      const err = caught as AppError;
      // A retry of the same event (same id) is a no-op, not an error.
      if (err?.code === 11000) {
        return reply.code(200).send({ id: data.id, message: 'Intruder event already recorded.' });
      }
      throw err;
    }

    // Real-time alert to any open dashboard socket…
    wsBroadcastToUser(user.userId, {
      type: 'intruder_alert',
      payload: {
        id:           event.id,
        timestamp:    data.timestamp,
        pinLayer:     data.pinLayer,
        failedAttempt: data.failedAttempt,
        hasPhoto:     photoStored,
        location:     data.location,
      },
      timestamp: Date.now(),
    });

    // …and a push to the owner's OTHER devices. This is the product's core
    // moment ("someone is trying to get into your phone"), and until now it
    // reached nobody unless a dashboard happened to be open. The device the
    // event came from is excluded so the handset in the intruder's hand stays
    // silent.
    const originDeviceId = user.deviceId;
    // The JWT carries the account email, so the email fallback needs no extra
    // DB read on this hot path.
    void notifyIntruderDetected(
      user.userId,
      data.pinLayer,
      data.failedAttempt,
      originDeviceId,
      user.email,
    ).catch((err) => request.log.error({ err, userId: user.userId }, 'intruder push enqueue failed'));

    // Guard Mode being tripped is the moment a phone is most likely being taken
    // — tell the guardians who asked to hear about it (throttled per device).
    if (data.pinLayer === 'guard') {
      void alertGuardians(
        user.userId,
        originDeviceId,
        'Guard Mode detected someone moving or using their phone while it was left alone.',
        'guard',
      ).catch((err) => request.log.error({ err, userId: user.userId }, 'guardian alert failed'));
    }

    return reply.code(201).send({
      id: event.id,
      message: 'Intruder event recorded.',
      // Tell the device whether the photo was kept, so it can surface an
      // honest "photo not stored — monthly limit reached" state instead of
      // silently implying the image is safe in the cloud.
      photoStored,
    });
  });

  // ── GET /sync/intruder — fetch intruder events ────────────────────
  // Readable on every tier: if the phone is gone, this is the only surface the
  // owner has left. Paid tiers get more history and more stored photos.
  fastify.get('/intruder', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const events = await IntruderEvent.find({ userId: user.userId })
      .sort({ timestamp: -1 })
      .limit(50)
      .select('-__v -_id -userId')
      .lean();

    // The browser fetches the image through the authenticated photo route; we
    // only say whether one exists. Never expose the stored reference.
    const withUrls = events.map(({ photoUrl, encryptedPhotoKey: _k, ...e }) => ({
      ...e,
      hasPhoto: !!photoUrl,
    }));

    return reply.code(200).send({ events: withUrls, count: withUrls.length });
  });

  // ── POST /sync/guard-session — report a completed Guard Mode session ──
  // Guard Mode runs entirely on-device, so the server can only know a session
  // happened if the client reports it. This is the activation signal used by
  // basis for a real activation metric.
  fastify.post('/guard-session', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const now = new Date();

    await GuardSessionCount.updateOne(
      { userId: user.userId },
      { $inc: { sessions: 1 }, $set: { lastAt: now }, $setOnInsert: { firstAt: now } },
      { upsert: true },
    );

    return reply.code(200).send({ ok: true });
  });

  // ── PUT /sync/intruder/:id/photo — upload the JPEG for an event ────
  // Body is the raw image (Content-Type: image/jpeg). The monthly quota is
  // enforced here, and the response says so, so the device can tell the owner
  // honestly that a photo stayed on the phone only.
  fastify.put('/intruder/:id/photo', {
    preHandler: [authenticate],
    config: { rateLimit: { max: 120, timeWindow: 3_600_000 } },
  }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { id } = request.params as { id: string };
    const eventId = safeEventId(id);
    if (!eventId) return reply.code(400).send({ error: 'Invalid event id.' });

    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return reply.code(415).send({ error: 'Send the photo as image/jpeg.' });
    }
    // Either a plain JPEG, or an end-to-end encrypted one the server can't read.
    const encrypted = request.headers['content-type']?.startsWith(ENCRYPTED_PHOTO_CONTENT_TYPE) ?? false;
    if (encrypted ? !isEncryptedPhoto(body) : !isJpeg(body)) {
      return reply.code(415).send({ error: 'Only JPEG photos are accepted.' });
    }

    const limits = PLAN_LIMITS[user.plan];
    if (limits.intruderSnapshots !== -1 && !(await hasPhoto(user.userId, eventId))) {
      const used = await countPhotosSince(user.userId, monthStart());
      if (used >= limits.intruderSnapshots) {
        return reply.code(200).send({ stored: false, photoQuotaReached: true });
      }
    }

    await savePhoto(user.userId, eventId, body, encrypted ? ENCRYPTED_PHOTO_CONTENT_TYPE : INTRUDER_CONTENT_TYPE);
    return reply.code(201).send({ stored: true, key: intruderKey(user.userId, eventId) });
  });

  // ── GET /sync/intruder/:id/photo — the owner views a stored photo ──
  fastify.get('/intruder/:id/photo', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { id } = request.params as { id: string };
    const photo = await getPhoto(user.userId, id);
    if (!photo) return reply.code(404).send({ error: 'Photo not found.' });
    return reply
      .header('Content-Type', photo.contentType)
      .header('Cache-Control', 'private, max-age=300')
      .header('X-Content-Type-Options', 'nosniff')
      .send(photo.data);
  });
};

export default syncRoutes;
