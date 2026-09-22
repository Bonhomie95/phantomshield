import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticate, requireCapability } from '@/middleware/auth';
import { Device, LocationPing, IntruderEvent, RefreshToken, DeviceCommand } from '@/models';
import { alertGuardians } from '@/services/guardianService';
import { JWTPayload, PLAN_LIMITS, AppError, THEFT_SIGNAL_LABEL } from '@/types';
import { isPlausiblePing } from '@/lib/geo';
import { pushDeviceCommand, popDeviceCommands, getUserOnlineDevices } from '@/config/kv';
import { wsBroadcastToUser } from '@/services/wsService';
import { notifyDeviceRemoteAction, notifyTheftSignal, notifyLostMode } from '@/services/pushService';

const deviceRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /devices — list user's devices ────────────────────────────
  fastify.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;

    const devices = await Device.find({ userId: user.userId })
      .select('-__v')
      .sort({ lastSeenAt: -1 })
      .lean();

    // Mark which devices are currently online (live presence keys)
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

    // Remove the record AND end its sessions: without revoking the refresh
    // token, a "removed" phone could simply refresh and carry on.
    await Promise.all([
      Device.deleteOne({ deviceId, userId: user.userId }),
      RefreshToken.updateMany({ userId: user.userId, deviceId }, { isRevoked: true }),
      DeviceCommand.deleteMany({ userId: user.userId, deviceId }),
    ]);
    wsBroadcastToUser(user.userId, {
      type: 'device_locked',
      payload: { deviceId, reason: 'device_removed' },
      timestamp: Date.now(),
    });

    return reply.code(200).send({ message: 'Device removed.' });
  });

  // ── POST /devices/:deviceId/lock — remote app lock ────────────────
  fastify.post('/:deviceId/lock', {
    preHandler: [authenticate, requireCapability('remoteCommands', 'Remote device control')],
  }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { deviceId } = request.params as { deviceId: string };

    const device = await Device.findOne({ deviceId, userId: user.userId });
    if (!device) return reply.code(404).send({ error: 'Device not found.' });

    // Queue command for when device connects
    await pushDeviceCommand(user.userId, deviceId, 'lock_app', { lockedBy: 'remote', timestamp: Date.now() });

    // Also broadcast immediately if device is online
    wsBroadcastToUser(user.userId, {
      type: 'device_locked',
      payload: { deviceId, lockedBy: 'remote' },
      timestamp: Date.now(),
    });

    device.isLocked = true;
    await device.save();

    // Confirm the action on the owner's other devices — a remote lock they
    // didn't initiate is exactly the thing they need to hear about.
    void notifyDeviceRemoteAction(user.userId, 'locked', deviceId).catch((err) =>
      request.log.error({ err, userId: user.userId }, 'device-lock push enqueue failed'),
    );

    return reply.code(200).send({ message: 'Lock command sent to device.', queued: true });
  });

  // ── POST /devices/:deviceId/unlock — remove remote lock ───────────
  fastify.post('/:deviceId/unlock', {
    preHandler: [authenticate, requireCapability('remoteCommands', 'Remote device control')],
  }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { deviceId } = request.params as { deviceId: string };

    const device = await Device.findOne({ deviceId, userId: user.userId });
    if (!device) return reply.code(404).send({ error: 'Device not found.' });

    device.isLocked = false;
    await device.save();

    return reply.code(200).send({ message: 'Device unlocked.' });
  });

  // ── POST /devices/:deviceId/alert — trigger alert sound ───────────
  fastify.post('/:deviceId/alert', {
    preHandler: [authenticate, requireCapability('remoteCommands', 'Remote device control')],
  }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { deviceId } = request.params as { deviceId: string };

    // Ownership check — same as the other remote-command routes.
    const device = await Device.findOne({ deviceId, userId: user.userId });
    if (!device) return reply.code(404).send({ error: 'Device not found.' });

    await pushDeviceCommand(user.userId, deviceId, 'send_alert', {
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

  // ── POST /devices/:deviceId/locate — ask the device where it is ───
  // "Where is my phone right now?" The device answers by recording a location
  // event, which then appears in the web timeline like any other evidence.
  fastify.post('/:deviceId/locate', {
    preHandler: [authenticate, requireCapability('remoteCommands', 'Locating a device')],
  }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { deviceId } = request.params as { deviceId: string };

    const device = await Device.findOne({ deviceId, userId: user.userId });
    if (!device) return reply.code(404).send({ error: 'Device not found.' });

    // Queued for an offline device, and delivered instantly over the socket if
    // it happens to be connected.
    await pushDeviceCommand(user.userId, deviceId, 'locate', { requestedAt: Date.now() });
    wsBroadcastToUser(user.userId, {
      type: 'device_locked', // shared command frame; `action` selects the behaviour
      payload: { deviceId, action: 'locate' },
      timestamp: Date.now(),
    });

    return reply.code(200).send({
      message: 'Location requested. It will appear in your timeline when the device responds.',
    });
  });


  // ── PUT /devices/:deviceId/lost-mode — message for whoever finds it ──
  // Free on every plan: getting a lost phone back is the product's whole point.
  // The owner sets it from the web; it lands on the missing phone's lock screen
  // as a push, and fills the app's screen next time the app is opened.
  fastify.put('/:deviceId/lost-mode', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { deviceId } = request.params as { deviceId: string };
    const parsed = z.object({
      message: z.string().trim().min(1).max(200),
      contact: z.string().trim().max(60).optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Write a short message (up to 200 characters).' });

    const lostMode = {
      enabled: true,
      message: parsed.data.message,
      contact: parsed.data.contact ?? '',
      since: new Date(),
    };
    const device = await Device.findOneAndUpdate(
      { deviceId, userId: user.userId },
      { $set: { lostMode } },
      { new: true },
    ).lean();
    if (!device) return reply.code(404).send({ error: 'Device not found.' });

    const payload = { message: lostMode.message, contact: lostMode.contact };
    await pushDeviceCommand(user.userId, deviceId, 'lost_mode', payload);
    wsBroadcastToUser(user.userId, {
      type: 'device_locked',
      payload: { deviceId, action: 'lost_mode', ...payload },
      timestamp: Date.now(),
    });
    const pushed = await notifyLostMode(user.userId, deviceId, lostMode.message, lostMode.contact).catch(() => 0);

    return reply.send({ lostMode: { ...lostMode, since: lostMode.since.toISOString() }, pushed: pushed > 0 });
  });

  // ── DELETE /devices/:deviceId/lost-mode — found it ─────────────────
  fastify.delete('/:deviceId/lost-mode', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { deviceId } = request.params as { deviceId: string };
    const device = await Device.findOneAndUpdate(
      { deviceId, userId: user.userId },
      { $set: { lostMode: { enabled: false, message: '', contact: '', since: null } } },
    ).lean();
    if (!device) return reply.code(404).send({ error: 'Device not found.' });

    // The phone itself clearing it (owner unlocked it) needs no command back.
    if (deviceId !== user.deviceId) {
      await pushDeviceCommand(user.userId, deviceId, 'lost_mode_off', {});
      wsBroadcastToUser(user.userId, {
        type: 'device_locked',
        payload: { deviceId, action: 'lost_mode_off' },
        timestamp: Date.now(),
      });
    }
    return reply.send({ lostMode: { enabled: false, message: '', contact: '', since: null } });
  });

  // ── POST /devices/:deviceId/location — device reports its trail ────
  // Batched: a backgrounded device buffers fixes and flushes them together, so
  // this accepts an array and is idempotent on (deviceId, recordedAt).
  fastify.post('/:deviceId/location', {
    preHandler: [authenticate],
    // A moving device legitimately reports often; this only bounds abuse.
    config: { rateLimit: { max: 240, timeWindow: 3_600_000 } },
  }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { deviceId } = request.params as { deviceId: string };

    // A device may only report its OWN location. Without this, anyone could
    // write a false trail onto another of their devices — or, with a stolen
    // token, poison the evidence that matters most.
    if (deviceId !== user.deviceId) {
      return reply.code(403).send({ error: 'A device can only report its own location.' });
    }

    const parsed = z.object({
      pings: z.array(z.object({
        lat:        z.number().min(-90).max(90),
        lng:        z.number().min(-180).max(180),
        accuracy:   z.number().min(0).max(100_000),
        altitude:   z.number().optional(),
        speed:      z.number().optional(),
        heading:    z.number().optional(),
        battery:    z.number().min(0).max(1).optional(),
        recordedAt: z.number(),
        source:     z.enum(['background', 'event', 'locate', 'theft_signal']).optional(),
      })).min(1).max(200),
    }).safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.flatten() });
    }

    const now = Date.now();
    const docs = parsed.data.pings
      // Reject implausible fixes rather than storing a trail that claims the
      // phone was somewhere impossible — see lib/geo.ts for the rules and the
      // tests that pin them down.
      .filter((p) => isPlausiblePing(p, now))
      .map((p) => ({
        userId:     user.userId,
        deviceId,
        lat:        p.lat,
        lng:        p.lng,
        accuracy:   p.accuracy,
        altitude:   p.altitude,
        speed:      p.speed,
        heading:    p.heading,
        battery:    p.battery,
        source:     p.source ?? 'background',
        recordedAt: new Date(p.recordedAt),
      }));

    if (docs.length === 0) return reply.code(200).send({ inserted: 0, skipped: parsed.data.pings.length });

    let inserted = docs.length;
    try {
      await LocationPing.insertMany(docs, { ordered: false });
    } catch (caught) {
      const err = caught as AppError;
      // Duplicate (deviceId, recordedAt) means a retried batch — not an error.
      if (err?.code === 11000 || err?.writeErrors) {
        inserted = typeof err.result?.nInserted === 'number' ? err.result.nInserted : 0;
      } else {
        throw err;
      }
    }

    // Push the newest fix to any open dashboard so the map moves live.
    const newest = docs[docs.length - 1];
    wsBroadcastToUser(user.userId, {
      type: 'location_update',
      payload: {
        deviceId,
        lat: newest.lat,
        lng: newest.lng,
        accuracy: newest.accuracy,
        battery: newest.battery,
        recordedAt: newest.recordedAt.getTime(),
      },
      timestamp: Date.now(),
    });

    return reply.code(201).send({ inserted, skipped: parsed.data.pings.length - inserted });
  });

  // ── GET /devices/:deviceId/locations — the trail, for the map ──────
  fastify.get('/:deviceId/locations', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { deviceId } = request.params as { deviceId: string };

    const device = await Device.findOne({ deviceId, userId: user.userId }).select('_id').lean();
    if (!device) return reply.code(404).send({ error: 'Device not found.' });

    const query = request.query as { hours?: string; limit?: string };
    const planDays = PLAN_LIMITS[user.plan].historyDays;

    const hoursRaw = parseInt(query.hours ?? '24', 10);
    const hours = Math.min(Math.max(isNaN(hoursRaw) ? 24 : hoursRaw, 1), planDays * 24);
    const limitRaw = parseInt(query.limit ?? '500', 10);
    const limit = Math.min(Math.max(isNaN(limitRaw) ? 500 : limitRaw, 1), 2000);

    const since = new Date(Date.now() - hours * 3_600_000);
    const pings = await LocationPing.find({
      userId: user.userId,
      deviceId,
      recordedAt: { $gte: since },
    })
      .sort({ recordedAt: -1 })
      .limit(limit)
      .select('-__v -_id -userId')
      .lean();

    return reply.code(200).send({
      pings,
      count: pings.length,
      windowHours: hours,
      planHistoryDays: planDays,
    });
  });

  // ── POST /devices/:deviceId/theft-signal — OS-level theft indicators ──
  // A device reporting that something happened to it at the operating-system
  // level: the SIM changed, it was about to be powered off, it came back after
  // a reboot. These are the signals a thief triggers WITHOUT ever opening the
  // app, which is the gap intruder capture alone can never close.
  fastify.post('/:deviceId/theft-signal', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { deviceId } = request.params as { deviceId: string };

    if (deviceId !== user.deviceId) {
      return reply.code(403).send({ error: 'A device can only report its own signals.' });
    }

    const parsed = z.object({
      type: z.enum(['sim_changed', 'sim_removed', 'airplane_mode', 'shutdown', 'rebooted']),
      detail: z.string().max(255).optional(),
      location: z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracy: z.number(),
      }).optional(),
    }).safeParse(request.body);

    if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });
    const { type, detail, location } = parsed.data;

    const eventId = `theft_${type}_${Date.now()}`;
    try {
      await IntruderEvent.create({
        userId: user.userId,
        deviceId,
        eventId,
        timestamp: new Date(),
        // The timeline renders on pinLayer, so the signal type rides there.
        pinLayer: type,
        failedAttempt: 1,
        location,
      });
    } catch (caught) {
      const err = caught as AppError;
      if (err?.code !== 11000) throw err;
    }

    if (location) {
      await LocationPing.create({
        userId: user.userId, deviceId,
        lat: location.lat, lng: location.lng, accuracy: location.accuracy,
        source: 'theft_signal', recordedAt: new Date(),
      }).catch(() => {});
    }

    wsBroadcastToUser(user.userId, {
      type: 'theft_signal',
      payload: { deviceId, signal: type, detail, location },
      timestamp: Date.now(),
    });

    // This is the highest-urgency alert the product has: it means the phone is
    // probably no longer in the owner's hands. Always notify, and never to the
    // device that raised it.
    void notifyTheftSignal(user.userId, type, deviceId, user.email).catch((err) =>
      request.log.error({ err, userId: user.userId }, 'theft-signal alert failed'),
    );
    // …and the people the owner trusts, who may be reachable when they aren't.
    void alertGuardians(user.userId, deviceId, `${THEFT_SIGNAL_LABEL[type]} on their phone.`, 'theft').catch((err) =>
      request.log.error({ err, userId: user.userId }, 'guardian alert failed'),
    );

    return reply.code(201).send({ recorded: true, signal: type });
  });

  // ── GET /devices/:deviceId/commands — poll commands (offline devices)
  fastify.get('/:deviceId/commands', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { deviceId } = request.params as { deviceId: string };

    // Only the device itself can poll its commands
    if (deviceId !== user.deviceId) {
      return reply.code(403).send({ error: 'You can only poll commands for your current device.' });
    }

    const commands = await popDeviceCommands(user.userId, deviceId);
    return reply.code(200).send({ commands, count: commands.length });
  });

  // ── PATCH /devices/:deviceId — update device info ─────────────────
  fastify.patch('/:deviceId', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JWTPayload;
    const { deviceId } = request.params as { deviceId: string };

    if (deviceId !== user.deviceId) {
      return reply.code(403).send({ error: 'You can only update your current device.' });
    }

    const parsed = z.object({
      pushToken:  z.string().max(256).optional(),
      appVersion: z.string().max(32).optional(),
      osVersion:  z.string().max(64).optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });
    const body = parsed.data;

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
