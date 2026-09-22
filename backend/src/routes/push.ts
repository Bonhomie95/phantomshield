import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticate } from '@/middleware/auth';
import { Device } from '@/models';
import { JWTPayload } from '@/types';
import { sendPushToUser } from '@/services/pushService';

const pushRoutes: FastifyPluginAsync = async (fastify) => {

  // ── POST /push/token — register Expo push token ───────────────────
  fastify.post('/token', { preHandler: [authenticate] }, async (request, reply) => {
    const user   = request.user as JWTPayload;
    const schema = z.object({
      pushToken: z.string().min(1).max(256),
      // Accepted for older clients but ignored: the token's own device is used.
      deviceId:  z.string().max(128).optional(),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload' });
    }

    const { pushToken } = parsed.data;

    await Device.updateOne(
      { deviceId: user.deviceId, userId: user.userId },
      { $set: { pushToken, lastSeenAt: new Date() } }
    );

    return reply.code(200).send({ message: 'Push token registered.' });
  });

  // ── DELETE /push/token — remove push token ────────────────────────
  fastify.delete('/token', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;

    await Device.updateMany(
      { userId: user.userId, deviceId: user.deviceId },
      { $set: { pushToken: null } }
    );

    return reply.code(200).send({ message: 'Push token removed.' });
  });

  // ── POST /push/test — send test notification ──────────────────────
  fastify.post('/test', {
    preHandler: [authenticate],
    config: { rateLimit: { max: 5, timeWindow: 60_000 } },
  }, async (request, reply) => {
    const user = request.user as JWTPayload;

    await sendPushToUser(
      user.userId,
      '🛡 PhantomShield',
      'Push notifications are working correctly.',
      { type: 'test' }
    );

    return reply.code(200).send({ message: 'Test notification sent.' });
  });
};

export default pushRoutes;
