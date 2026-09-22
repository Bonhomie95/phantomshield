/**
 * The same expiring-state guarantees as mongoState.test.ts, with Redis as the
 * backend. Needs a real Redis — set REDIS_TEST_URL (use a spare database
 * number, e.g. redis://127.0.0.1:6379/15; it is flushed). Skipped otherwise.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

const URL = process.env.REDIS_TEST_URL;
const d = URL ? describe : describe.skip;

d('Redis-backed state', () => {
  let kv: typeof import('../config/kv');
  let redis: typeof import('../config/redis');

  beforeAll(async () => {
    process.env.REDIS_URL = URL;
    redis = await import('../config/redis');
    kv = await import('../config/kv');
    await redis.connectRedis();
    await redis.getRedis()!.flushdb();
  });

  afterAll(async () => {
    await redis.getRedis()?.flushdb();
    await redis.closeRedis();
    delete process.env.REDIS_URL;
  });

  it('round-trips JSON values', async () => {
    await kv.kvSet('obj', { a: 1, b: ['x'] }, 60);
    expect(await kv.kvGet('obj')).toEqual({ a: 1, b: ['x'] });
    await kv.kvDel('obj');
    expect(await kv.kvGet('obj')).toBeNull();
  });

  it('WS tickets are single-use', async () => {
    await kv.createWsTicket('t1', { userId: 'u1', deviceId: 'd1' });
    expect(await kv.consumeWsTicket('t1')).toEqual({ userId: 'u1', deviceId: 'd1' });
    expect(await kv.consumeWsTicket('t1')).toBeNull();
  });

  it('setNX only succeeds once, and again after expiry', async () => {
    expect(await kv.kvSetNX('once', 1, 1)).toBe(true);
    expect(await kv.kvSetNX('once', 1, 1)).toBe(false);
    await new Promise((r) => setTimeout(r, 1_200));
    expect(await kv.kvSetNX('once', 1, 60)).toBe(true);
  });

  it('blocks a revoked access token', async () => {
    await kv.blockToken('jti-1', Date.now() + 60_000);
    expect(await kv.isTokenBlocked('jti-1')).toBe(true);
    expect(await kv.isTokenBlocked('jti-2')).toBe(false);
  });

  it('tracks presence per user', async () => {
    await kv.setDeviceOnline('dev-x', 'user-p');
    await kv.setDeviceOnline('dev-y', 'user-p');
    expect((await kv.getUserOnlineDevices('user-p')).sort()).toEqual(['dev-x', 'dev-y']);
    expect(await kv.getUserOnlineDevices('someone-else')).toEqual([]);
    await kv.setDeviceOffline('dev-x', 'user-p');
    expect(await kv.getUserOnlineDevices('user-p')).toEqual(['dev-y']);
  });

  it('drops presence members whose time has passed', async () => {
    await redis.getRedis()!.zadd('presence:user-old', Date.now() - 1_000, 'stale');
    expect(await kv.getUserOnlineDevices('user-old')).toEqual([]);
  });
});
