/**
 * Intruder photo storage, in MongoDB.
 *
 * The device uploads the JPEG to the API (PUT /sync/intruder/:id/photo) and the
 * dashboard reads it back through the authenticated GET on the same path. Every
 * read and write is scoped by the authenticated user id, so there is no key a
 * caller could supply to reach another account's photo.
 */
import { IntruderPhoto } from '@/models';
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

/** Stable reference recorded on the IntruderEvent row (never used as a lookup key). */
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
  await IntruderPhoto.updateOne(
    { userId, eventId: safeEventId(eventId) },
    { $set: { data, size: data.length, contentType } },
    { upsert: true },
  );
}

export async function getPhoto(userId: string, eventId: string): Promise<{ data: Buffer; contentType: string } | null> {
  const doc = await IntruderPhoto.findOne({ userId, eventId: safeEventId(eventId) })
    .select('data contentType')
    .lean();
  if (!doc?.data) return null;
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

/** Delete a user's photos — all of them, or only the listed events. */
export async function deleteUserPhotos(userId: string, eventIds?: string[]): Promise<number> {
  const filter: Record<string, unknown> = { userId };
  if (eventIds) filter.eventId = { $in: eventIds.map(safeEventId) };
  const res = await IntruderPhoto.deleteMany(filter);
  return res.deletedCount ?? 0;
}
