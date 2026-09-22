import { FastifyPluginAsync } from 'fastify';
import { WebSocket } from 'ws';
import { JWTPayload, WSMessage } from '@/types';
import { Device, User } from '@/models';
import { setDeviceOnline, setDeviceOffline, popDeviceCommands, consumeWsTicket } from '@/config/kv';
import { isTokenBlocked } from '@/config/kv';
import { getRedis, getRedisSubscriber } from '@/config/redis';

// ─── Connection Registry ──────────────────────────────────────────────────────
// Sockets live in the process that accepted them. With Redis on, a broadcast
// is published once and every API instance delivers it to its own sockets, so
// the dashboard hears a phone connected to a different instance. Without
// Redis, delivery is in-process (correct for a single instance).

type UserConnections = Map<string, Set<WebSocket>>;
const connections: UserConnections = new Map();

const FANOUT_CHANNEL = 'phantomshield:ws:broadcast';

export const wsBroadcastToUser = (userId: string, message: WSMessage): void => {
  const r = getRedis();
  if (r) {
    void r.publish(FANOUT_CHANNEL, JSON.stringify({ userId, message })).catch(() => deliverLocal(userId, message));
    return;
  }
  deliverLocal(userId, message);
};

/** Subscribe this instance to the shared broadcast channel. No-op without Redis. */
export const initWsFanout = async (): Promise<void> => {
  const sub = getRedisSubscriber();
  if (!sub) return;
  await sub.connect();
  await sub.subscribe(FANOUT_CHANNEL);
  sub.on('message', (_channel, raw) => {
    try {
      const { userId, message } = JSON.parse(raw) as { userId: string; message: WSMessage };
      deliverLocal(userId, message);
    } catch {
      /* ignore malformed frames */
    }
  });
};

const deliverLocal = (userId: string, message: WSMessage): void => {
  const userConns = connections.get(userId);
  if (!userConns || userConns.size === 0) return;
  const payload = JSON.stringify(message);
  for (const ws of userConns) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
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
    const q = request.query as Record<string, string>;

    // Preferred: a single-use ticket (see POST /auth/ws-ticket) so no long-lived
    // token ever appears in the URL / access logs. Fallback: a JWT in `token`
    // for any direct client that hasn't adopted tickets yet.
    let identity: { userId: string; deviceId: string } | null = null;
    if (q.ticket) {
      identity = await consumeWsTicket(q.ticket);
      if (!identity) {
        socket.close(1008, 'Invalid or expired ticket');
        return;
      }
    } else if (q.token) {
      try {
        const decoded = fastify.jwt.verify<JWTPayload>(q.token);
        if (decoded.jti && (await isTokenBlocked(decoded.jti))) throw new Error('revoked');
        identity = { userId: decoded.userId, deviceId: decoded.deviceId };
      } catch {
        socket.close(1008, 'Invalid token');
        return;
      }
    } else {
      socket.close(1008, 'Missing credentials');
      return;
    }

    const user = identity;
    const userId = user.userId;

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

    // Send welcome + any queued commands. Commands ride ONLY inside the
    // `connected` payload — sending them again as individual frames made clients
    // that act on both double-execute (e.g. wipe twice).
    const queued = await popDeviceCommands(userId, deviceId);
    socket.send(JSON.stringify({
      type: 'connected',
      payload: { userId, deviceId, queuedCommands: queued },
      timestamp: Date.now(),
    }));

    // ── Heartbeat + dead-connection reaping ───────────────────────
    // A protocol-level ping whose pong never returns means a half-open socket
    // (common on mobile network drops). Terminate it so it stops accumulating
    // in the in-memory connections map.
    let isAlive = true;
    socket.on('pong', () => { isAlive = true; });
    const heartbeat = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (!isAlive) {
        socket.terminate();
        return;
      }
      isAlive = false;
      socket.ping();
      // Keep the app-level ping too, so browser clients (which can't see
      // protocol pings) still round-trip and refresh presence.
      socket.send(JSON.stringify({ type: 'ping', payload: {}, timestamp: Date.now() }));
    }, 30_000);

    // ── Message Handler ───────────────────────────────────────────
    socket.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as WSMessage;
        if (msg.type === 'pong') {
          isAlive = true;
          await setDeviceOnline(deviceId, userId); // refresh presence TTL
        }
      } catch {
        // Ignore malformed messages (and transient presence write failures)
      }
    });

    // ── Disconnect ────────────────────────────────────────────────
    socket.on('close', async () => {
      clearInterval(heartbeat);
      connections.get(userId)?.delete(socket);
      if (connections.get(userId)?.size === 0) connections.delete(userId);
      await setDeviceOffline(deviceId, userId).catch(() => {});
      console.log(`[WS] User ${userId} disconnected`);
    });

    socket.on('error', (err) => {
      console.error(`[WS] Error for user ${userId}:`, err.message);
    });
  });
};

export default wsRoutes;
