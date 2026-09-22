import { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';
import { Types } from 'mongoose';
import { z } from 'zod';
import { authenticate } from '@/middleware/auth';
import { Device, Guardian, LocationPing, ShareLink, User } from '@/models';
import { JWTPayload, PLAN_LIMITS, AppError, Guardian as GuardianDTO, SharedLocationView } from '@/types';
import { emailGuardianAdded } from '@/services/emailService';
import { alertGuardians, displayName, hashToken, unsubscribeUrl } from '@/services/guardianService';

const toDTO = (g: { _id: Types.ObjectId; name: string; email: string; alertOnGuard: boolean; createdAt: Date }): GuardianDTO => ({
  id: String(g._id),
  name: g.name,
  email: g.email,
  alertOnGuard: g.alertOnGuard,
  createdAt: g.createdAt.toISOString(),
});

const isObjectId = (id: string) => Types.ObjectId.isValid(id);

/** Owner-side guardian management, plus the two public endpoints a guardian uses. */
const guardianRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /guardians ─────────────────────────────────────────────────
  fastify.get('/guardians', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const rows = await Guardian.find({ userId: user.userId }).sort({ createdAt: 1 }).lean();
    return reply.send({ guardians: rows.map(toDTO), limit: PLAN_LIMITS[user.plan].guardians });
  });

  // ── POST /guardians ────────────────────────────────────────────────
  fastify.post('/guardians', {
    preHandler: [authenticate],
    // Each add sends an email to a third party — keep it well away from spam volume.
    config: { rateLimit: { max: 10, timeWindow: 3_600_000 } },
  }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const parsed = z.object({
      name: z.string().trim().min(1).max(60),
      email: z.string().trim().email().max(254),
      alertOnGuard: z.boolean().optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Enter a name and a valid email address.' });

    const limit = PLAN_LIMITS[user.plan].guardians;
    const count = await Guardian.countDocuments({ userId: user.userId });
    if (count >= limit) {
      return reply.code(403).send({
        error: 'Upgrade required',
        message: `Your plan includes ${limit} guardian${limit === 1 ? '' : 's'}.`,
        capability: 'guardians',
      });
    }

    const email = parsed.data.email.toLowerCase();
    if (user.email && email === user.email.toLowerCase()) {
      return reply.code(400).send({ error: 'Add someone else — alerts about your phone already come to you.' });
    }

    let guardian;
    try {
      guardian = await Guardian.create({
        userId: user.userId,
        name: parsed.data.name,
        email,
        alertOnGuard: parsed.data.alertOnGuard ?? true,
        unsubscribeToken: crypto.randomBytes(24).toString('base64url'),
      });
    } catch (caught) {
      if ((caught as AppError)?.code === 11000) {
        return reply.code(409).send({ error: 'That person is already one of your guardians.' });
      }
      throw caught;
    }

    // Tell them, so the first alert they ever get isn't from a stranger.
    const owner = await User.findById(user.userId).select('name email').lean();
    void emailGuardianAdded(email, {
      guardianName: guardian.name,
      ownerName: displayName(owner),
      unsubscribeUrl: unsubscribeUrl(guardian.unsubscribeToken),
    }).catch((err) => request.log.error({ err }, 'guardian welcome email failed'));

    return reply.code(201).send({ guardian: toDTO(guardian) });
  });

  // ── PATCH /guardians/:id ───────────────────────────────────────────
  fastify.patch('/guardians/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { id } = request.params as { id: string };
    const parsed = z.object({ alertOnGuard: z.boolean() }).safeParse(request.body);
    if (!parsed.success || !isObjectId(id)) return reply.code(400).send({ error: 'Invalid request.' });

    const g = await Guardian.findOneAndUpdate(
      { _id: id, userId: user.userId },
      { $set: { alertOnGuard: parsed.data.alertOnGuard } },
      { new: true },
    ).lean();
    if (!g) return reply.code(404).send({ error: 'Guardian not found.' });
    return reply.send({ guardian: toDTO(g) });
  });

  // ── DELETE /guardians/:id ──────────────────────────────────────────
  fastify.delete('/guardians/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { id } = request.params as { id: string };
    if (!isObjectId(id)) return reply.code(400).send({ error: 'Invalid request.' });
    const res = await Guardian.deleteOne({ _id: id, userId: user.userId });
    if (!res.deletedCount) return reply.code(404).send({ error: 'Guardian not found.' });
    return reply.send({ removed: true });
  });

  // ── POST /guardians/alert — "my phone is missing, tell my guardians" ──
  fastify.post('/guardians/alert', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const parsed = z.object({ deviceId: z.string().min(1).max(128) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Choose a device.' });

    const device = await Device.findOne({ userId: user.userId, deviceId: parsed.data.deviceId }).select('_id').lean();
    if (!device) return reply.code(404).send({ error: 'Device not found.' });

    const owner = await User.findById(user.userId).select('name email').lean();
    const sent = await alertGuardians(
      user.userId,
      parsed.data.deviceId,
      `${displayName(owner)} reported their phone as missing.`,
      'manual',
    );
    return reply.send({ sent });
  });

  // ── DELETE /share-links — revoke every live link ───────────────────
  fastify.delete('/share-links', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const res = await ShareLink.deleteMany({ userId: user.userId });
    return reply.send({ revoked: res.deletedCount ?? 0 });
  });

  // ── GET /public/share/:token — what a guardian's link shows ────────
  // Deliberately narrow: where the phone is, and nothing else — no photos, no
  // email, no event history. The token is the only credential.
  fastify.get('/public/share/:token', {
    config: { rateLimit: { max: 60, timeWindow: 60_000 } },
  }, async (request, reply) => {
    const { token } = request.params as { token: string };
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return reply.code(404).send({ error: 'Link not found.' });

    const link = await ShareLink.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } }).lean();
    if (!link) return reply.code(404).send({ error: 'This link has expired or was turned off.' });

    const [owner, device, pings] = await Promise.all([
      User.findById(link.userId).select('name email').lean(),
      Device.findOne({ userId: link.userId, deviceId: link.deviceId }).select('model platform').lean(),
      // Only from shortly before the alert — a guardian sees the incident, not
      // the owner's movements from last week.
      LocationPing.find({
        userId: link.userId,
        deviceId: link.deviceId,
        recordedAt: { $gte: new Date(link.createdAt.getTime() - 2 * 3_600_000) },
      }).sort({ recordedAt: -1 }).limit(200).select('lat lng accuracy battery recordedAt').lean(),
    ]);
    if (!device) return reply.code(404).send({ error: 'This link has expired or was turned off.' });

    const last = pings[0];
    const view: SharedLocationView = {
      ownerName: displayName(owner),
      device: { model: device.model, platform: device.platform },
      reason: link.reason,
      createdAt: link.createdAt.toISOString(),
      expiresAt: link.expiresAt.toISOString(),
      last: last
        ? { lat: last.lat, lng: last.lng, accuracy: last.accuracy, battery: last.battery, recordedAt: last.recordedAt.toISOString() }
        : null,
      trail: pings.map((p) => ({ lat: p.lat, lng: p.lng, recordedAt: p.recordedAt.toISOString() })),
    };
    return reply.header('Cache-Control', 'no-store').send(view);
  });

  // ── POST /public/guardians/unsubscribe — guardian opts out ─────────
  // POST, not GET: email scanners prefetch links, and must not unsubscribe anyone.
  fastify.post('/public/guardians/unsubscribe', {
    config: { rateLimit: { max: 20, timeWindow: 60_000 } },
  }, async (request, reply) => {
    const parsed = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid link.' });
    await Guardian.deleteOne({ unsubscribeToken: parsed.data.token });
    // Same answer either way — don't reveal whether a token existed.
    return reply.send({ unsubscribed: true });
  });
};

export default guardianRoutes;
