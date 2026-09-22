/**
 * Expiring key/value state: Redis when REDIS_URL is set, MongoDB otherwise.
 * Callers don't know or care which — the semantics are identical.
 *
 * Mongo mode: the TTL monitor only reaps expired documents about once a
 * minute, so an expired key can still physically exist for a short while.
 * Every read therefore filters on `expiresAt > now`; the TTL index is garbage
 * collection, not the source of truth.
 *
 * The remote-command queue always lives in MongoDB: a lock or lost-mode
 * command must survive a Redis restart.
 */
import { Types } from 'mongoose';
import { KeyValue, DeviceCommand } from '@/models';
import { getRedis } from '@/config/redis';
import type { AppError, DeviceCommand as DeviceCommandName } from '@/types';

const expiry = (ttlSeconds: number) => new Date(Date.now() + Math.max(1, ttlSeconds) * 1000);
const live = () => ({ $gt: new Date() });

const ttl = (ttlSeconds: number) => Math.max(1, Math.floor(ttlSeconds));
const parse = <T>(raw: string | null): T | null => {
  if (raw === null) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
};

export const kvSet = async (key: string, value: unknown, ttlSeconds: number): Promise<void> => {
  const r = getRedis();
  if (r) {
    await r.set(key, JSON.stringify(value), 'EX', ttl(ttlSeconds));
    return;
  }
  await KeyValue.updateOne(
    { _id: key },
    { $set: { value, expiresAt: expiry(ttlSeconds) } },
    { upsert: true },
  );
};

export const kvGet = async <T = unknown>(key: string): Promise<T | null> => {
  const r = getRedis();
  if (r) return parse<T>(await r.get(key));
  const doc = await KeyValue.findOne({ _id: key, expiresAt: live() }).lean();
  return doc ? (doc.value as T) : null;
};

/** Set only if absent (or expired). Returns true when this caller created it. */
export const kvSetNX = async (key: string, value: unknown, ttlSeconds: number): Promise<boolean> => {
  const r = getRedis();
  if (r) return (await r.set(key, JSON.stringify(value), 'EX', ttl(ttlSeconds), 'NX')) === 'OK';
  // An expired-but-not-yet-reaped row must not block a fresh claim.
  await KeyValue.deleteOne({ _id: key, expiresAt: { $lte: new Date() } });
  try {
    await KeyValue.create({ _id: key, value, expiresAt: expiry(ttlSeconds) });
    return true;
  } catch (caught) {
    const err = caught as AppError;
    if (err?.code === 11000) return false;
    throw err;
  }
};

/** Atomically read-and-delete (single use). */
export const kvTake = async <T = unknown>(key: string): Promise<T | null> => {
  const r = getRedis();
  if (r) return parse<T>(await r.getdel(key));
  const doc = await KeyValue.findOneAndDelete({ _id: key, expiresAt: live() }).lean();
  return doc ? (doc.value as T) : null;
};

export const kvDel = async (key: string): Promise<void> => {
  const r = getRedis();
  if (r) {
    await r.del(key);
    return;
  }
  await KeyValue.deleteOne({ _id: key });
};

// ─── Access-token blocklist ───────────────────────────────────────────────────

export const blockToken = async (jti: string, expiresAtMs: number): Promise<void> => {
  await kvSet(`blocked:${jti}`, 1, Math.floor((expiresAtMs - Date.now()) / 1000));
};

export const isTokenBlocked = async (jti: string): Promise<boolean> =>
  (await kvGet(`blocked:${jti}`)) !== null;

// ─── One-time WebSocket tickets ───────────────────────────────────────────────
// The browser can't attach an httpOnly cookie to a WebSocket handshake and must
// not hold the raw access token, so it trades its session for a single-use,
// 30-second ticket that the handshake presents once.

export interface WsIdentity { userId: string; deviceId: string }

export const createWsTicket = (ticket: string, data: WsIdentity, ttlSeconds = 30) =>
  kvSet(`wsticket:${ticket}`, data, ttlSeconds);

export const consumeWsTicket = (ticket: string) => kvTake<WsIdentity>(`wsticket:${ticket}`);

// ─── Device presence ──────────────────────────────────────────────────────────

const PRESENCE_TTL = 120;
const presenceKey = (userId: string, deviceId: string) => `presence:${userId}:${deviceId}`;
// Redis mode: one sorted set per user, device → expiry time. Reading it prunes
// the expired members, so there's no key scan and nothing to reap.
const presenceSet = (userId: string) => `presence:${userId}`;

export const setDeviceOnline = async (deviceId: string, userId: string): Promise<void> => {
  const r = getRedis();
  if (r) {
    await r.multi()
      .zadd(presenceSet(userId), Date.now() + PRESENCE_TTL * 1000, deviceId)
      .expire(presenceSet(userId), PRESENCE_TTL)
      .exec();
    return;
  }
  await kvSet(presenceKey(userId, deviceId), { userId, deviceId }, PRESENCE_TTL);
};

export const setDeviceOffline = async (deviceId: string, userId: string): Promise<void> => {
  const r = getRedis();
  if (r) {
    await r.zrem(presenceSet(userId), deviceId);
    return;
  }
  await kvDel(presenceKey(userId, deviceId));
};

export const getUserOnlineDevices = async (userId: string): Promise<string[]> => {
  const r = getRedis();
  if (r) {
    await r.zremrangebyscore(presenceSet(userId), '-inf', String(Date.now()));
    return r.zrange(presenceSet(userId), '0', '-1');
  }
  const rows = await KeyValue.find({ 'value.userId': userId, expiresAt: live() }).lean();
  return rows
    .filter((r) => r._id.startsWith('presence:'))
    .map((r) => (r.value as WsIdentity).deviceId);
};

/** Account deletion: drop everything short-lived that's keyed to this user. */
export const forgetUserState = async (userId: string): Promise<void> => {
  const r = getRedis();
  if (r) await r.del(presenceSet(userId), `overview:${userId}`);
  await Promise.all([
    KeyValue.deleteMany({ 'value.userId': userId }),
    KeyValue.deleteOne({ _id: `overview:${userId}` }),
  ]);
};

// ─── Remote command queue ─────────────────────────────────────────────────────

export type { DeviceCommandName };
export interface QueuedCommand { command: DeviceCommandName; payload: unknown; ts: number }

const COMMAND_TTL_SECONDS = 3600;

export const pushDeviceCommand = async (
  userId: string,
  deviceId: string,
  command: DeviceCommandName,
  payload: unknown = {},
): Promise<void> => {
  await DeviceCommand.create({
    userId: new Types.ObjectId(userId),
    deviceId,
    command,
    payload,
    ts: Date.now(),
    expiresAt: expiry(COMMAND_TTL_SECONDS),
  });
};

/**
 * Drain a device's queue oldest-first. Each command is claimed with its own
 * findOneAndDelete, so two concurrent drains can never both receive it.
 */
export const popDeviceCommands = async (userId: string, deviceId: string): Promise<QueuedCommand[]> => {
  const out: QueuedCommand[] = [];
  for (let i = 0; i < 50; i++) {
    const doc = await DeviceCommand.findOneAndDelete(
      { userId, deviceId, expiresAt: live() },
      { sort: { ts: 1 } },
    ).lean();
    if (!doc) break;
    out.push({ command: doc.command as DeviceCommandName, payload: doc.payload, ts: doc.ts });
  }
  return out;
};
