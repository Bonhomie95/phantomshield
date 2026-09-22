/**
 * Integration tests for the MongoDB-backed state that replaced Redis/R2:
 * single-use tickets, the token blocklist, per-user command queues, presence,
 * photo scoping, share links and guardian alert throttling. Needs a real
 * MongoDB — set MONGODB_TEST_URI (CI runs a mongo service). Skipped when it is
 * not set.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import mongoose, { Types } from 'mongoose';

const URI = process.env.MONGODB_TEST_URI;
const d = URI ? describe : describe.skip;

d('MongoDB-backed state', () => {
  // Imported lazily so the suite doesn't touch mongoose when skipped.
  let kv: typeof import('../config/kv');
  let storage: typeof import('../services/storage');
  let guardians: typeof import('../services/guardianService');
  let models: typeof import('../models');

  beforeAll(async () => {
    await mongoose.connect(URI!, { dbName: `ps_test_${Date.now()}` });
    kv = await import('../config/kv');
    storage = await import('../services/storage');
    guardians = await import('../services/guardianService');
    models = await import('../models');
    await Promise.all(Object.values(models).map((m) => (m as { syncIndexes?: () => Promise<unknown> })?.syncIndexes?.()));
  }, 30_000); // building every index on a fresh database can take a while

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  it('WS tickets are single-use', async () => {
    await kv.createWsTicket('t1', { userId: 'u1', deviceId: 'd1' });
    expect(await kv.consumeWsTicket('t1')).toEqual({ userId: 'u1', deviceId: 'd1' });
    expect(await kv.consumeWsTicket('t1')).toBeNull();
  });

  it('expired keys read as absent even before the TTL monitor reaps them', async () => {
    await kv.kvSet('k-exp', 1, 1);
    await mongoose.model('KeyValue').updateOne({ _id: 'k-exp' }, { expiresAt: new Date(Date.now() - 1000) });
    expect(await kv.kvGet('k-exp')).toBeNull();
    // …and do not block a fresh set-if-absent.
    expect(await kv.kvSetNX('k-exp', 2, 60)).toBe(true);
  });

  it('setNX only succeeds once', async () => {
    expect(await kv.kvSetNX('once', 1, 60)).toBe(true);
    expect(await kv.kvSetNX('once', 1, 60)).toBe(false);
  });

  it('blocks a revoked access token', async () => {
    await kv.blockToken('jti-1', Date.now() + 60_000);
    expect(await kv.isTokenBlocked('jti-1')).toBe(true);
    expect(await kv.isTokenBlocked('jti-2')).toBe(false);
  });

  it('command queues are isolated per user even with the same device id', async () => {
    const a = new Types.ObjectId().toString();
    const b = new Types.ObjectId().toString();
    await kv.pushDeviceCommand(a, 'same-device', 'lock_app');
    await kv.pushDeviceCommand(a, 'same-device', 'lost_mode', { message: 'Call me' });
    expect(await kv.popDeviceCommands(b, 'same-device')).toEqual([]);
    const got = await kv.popDeviceCommands(a, 'same-device');
    expect(got.map((c) => c.command)).toEqual(['lock_app', 'lost_mode']); // FIFO
    expect(await kv.popDeviceCommands(a, 'same-device')).toEqual([]); // drained
  });

  it('tracks presence per user', async () => {
    await kv.setDeviceOnline('dev-x', 'user-p');
    expect(await kv.getUserOnlineDevices('user-p')).toEqual(['dev-x']);
    expect(await kv.getUserOnlineDevices('someone-else')).toEqual([]);
    await kv.setDeviceOffline('dev-x', 'user-p');
    expect(await kv.getUserOnlineDevices('user-p')).toEqual([]);
  });

  it('photos are only readable by their owner', async () => {
    const owner = new Types.ObjectId().toString();
    const other = new Types.ObjectId().toString();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    await storage.savePhoto(owner, 'evt_1', jpeg);
    expect((await storage.getPhoto(owner, 'evt_1'))?.data.equals(jpeg)).toBe(true);
    expect(await storage.getPhoto(other, 'evt_1')).toBeNull();
    expect(await storage.hasPhoto(owner, 'evt_1')).toBe(true);
    expect(await storage.countPhotosSince(owner, new Date(Date.now() - 60_000))).toBe(1);
    expect(await storage.deleteUserPhotos(owner)).toBe(1);
    expect(await storage.hasPhoto(owner, 'evt_1')).toBe(false);
  });

  it('keeps the content type of encrypted photos', async () => {
    const owner = new Types.ObjectId().toString();
    const enc = Buffer.concat([Buffer.from('PSE1'), Buffer.alloc(40, 1)]);
    await storage.savePhoto(owner, 'evt_enc', enc, storage.ENCRYPTED_PHOTO_CONTENT_TYPE);
    const got = await storage.getPhoto(owner, 'evt_enc');
    expect(got?.contentType).toBe(storage.ENCRYPTED_PHOTO_CONTENT_TYPE);
    expect(got?.data.equals(enc)).toBe(true);
  });

  it('share links store only a hash of the token and expire', async () => {
    const owner = new Types.ObjectId().toString();
    const token = await guardians.createShareLink(owner, 'dev-1', 'test', 1);
    const row = await models.ShareLink.findOne({ userId: owner }).lean();
    expect(row?.tokenHash).toBe(guardians.hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('guardian alerts are throttled per device and trigger', async () => {
    const owner = new Types.ObjectId().toString();
    await models.Device.create({ userId: owner, deviceId: 'dev-t', platform: 'ios' });
    await models.Guardian.create({ userId: owner, name: 'A', email: 'a@example.com', unsubscribeToken: 'x'.repeat(32) });
    // Email isn't configured in tests, so nothing is "sent" — but the first
    // alert still claims the throttle and mints a link; the second is dropped.
    await guardians.alertGuardians(owner, 'dev-t', 'r', 'theft');
    await guardians.alertGuardians(owner, 'dev-t', 'r', 'theft');
    expect(await models.ShareLink.countDocuments({ userId: owner })).toBe(1);
    // Guard alerts skip guardians who opted out of them.
    await models.Guardian.updateOne({ userId: owner }, { alertOnGuard: false });
    await guardians.alertGuardians(owner, 'dev-t', 'r', 'guard');
    expect(await models.ShareLink.countDocuments({ userId: owner })).toBe(1);
  });
});
