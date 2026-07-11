import { describe, it, expect } from '@jest/globals';
import crypto from 'crypto';
import type { SyncEvent } from '@phantomshield/shared';

// Mirrors the server-side integrity check in routes/sync.ts so we lock down
// the exact bytes both sides must agree on.
const checksumOf = (events: SyncEvent[]) =>
  crypto.createHash('sha256').update(JSON.stringify(events)).digest('hex');

describe('sync batch checksum', () => {
  const events: SyncEvent[] = [
    { id: 'a', type: 'screen_unlocked', timestamp: 1, isAnomalous: false },
    { id: 'b', type: 'app_opened', appName: 'Mail', timestamp: 2, isAnomalous: true, anomalyReason: 'late' },
  ];

  it('is stable for identical payloads', () => {
    expect(checksumOf(events)).toBe(checksumOf(events));
  });

  it('changes when any event field changes', () => {
    const tampered = [{ ...events[0], isAnomalous: true }, events[1]];
    expect(checksumOf(tampered)).not.toBe(checksumOf(events));
  });

  it('produces a 64-char hex sha256 digest', () => {
    expect(checksumOf(events)).toMatch(/^[0-9a-f]{64}$/);
  });
});
