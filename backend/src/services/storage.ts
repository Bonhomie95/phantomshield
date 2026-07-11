/**
 * Object storage for intruder photos (Cloudflare R2, S3-compatible).
 *
 * Presigned URLs are generated with a hand-rolled AWS SigV4 signer using Node's
 * crypto — no @aws-sdk dependency. The device uploads the photo directly to R2
 * over TLS with a presigned PUT; the dashboard reads it with a short-lived
 * presigned GET. Nothing but the object key is stored in our DB.
 *
 * Disabled cleanly when R2 env vars are absent: isStorageConfigured() is false
 * and callers fall back to on-device-only behaviour.
 */
import crypto from 'crypto';

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? '';
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID ?? '';
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY ?? '';
const BUCKET     = process.env.R2_BUCKET_NAME ?? '';
const REGION     = 'auto';
const SERVICE    = 's3';

export function isStorageConfigured(): boolean {
  return Boolean(ACCOUNT_ID && ACCESS_KEY && SECRET_KEY && BUCKET);
}

function host(): string {
  return `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
}

function hmac(key: crypto.BinaryLike | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

// RFC 3986 encode, preserving path separators in the object key.
function encodeKey(key: string): string {
  return key
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()))
    .join('/');
}

function amzDates(now = new Date()): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z'; // YYYYMMDDTHHMMSSZ
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * Build a presigned URL (query-string auth) for a PUT or GET on the given key.
 */
function presign(method: 'PUT' | 'GET', key: string, expiresSeconds: number): string {
  const { amzDate, dateStamp } = amzDates();
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const canonicalUri = `/${BUCKET}/${encodeKey(key)}`;

  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${ACCESS_KEY}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join('&');

  const canonicalHeaders = `host:${host()}\n`;
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${SECRET_KEY}`, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return `https://${host()}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Deterministic object key for an intruder photo. */
export function intruderKey(userId: string, eventId: string): string {
  const safeId = eventId.replace(/[^a-zA-Z0-9_-]/g, '');
  return `intruder/${userId}/${safeId}.jpg`;
}

export function presignUpload(key: string, expiresSeconds = 300): string {
  return presign('PUT', key, expiresSeconds);
}

export function presignDownload(key: string, expiresSeconds = 300): string {
  return presign('GET', key, expiresSeconds);
}
