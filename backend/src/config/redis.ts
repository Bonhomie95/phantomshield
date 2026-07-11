import Redis from 'ioredis';

let redis: Redis | null = null;

export const getRedis = (): Redis => {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      retryStrategy(times) {
        if (times > 10) return null; // Stop retrying
        return Math.min(times * 200, 3000);
      },
      enableReadyCheck: false,
      lazyConnect: true,
    });

    redis.on('connect',    () => console.log('[Redis] Connected'));
    redis.on('error',      err => console.error('[Redis] Error:', err.message));
    redis.on('reconnecting', () => console.warn('[Redis] Reconnecting...'));
  }
  return redis;
};

export const connectRedis = async (): Promise<void> => {
  await getRedis().connect();
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const cacheSet = async (key: string, value: unknown, ttlSeconds = 300): Promise<void> => {
  await getRedis().setex(key, ttlSeconds, JSON.stringify(value));
};

export const cacheGet = async <T>(key: string): Promise<T | null> => {
  const raw = await getRedis().get(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
};

export const cacheDel = async (key: string): Promise<void> => {
  await getRedis().del(key);
};

// ─── Rate Limit Helpers ───────────────────────────────────────────────────────

export const incrementCounter = async (key: string, windowSeconds: number): Promise<number> => {
  const r = getRedis();
  const count = await r.incr(key);
  if (count === 1) await r.expire(key, windowSeconds);
  return count;
};

// ─── Session / Token Blocklist ────────────────────────────────────────────────

export const blockToken = async (jti: string, expiresAt: number): Promise<void> => {
  const ttl = Math.max(1, Math.floor((expiresAt - Date.now()) / 1000));
  await getRedis().setex(`blocked:${jti}`, ttl, '1');
};

export const isTokenBlocked = async (jti: string): Promise<boolean> => {
  const val = await getRedis().get(`blocked:${jti}`);
  return val === '1';
};

// ─── Device Presence (for WebSocket) ─────────────────────────────────────────
// Presence is tracked two ways: a per-device key with a TTL (the source of
// truth for "is this device live") and a per-user set of that user's device
// ids (so we can list a user's online devices without a global KEYS scan).

const PRESENCE_TTL = 120;

export const setDeviceOnline = async (deviceId: string, userId: string): Promise<void> => {
  const r = getRedis();
  await r.setex(`presence:${deviceId}`, PRESENCE_TTL, userId);
  await r.sadd(`presence:user:${userId}`, deviceId);
  await r.expire(`presence:user:${userId}`, PRESENCE_TTL);
};

export const setDeviceOffline = async (deviceId: string, userId?: string): Promise<void> => {
  const r = getRedis();
  const uid = userId ?? (await r.get(`presence:${deviceId}`));
  await r.del(`presence:${deviceId}`);
  if (uid) await r.srem(`presence:user:${uid}`, deviceId);
};

export const getUserOnlineDevices = async (userId: string): Promise<string[]> => {
  const r = getRedis();
  const ids = await r.smembers(`presence:user:${userId}`);
  if (ids.length === 0) return [];

  // The set can hold stale ids (a device whose presence key expired on an
  // abrupt disconnect). Confirm each against its live TTL key and prune misses.
  const pipeline = r.pipeline();
  ids.forEach((id) => pipeline.exists(`presence:${id}`));
  const results = await pipeline.exec();

  const online: string[] = [];
  const stale: string[] = [];
  ids.forEach((id, i) => {
    if (results?.[i]?.[1]) online.push(id);
    else stale.push(id);
  });
  if (stale.length) await r.srem(`presence:user:${userId}`, ...stale);
  return online;
};

// ─── Remote Command Queue ─────────────────────────────────────────────────────

export type DeviceCommand = 'lock_app' | 'wipe_logs' | 'send_alert';

export const pushDeviceCommand = async (deviceId: string, command: DeviceCommand, payload: unknown = {}): Promise<void> => {
  const item = JSON.stringify({ command, payload, ts: Date.now() });
  await getRedis().lpush(`cmd:${deviceId}`, item);
  await getRedis().expire(`cmd:${deviceId}`, 3600); // commands expire after 1h
};

export const popDeviceCommands = async (deviceId: string): Promise<{ command: DeviceCommand; payload: unknown; ts: number }[]> => {
  const items = await getRedis().lrange(`cmd:${deviceId}`, 0, -1);
  await getRedis().del(`cmd:${deviceId}`);
  return items.map(i => JSON.parse(i));
};
