/**
 * Intruder photo storage.
 *
 * The device uploads the JPEG to the API (PUT /sync/intruder/:id/photo) and the
 * dashboard reads it back through the authenticated GET on the same path. Every
 * read and write is scoped by the authenticated user id, so there is no key a
 * caller could supply to reach another account's photo.
 *
 * The bytes live in Cloudflare R2 when R2_* is configured, and inline in
 * MongoDB otherwise. Either way one row per photo stays in MongoDB, which is
 * what the quota counter, the existence check and the TTL work from.
 */
import { IntruderPhoto } from '@/models';
import { isR2Configured, r2Put, r2Get, r2Delete } from '@/services/r2';
import { ENCRYPTED_PHOTO_CONTENT_TYPE, ENCRYPTED_PHOTO_MAGIC } from '@/types';

export { ENCRYPTED_PHOTO_CONTENT_TYPE };

/** Largest accepted upload. Photos are downscaled to 1280px on-device (~300KB). */
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

/** Content-Type an intruder-photo upload must use. */
export const INTRUDER_CONTENT_TYPE = 'image/jpeg';

/** Event ids are client-generated; keep them to a safe charset before storing. */
export function safeEventId(eventId: string): string {
  return eventId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

/** Object key in R2, and the reference recorded on the IntruderEvent row. */
export function intruderKey(userId: string, eventId: string): string {
  return `intruder/${userId}/${safeEventId(eventId)}.jpg`;
}

/** True when the buffer starts with the JPEG SOI marker. */
export function isJpeg(buf: Buffer): boolean {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

/**
 * True for an end-to-end encrypted photo: magic, a 12-byte nonce and at least
 * a GCM tag. The server can't read it and doesn't try — it only checks shape.
 */
export function isEncryptedPhoto(buf: Buffer): boolean {
  return buf.length > 4 + 12 + 16 && ENCRYPTED_PHOTO_MAGIC.every((b, i) => buf[i] === b);
}

export async function savePhoto(
  userId: string,
  eventId: string,
  data: Buffer,
  contentType: string = INTRUDER_CONTENT_TYPE,
): Promise<void> {
  const id = safeEventId(eventId);
  const key = intruderKey(userId, id);
  // Only claim the photo is stored once the bytes are somewhere. A failed R2
  // write falls back to MongoDB rather than losing the evidence.
  const inR2 = isR2Configured() && (await r2Put(key, data, contentType));
  await IntruderPhoto.updateOne(
    { userId, eventId: id },
    inR2
      ? { $set: { key, size: data.length, contentType }, $unset: { data: 1 } }
      : { $set: { data, size: data.length, contentType }, $unset: { key: 1 } },
    { upsert: true },
  );
}

export async function getPhoto(userId: string, eventId: string): Promise<{ data: Buffer; contentType: string } | null> {
  const doc = await IntruderPhoto.findOne({ userId, eventId: safeEventId(eventId) })
    .select('data key contentType')
    .lean();
  if (!doc) return null;
  if (doc.key) {
    const data = await r2Get(doc.key);
    return data && { data, contentType: doc.contentType ?? INTRUDER_CONTENT_TYPE };
  }
  if (!doc.data) return null;
  // lean() yields a BSON Binary, not a Buffer; its bytes live on `.buffer`.
  const raw = doc.data as unknown as Buffer | { buffer: Uint8Array };
  return {
    data: Buffer.isBuffer(raw) ? raw : Buffer.from(raw.buffer),
    contentType: doc.contentType ?? INTRUDER_CONTENT_TYPE,
  };
}

export async function hasPhoto(userId: string, eventId: string): Promise<boolean> {
  return !!(await IntruderPhoto.exists({ userId, eventId: safeEventId(eventId) }));
}

/** Photos stored for a user since `since` — the monthly quota counter. */
export async function countPhotosSince(userId: string, since: Date): Promise<number> {
  return IntruderPhoto.countDocuments({ userId, createdAt: { $gte: since } });
}

/** Mongo filter over the photo rows (always scoped by userId at the callers). */
type PhotoFilter = Record<string, unknown>;

/** Delete a user's photos — all of them, or only the listed events. */
export async function deleteUserPhotos(userId: string, eventIds?: string[]): Promise<number> {
  const filter: PhotoFilter = { userId };
  if (eventIds) filter.eventId = { $in: eventIds.map(safeEventId) };
  return deletePhotos(filter);
}

/**
 * Delete the rows matching `filter` and the R2 objects they point at.
 * ponytail: the collection's TTL index expires rows without running this, so
 * give the bucket a matching 365-day lifecycle rule to sweep those objects.
 */
export async function deletePhotos(filter: PhotoFilter): Promise<number> {
  const keys = (await IntruderPhoto.find({ ...filter, key: { $exists: true } }).select('key').lean())
    .map((d) => d.key)
    .filter((k): k is string => !!k);
  const res = await IntruderPhoto.deleteMany(filter);
  if (keys.length) await r2Delete(keys);
  return res.deletedCount ?? 0;
}
