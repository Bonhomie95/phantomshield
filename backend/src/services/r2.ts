/**
 * Cloudflare R2 (S3-compatible) object storage for intruder photo bytes.
 *
 * Presigned URLs are built with a hand-rolled AWS SigV4 signer on Node's
 * crypto — no S3 SDK in the image. The API signs a URL and moves the bytes
 * itself with fetch(), so the phone and the dashboard keep talking only to the
 * authenticated /sync/intruder/:id/photo routes and no object key ever leaves
 * the server.
 *
 * Leave the R2_* vars unset and isR2Configured() is false: storage.ts then
 * keeps the bytes in MongoDB exactly as before.
 */
import crypto from 'crypto';

const REGION = 'auto';
const SERVICE = 's3';

const cfg = () => ({
  account: process.env.R2_ACCOUNT_ID ?? '',
  key: process.env.R2_ACCESS_KEY_ID ?? '',
  secret: process.env.R2_SECRET_ACCESS_KEY ?? '',
  bucket: process.env.R2_BUCKET_NAME ?? '',
});

export function isR2Configured(): boolean {
  const c = cfg();
  return Boolean(c.account && c.key && c.secret && c.bucket);
}

function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

// RFC 3986 encode, preserving the path separators in the object key.
function encodeKey(key: string): string {
  return key
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()))
    .join('/');
}

/** Presigned (query-auth) URL for one object operation. */
export function presign(method: 'PUT' | 'GET' | 'DELETE', key: string, expiresSeconds = 300): string {
  const c = cfg();
  const host = `${c.account}.r2.cloudflarestorage.com`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const canonicalUri = `/${c.bucket}/${encodeKey(key)}`;

  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${c.key}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join('&');

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${c.secret}`, dateStamp);
  const kSigning = hmac(hmac(hmac(kDate, REGION), SERVICE), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export async function r2Put(key: string, body: Buffer, contentType: string): Promise<boolean> {
  try {
    const res = await fetch(presign('PUT', key), {
      method: 'PUT',
      body: new Uint8Array(body),
      headers: { 'Content-Type': contentType },
    });
    if (!res.ok) console.error('[R2] PUT failed:', res.status);
    return res.ok;
  } catch (err) {
    console.error('[R2] PUT error:', (err as Error).message);
    return false;
  }
}

export async function r2Get(key: string): Promise<Buffer | null> {
  try {
    const res = await fetch(presign('GET', key));
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error('[R2] GET error:', (err as Error).message);
    return null;
  }
}

/** Best-effort delete; a leftover object is a cost, never a correctness bug. */
export async function r2Delete(keys: string[]): Promise<void> {
  await Promise.all(
    keys.map((k) =>
      fetch(presign('DELETE', k), { method: 'DELETE' }).catch((err) =>
        console.error('[R2] DELETE error:', (err as Error).message),
      ),
    ),
  );
}
