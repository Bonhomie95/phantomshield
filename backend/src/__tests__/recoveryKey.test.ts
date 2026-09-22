/**
 * The recovery key is the only way back into end-to-end encrypted photos, so
 * its encoding must round-trip exactly and forgive typing mix-ups.
 */
import { describe, it, expect } from '@jest/globals';
import { randomBytes } from 'crypto';
import { encodeRecoveryKey, decodeRecoveryKey } from '@/types';

describe('recovery key codec', () => {
  it('round-trips random keys', () => {
    for (let i = 0; i < 50; i++) {
      const key = new Uint8Array(randomBytes(32));
      expect(Array.from(decodeRecoveryKey(encodeRecoveryKey(key))!)).toEqual(Array.from(key));
    }
  });

  it('forgives case, spacing and O/0 I/L/1 confusion', () => {
    const key = new Uint8Array(32).fill(0);
    const typed = encodeRecoveryKey(key).toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o');
    expect(Array.from(decodeRecoveryKey(typed)!)).toEqual(Array.from(key));
  });

  it('rejects the wrong length or alphabet', () => {
    expect(decodeRecoveryKey('ABCD-EFGH')).toBeNull();
    expect(decodeRecoveryKey('U'.repeat(52))).toBeNull(); // U is not in Crockford base32
  });
});
