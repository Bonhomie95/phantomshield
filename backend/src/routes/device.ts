import { FastifyPluginAsync } from 'fastify';
import { authenticate, requirePlan } from '@/middleware/auth';
import { Device } from '@/models';
import { JWTPayload } from '@/types';
import { pushDeviceCommand, popDeviceCommands, getUserOnlineDevices } from '@/config/redis';
import { wsBroadcastToUser } from '@/services/wsService';

const deviceRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /devices — list user's devices ────────────────────────────
  fastify.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;

    const devices = await Device.find({ userId: user.userId })
      .select('-__v')
      .sort({ lastSeenAt: -1 })
      .lean();

    // Mark which devices are currently online (Redis presence)
    const onlineIds = new Set(await getUserOnlineDevices(user.userId));

    const enriched = devices.map(d => ({
      ...d,
      isOnline: onlineIds.has(d.deviceId),
    }));

    return reply.code(200).send({ devices: enriched, count: devices.length });
  });

  // ── DELETE /devices/:deviceId — remove a device ───────────────────
  fastify.delete('/:deviceId', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { deviceId } = request.params as { deviceId: string };

    const device = await Device.findOne({ deviceId, userId: user.userId });
    if (!device) return reply.code(404).send({ error: 'Device not found.' });

    if (deviceId === user.deviceId) {
      return reply.code(400).send({ error: 'Cannot remove your current device. Logout first.' });
    }

    await Device.deleteOne({ deviceId, userId: user.userId });

    // Tell the device to log out if it's online
    await pushDeviceCommand(deviceId, 'lock_app', { reason: 'device_removed' });
    wsBroadcastToUser(user.userId, {
      type: 'device_locked',
      payload: { deviceId, reason: 'device_removed' },
      timestamp: Date.now(),
    });

    return reply.code(200).send({ message: 'Device removed.' });
  });

  // ── POST /devices/:deviceId/lock — remote app lock ────────────────
  fastify.post('/:deviceId/lock', {
    preHandler: [authenticate, requirePlan('guard', 'elite')],
  }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { deviceId } = request.params as { deviceId: string };

    const device = await Device.findOne({ deviceId, userId: user.userId });
    if (!device) return reply.code(404).send({ error: 'Device not found.' });

    // Queue command for when device connects
    await pushDeviceCommand(deviceId, 'lock_app', { lockedBy: 'remote', timestamp: Date.now() });

    // Also broadcast immediately if device is online
    wsBroadcastToUser(user.userId, {
      type: 'device_locked',
      payload: { deviceId, lockedBy: 'remote' },
      timestamp: Date.now(),
    });

    device.isLocked = true;
    await device.save();

    return reply.code(200).send({ message: 'Lock command sent to device.', queued: true });
  });

  // ── POST /devices/:deviceId/unlock — remove remote lock ───────────
  fastify.post('/:deviceId/unlock', {
    preHandler: [authenticate, requirePlan('guard', 'elite')],
  }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { deviceId } = request.params as { deviceId: string };

    const device = await Device.findOne({ deviceId, userId: user.userId });
    if (!device) return reply.code(404).send({ error: 'Device not found.' });

    device.isLocked = false;
    await device.save();

    return reply.code(200).send({ message: 'Device unlocked.' });
  });

  // ── POST /devices/:deviceId/wipe-logs — remote wipe activity ──────
  fastify.post('/:deviceId/wipe-logs', {
    preHandler: [authenticate, requirePlan('guard', 'elite')],
  }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { deviceId } = request.params as { deviceId: string };

    const device = await Device.findOne({ deviceId, userId: user.userId });
    if (!device) return reply.code(404).send({ error: 'Device not found.' });

    // Queue command for device
    await pushDeviceCommand(deviceId, 'wipe_logs', { timestamp: Date.now() });

    // Also wipe server-side events for this device
    const { deletedCount } = await (await import('@/models')).ActivityEvent.deleteMany({
      userId: user.userId,
      deviceId,
    });

    wsBroadcastToUser(user.userId, {
      type: 'device_wipe_logs',
      payload: { deviceId, deletedCount },
      timestamp: Date.now(),
    });

    return reply.code(200).send({
      message: 'Wipe command sent. Server-side logs deleted.',
      deletedCount,
    });
  });

  // ── POST /devices/:deviceId/alert — trigger alert sound ───────────
  fastify.post('/:deviceId/alert', {
    preHandler: [authenticate, requirePlan('guard', 'elite')],
  }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { deviceId } = request.params as { deviceId: string };

    // Ownership check — same as the other remote-command routes.
    const device = await Device.findOne({ deviceId, userId: user.userId });
    if (!device) return reply.code(404).send({ error: 'Device not found.' });

    await pushDeviceCommand(deviceId, 'send_alert', {
      message: 'Remote alert triggered',
      timestamp: Date.now(),
    });

    wsBroadcastToUser(user.userId, {
      type: 'device_locked', // reuse for now
      payload: { deviceId, action: 'alert' },
      timestamp: Date.now(),
    });

    return reply.code(200).send({ message: 'Alert command queued for device.' });
  });

  // ── GET /devices/:deviceId/commands — poll commands (offline devices)
  fastify.get('/:deviceId/commands', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { deviceId } = request.params as { deviceId: string };

    // Only the device itself can poll its commands
    if (deviceId !== user.deviceId) {
      return reply.code(403).send({ error: 'You can only poll commands for your current device.' });
    }

    const commands = await popDeviceCommands(deviceId);
    return reply.code(200).send({ commands, count: commands.length });
  });

  // ── PATCH /devices/:deviceId — update device info ─────────────────
  fastify.patch('/:deviceId', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { deviceId } = request.params as { deviceId: string };

    if (deviceId !== user.deviceId) {
      return reply.code(403).send({ error: 'You can only update your current device.' });
    }

    const body = request.body as {
      pushToken?: string;
      appVersion?: string;
      osVersion?: string;
    };

    const device = await Device.findOne({ deviceId, userId: user.userId });
    if (!device) return reply.code(404).send({ error: 'Device not found.' });

    if (body.pushToken)  device.pushToken  = body.pushToken;
    if (body.appVersion) device.appVersion = body.appVersion;
    if (body.osVersion)  device.osVersion  = body.osVersion;
    device.lastSeenAt = new Date();
    await device.save();

    return reply.code(200).send({ message: 'Device updated.' });
  });
};

export default deviceRoutes;
