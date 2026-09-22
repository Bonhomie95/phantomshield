/**
 * Tests for the pure helpers around MongoDB-backed intruder photo storage.
 */
import { describe, it, expect } from '@jest/globals';
import { intruderKey, safeEventId, isJpeg, isEncryptedPhoto, MAX_PHOTO_BYTES } from '../services/storage';

describe('photo storage helpers', () => {
  it('sanitizes the event id into a safe key', () => {
    expect(intruderKey('user1', 'evt/../ b!')).toBe('intruder/user1/evtb.jpg');
  });

  it('caps event ids at 64 characters', () => {
    expect(safeEventId('a'.repeat(200))).toHaveLength(64);
  });

  it('keeps legal id characters', () => {
    expect(safeEventId('guard_1700000000000_ab-C')).toBe('guard_1700000000000_ab-C');
  });

  it('recognises JPEG bytes and rejects everything else', () => {
    expect(isJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe(true);
    expect(isJpeg(Buffer.from('<svg onload=alert(1)>'))).toBe(false);
    expect(isJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false); // PNG
    expect(isJpeg(Buffer.alloc(0))).toBe(false);
  });

  it('recognises end-to-end encrypted photos by shape only', () => {
    const enc = Buffer.concat([Buffer.from('PSE1'), Buffer.alloc(12 + 16 + 10, 7)]);
    expect(isEncryptedPhoto(enc)).toBe(true);
    expect(isEncryptedPhoto(Buffer.from('PSE1'))).toBe(false); // no nonce/tag
    expect(isEncryptedPhoto(Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(40).fill(0)]))).toBe(false);
  });

  it('bounds uploads well under the 16MB document limit', () => {
    expect(MAX_PHOTO_BYTES).toBeLessThan(16 * 1024 * 1024);
  });
});
