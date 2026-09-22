'use client';
import dynamic from 'next/dynamic';
import type { MapPing } from '@/components/DeviceMap';

// Leaflet touches `window` on import, so the map must never render on the
// server — and `ssr: false` is only allowed from a client component.
const DeviceMap = dynamic(() => import('@/components/DeviceMap'), { ssr: false });

export function ShareMap({ pings }: { pings: MapPing[] }) {
  return <DeviceMap pings={pings} height={320} />;
}
