import { FastifyRequest, FastifyReply } from 'fastify';
import { JWTPayload, PlanId, PLAN_LIMITS } from '@/types';
import { User, Device } from '@/models';

// ─── Core Auth Guard ──────────────────────────────────────────────────────────

export const authenticate = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> => {
  try {
    await request.jwtVerify();

    const payload = request.user as JWTPayload;

    // Device binding: token must be used from same device
    const deviceId = request.headers['x-device-id'] as string;
    if (deviceId && deviceId !== payload.deviceId) {
      return reply.code(401).send({
        error: 'Device mismatch',
        message: 'This token was issued to a different device.',
      });
    }

    // Check user is still active
    const user = await User.findById(payload.userId).select('isActive plan planExpiresAt').lean();
    if (!user || !user.isActive) {
      return reply.code(401).send({ error: 'Account suspended' });
    }

    // Update plan if expired
    if (user.planExpiresAt && new Date(user.planExpiresAt) < new Date()) {
      // Plan expired — downgrade to free in payload
      (request.user as JWTPayload).plan = 'free';
    }

    // Update device last seen
    await Device.updateOne(
      { deviceId: payload.deviceId, userId: payload.userId },
      { $set: { lastSeenAt: new Date() } }
    );
  } catch (err) {
    return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired token.' });
  }
};

// ─── Plan Guard ───────────────────────────────────────────────────────────────

export const requirePlan = (...allowedPlans: PlanId[]) =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user as JWTPayload;
    if (!allowedPlans.includes(user.plan)) {
      return reply.code(403).send({
        error: 'Plan required',
        message: `This feature requires: ${allowedPlans.join(' or ')} plan.`,
        requiredPlans: allowedPlans,
        currentPlan: user.plan,
        upgradeUrl: 'https://phantomshield.app/upgrade',
      });
    }
  };

// ─── Device Count Guard ───────────────────────────────────────────────────────

export const checkDeviceLimit = async (
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> => {
  const user = request.user as JWTPayload;
  const limit = PLAN_LIMITS[user.plan].devices;

  const count = await Device.countDocuments({ userId: user.userId, isActive: true });
  if (count >= limit) {
    return reply.code(403).send({
      error: 'Device limit reached',
      message: `Your ${user.plan} plan allows ${limit} device(s). Please upgrade or remove a device.`,
    });
  }
};
