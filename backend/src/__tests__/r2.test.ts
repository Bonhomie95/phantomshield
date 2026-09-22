/**
 * The dependency-free R2 (SigV4) presigner.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

describe('R2 presigner', () => {
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

  it('is configured only when every R2 var is present', () => {
    expect(require('../services/r2').isR2Configured()).toBe(true);
    process.env.R2_BUCKET_NAME = '';
    expect(require('../services/r2').isR2Configured()).toBe(false);
  });

  it('builds a presigned URL with every required SigV4 param', () => {
    const { presign } = require('../services/r2');
    const url = presign('PUT', 'intruder/user1/evt_1.jpg');

    expect(url.startsWith('https://acct123.r2.cloudflarestorage.com/ps-media/intruder/user1/evt_1.jpg')).toBe(true);
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(url).toContain('X-Amz-Credential=AKIAEXAMPLE');
    expect(url).toContain('X-Amz-Expires=300');
    expect(url).toContain('X-Amz-SignedHeaders=host');
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]{64}/);
  });

  it('signs each method differently, so a read URL can never write', () => {
    const { presign } = require('../services/r2');
    const sigOf = (u: string) => u.match(/X-Amz-Signature=([0-9a-f]+)/)?.[1];
    const key = 'intruder/user1/evt_1.jpg';
    const sigs = new Set([sigOf(presign('PUT', key)), sigOf(presign('GET', key)), sigOf(presign('DELETE', key))]);
    expect(sigs.size).toBe(3);
  });

  it('keeps a hostile event id inside the account’s own prefix', () => {
    const { intruderKey } = require('../services/storage');
    const { presign } = require('../services/r2');
    const url = presign('GET', intruderKey('user1', '../../other/evt'));
    expect(url).toContain('/ps-media/intruder/user1/');
    expect(url).not.toContain('..');
  });
});
