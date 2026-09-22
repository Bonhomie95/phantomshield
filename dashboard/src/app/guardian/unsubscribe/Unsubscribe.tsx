'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';

export function Unsubscribe({ token }: { token: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  const submit = async () => {
    setState('busy');
    const res = await fetch('/api/guardian/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    setState(res?.ok ? 'done' : 'error');
  };

  if (state === 'done') {
    return (
      <p className="text-sm text-emerald-400" role="status">
        Done — you won&apos;t get any more PhantomShield alerts about this person&apos;s phone.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Button variant="primary" loading={state === 'busy'} onClick={submit}>Stop these emails</Button>
      {state === 'error' && (
        <p className="text-sm text-phantom-danger" role="alert">That didn&apos;t work. The link may be invalid — try again later.</p>
      )}
    </div>
  );
}
