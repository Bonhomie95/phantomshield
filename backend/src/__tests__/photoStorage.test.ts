/**
 * Photo storage against both back ends: bytes in MongoDB when R2 is unset, and
 * bytes in R2 when it is configured. R2 itself is stubbed at fetch(), so the
 * test needs no bucket — only a real MongoDB via MONGODB_TEST_URI, like the
 * other integration suites. Skipped when that is not set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import mongoose, { Types } from 'mongoose';

const URI = process.env.MONGODB_TEST_URI;
const d = URI ? describe : describe.skip;

d('intruder photo storage', () => {
  let storage: typeof import('../services/storage');
  let models: typeof import('../models');
  const bucket = new Map<string, Buffer>();
  const userId = new Types.ObjectId().toString();

  beforeAll(async () => {
    await mongoose.connect(URI!, { dbName: `ps_photo_${Date.now()}` });
    storage = await import('../services/storage');
    models = await import('../models');

    // Stand in for R2: record what the presigned URL would have done.
    global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const key = String(input).split('?')[0].split('/ps-media/')[1];
      const method = init?.method ?? 'GET';
      if (method === 'PUT') {
        bucket.set(key, Buffer.from(init!.body as Uint8Array));
        return new Response(null, { status: 200 });
      }
      if (method === 'DELETE') {
        bucket.delete(key);
        return new Response(null, { status: 204 });
      }
      const data = bucket.get(key);
      return data ? new Response(new Uint8Array(data)) : new Response(null, { status: 404 });
    }) as typeof fetch;
  }, 30_000);

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    bucket.clear();
    await models.IntruderPhoto.deleteMany({});
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET_NAME;
  });

  const useR2 = () => {
    process.env.R2_ACCOUNT_ID = 'acct123';
    process.env.R2_ACCESS_KEY_ID = 'AKIAEXAMPLE';
    process.env.R2_SECRET_ACCESS_KEY = 'secretExampleKey';
    process.env.R2_BUCKET_NAME = 'ps-media';
  };

  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64, 7)]);

  it('keeps the bytes in MongoDB when R2 is not configured', async () => {
    await storage.savePhoto(userId, 'evt_1', jpeg);
    expect(bucket.size).toBe(0);

    const row = await models.IntruderPhoto.findOne({ userId, eventId: 'evt_1' }).lean();
    expect(row?.key).toBeUndefined();
    expect((await storage.getPhoto(userId, 'evt_1'))?.data).toEqual(jpeg);
  });

  it('puts the bytes in R2 and keeps only the key in MongoDB', async () => {
    useR2();
    await storage.savePhoto(userId, 'evt_2', jpeg);

    const row = await models.IntruderPhoto.findOne({ userId, eventId: 'evt_2' }).lean();
    expect(row?.key).toBe(`intruder/${userId}/evt_2.jpg`);
    expect(row?.data).toBeUndefined();
    expect(bucket.get(row!.key!)).toEqual(jpeg);

    // Reads come back through the same route the dashboard uses.
    expect((await storage.getPhoto(userId, 'evt_2'))?.data).toEqual(jpeg);
    expect(await storage.hasPhoto(userId, 'evt_2')).toBe(true);
    expect(await storage.countPhotosSince(userId, new Date(Date.now() - 60_000))).toBe(1);
  });

  it('falls back to MongoDB rather than losing evidence when R2 is down', async () => {
    useR2();
    const ok = global.fetch;
    global.fetch = jest.fn(async () => new Response(null, { status: 500 })) as typeof fetch;
    await storage.savePhoto(userId, 'evt_3', jpeg);
    global.fetch = ok;

    const row = await models.IntruderPhoto.findOne({ userId, eventId: 'evt_3' }).lean();
    expect(row?.key).toBeUndefined();
    expect((await storage.getPhoto(userId, 'evt_3'))?.data).toEqual(jpeg);
  });

  it('deletes the R2 object along with the row', async () => {
    useR2();
    await storage.savePhoto(userId, 'evt_4', jpeg);
    expect(await storage.deleteUserPhotos(userId, ['evt_4'])).toBe(1);
    expect(bucket.size).toBe(0);
    expect(await storage.getPhoto(userId, 'evt_4')).toBeNull();
  });

  it('never serves another account’s photo', async () => {
    useR2();
    await storage.savePhoto(userId, 'evt_5', jpeg);
    const other = new Types.ObjectId().toString();
    expect(await storage.getPhoto(other, 'evt_5')).toBeNull();
    expect(await storage.hasPhoto(other, 'evt_5')).toBe(false);
  });
});
