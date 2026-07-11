import { FastifyPluginAsync } from 'fastify';
import { WebSocket } from 'ws';
import { JWTPayload, WSMessage } from '@/types';
import { Device, User } from '@/models';
import { setDeviceOnline, setDeviceOffline, popDeviceCommands, getRedis } from '@/config/redis';

// ─── Connection Registry (per-instance) ───────────────────────────────────────
// Sockets live on whichever instance the client connected to. To broadcast
// across instances we publish on a Redis channel; every instance delivers to
// its own local sockets, so each socket receives a message exactly once.

type UserConnections = Map<string, Set<WebSocket>>;
const connections: UserConnections = new Map();

const WS_CHANNEL = 'ws:user_broadcast';
let subscriber: ReturnType<typeof getRedis> | null = null;

// Deliver to this instance's own sockets for the user.
const deliverLocal = (userId: string, message: WSMessage): void => {
  const userConns = connections.get(userId);
  if (!userConns || userConns.size === 0) return;
  const payload = JSON.stringify(message);
  for (const ws of userConns) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
};

/** Subscribe this instance to cross-instance WS broadcasts. Call once at boot. */
export const initWsPubSub = (): void => {
  if (subscriber) return;
  subscriber = getRedis().duplicate();
  subscriber.subscribe(WS_CHANNEL).catch((err) =>
    console.error('[WS] pubsub subscribe failed:', err?.message ?? err),
  );
  subscriber.on('message', (_channel, raw) => {
    try {
      const { userId, message } = JSON.parse(raw);
      deliverLocal(userId, message);
    } catch {
      /* ignore malformed */
    }
  });
};

export const wsBroadcastToUser = (userId: string, message: WSMessage): void => {
  // Publish so every instance (including this one) delivers to its own sockets.
  getRedis()
    .publish(WS_CHANNEL, JSON.stringify({ userId, message }))
    .catch(() => deliverLocal(userId, message)); // fall back to local if publish fails
};

export const wsGetConnectionCount = (): number => {
  let count = 0;
  for (const conns of connections.values()) count += conns.size;
  return count;
};

// ─── WebSocket Plugin ─────────────────────────────────────────────────────────

const wsRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /ws — real-time event stream ──────────────────────────────
  fastify.get('/ws', { websocket: true }, async (socket, request) => {
    const rawToken = (request.query as Record<string, string>).token;
    if (!rawToken) {
      socket.close(1008, 'Missing token');
      return;
    }

    // Verify JWT manually (can't use preHandler with WS easily)
    let user: JWTPayload;
    try {
      user = fastify.jwt.verify<JWTPayload>(rawToken);
    } catch {
      socket.close(1008, 'Invalid token');
      return;
    }

    const userId            = user.userId;

    // A suspended/deleted account must not keep a live socket just because its
    // 15-min access token hasn't expired yet.
    const active = await User.exists({ _id: userId, isActive: true });
    if (!active) {
      socket.close(1008, 'Account inactive');
      return;
    }

    const requestedDeviceId = (request.query as Record<string, string>).deviceId ?? user.deviceId;

    // A caller must not drain another device's command queue or spoof its
    // presence: only accept a deviceId that belongs to the authenticated user.
    // Fall back to the token's own bound device otherwise.
    let deviceId = user.deviceId;
    if (requestedDeviceId === user.deviceId) {
      deviceId = requestedDeviceId;
    } else {
      const owned = await Device.exists({ deviceId: requestedDeviceId, userId });
      if (!owned) {
        socket.close(1008, 'Device not owned by user');
        return;
      }
      deviceId = requestedDeviceId;
    }

    // Register connection
    if (!connections.has(userId)) connections.set(userId, new Set());
    connections.get(userId)!.add(socket);

    await setDeviceOnline(deviceId, userId);
    console.log(`[WS] User ${userId} connected (${connections.get(userId)!.size} connections)`);

    // Send welcome + any queued commands
    const queued = await popDeviceCommands(deviceId);
    socket.send(JSON.stringify({
      type: 'connected',
      payload: { userId, deviceId, queuedCommands: queued },
      timestamp: Date.now(),
    }));

    if (queued.length > 0) {
      for (const cmd of queued) {
        socket.send(JSON.stringify({ type: cmd.command, payload: cmd.payload, timestamp: cmd.ts }));
      }
    }

    // ── Heartbeat ────────────────────────────────────────────────
    const heartbeat = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping', payload: {}, timestamp: Date.now() }));
      }
    }, 30_000);

    // ── Message Handler ───────────────────────────────────────────
    socket.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as WSMessage;
        if (msg.type === 'pong') {
          await setDeviceOnline(deviceId, userId); // refresh presence TTL
        }
      } catch {
        // Ignore malformed messages
      }
    });

    // ── Disconnect ────────────────────────────────────────────────
    socket.on('close', async () => {
      clearInterval(heartbeat);
      connections.get(userId)?.delete(socket);
      if (connections.get(userId)?.size === 0) connections.delete(userId);
      await setDeviceOffline(deviceId, userId);
      console.log(`[WS] User ${userId} disconnected`);
    });

    socket.on('error', (err) => {
      console.error(`[WS] Error for user ${userId}:`, err.message);
    });
  });
};

export default wsRoutes;
