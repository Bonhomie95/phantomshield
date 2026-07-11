/**
 * Tests for the dependency-free R2 (SigV4) presigner.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

describe('storage presigner', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      R2_ACCOUNT_ID: 'acct123',
      R2_ACCESS_KEY_ID: 'AKIAEXAMPLE',
      R2_SECRET_ACCESS_KEY: 'secretExampleKey',
      R2_BUCKET_NAME: 'ps-media',
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('reports configured only when all R2 vars are present', () => {
    const s = require('../services/storage');
    expect(s.isStorageConfigured()).toBe(true);

    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, R2_ACCOUNT_ID: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', R2_BUCKET_NAME: '' };
    const s2 = require('../services/storage');
    expect(s2.isStorageConfigured()).toBe(false);
  });

  it('sanitizes the event id into a safe object key', () => {
    const s = require('../services/storage');
    // All non-alphanumeric chars (slashes, dots, spaces, punctuation) are stripped.
    expect(s.intruderKey('user1', 'evt/../ b!')).toBe('intruder/user1/evtb.jpg');
  });

  it('builds a presigned upload URL with all required SigV4 params', () => {
    const s = require('../services/storage');
    const key = s.intruderKey('user1', 'evt_1');
    const url = s.presignUpload(key);

    expect(url.startsWith('https://acct123.r2.cloudflarestorage.com/ps-media/intruder/user1/evt_1.jpg')).toBe(true);
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(url).toContain('X-Amz-Credential=AKIAEXAMPLE');
    expect(url).toContain('X-Amz-Expires=300');
    expect(url).toContain('X-Amz-SignedHeaders=host');
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]{64}/);
  });

  it('produces distinct signatures for GET vs PUT on the same key', () => {
    const s = require('../services/storage');
    const key = s.intruderKey('user1', 'evt_1');
    const put = s.presignUpload(key);
    const get = s.presignDownload(key);
    const sigOf = (u: string) => u.match(/X-Amz-Signature=([0-9a-f]+)/)?.[1];
    expect(sigOf(put)).not.toEqual(sigOf(get));
  });
});
