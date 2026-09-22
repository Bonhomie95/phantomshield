'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { formatDistanceToNow } from 'date-fns';
import { api, Device, LocationPing } from '@/lib/api';
import { useWebSocket, WSEvent } from '@/hooks/useWebSocket';
import { trackWeb } from '@/lib/analytics';
import {
  Card, Button, SectionHeader, EmptyState, Spinner, AlertBanner, StatusDot, Badge,
} from '@/components/ui';

// Leaflet touches `window` on import, so the map must never render on the
// server. Loading it lazily also keeps ~40KB off every other dashboard route.
const DeviceMap = dynamic(() => import('@/components/DeviceMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] items-center justify-center rounded-2xl border border-phantom-border bg-phantom-surface">
      <Spinner size="lg" />
    </div>
  ),
});

const WINDOWS = [
  { label: '1h', hours: 1 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
];

export default function MapPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pings, setPings] = useState<LocationPing[]>([]);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => { trackWeb('map_viewed'); }, []);

  // Load devices once, then default to the most recently seen one.
  useEffect(() => {
    api.devices.list()
      .then((r) => {
        setDevices(r.devices);
        setSelected((cur) => cur ?? r.devices[0]?.deviceId ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load your devices.'))
      .finally(() => setLoading(false));
  }, []);

  const loadTrail = useCallback(async (deviceId: string, windowHours: number) => {
    setError(null);
    try {
      const r = await api.devices.locations(deviceId, windowHours);
      setPings(r.pings);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the location history.');
      setPings([]);
    }
  }, []);

  useEffect(() => {
    if (selected) void loadTrail(selected, hours);
  }, [selected, hours, loadTrail]);

  // Live position updates push straight onto the map — no refresh.
  const onEvent = useCallback((evt: WSEvent) => {
    if (evt.type !== 'location_update') return;
    const p = evt.payload as Record<string, unknown>;
    if (typeof p.deviceId === 'string' && p.deviceId !== selected) return;
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;

    setPings((prev) => [
      {
        lat: p.lat as number,
        lng: p.lng as number,
        accuracy: typeof p.accuracy === 'number' ? p.accuracy : 0,
        battery: typeof p.battery === 'number' ? p.battery : undefined,
        recordedAt: new Date(typeof p.recordedAt === 'number' ? p.recordedAt : Date.now()).toISOString(),
        source: 'background',
      },
      ...prev,
    ]);
  }, [selected]);

  const { status } = useWebSocket(onEvent);

  const device = useMemo(
    () => devices.find((d) => d.deviceId === selected) ?? null,
    [devices, selected],
  );
  const latest = pings[0];

  const requestLocate = async () => {
    if (!selected) return;
    setLocating(true);
    setNotice(null);
    try {
      await api.devices.locate(selected);
      setNotice('Location requested. It appears here as soon as the phone answers.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not request a location.';
      if (/upgrade|plan/i.test(msg)) trackWeb('remote_command_blocked', { command: 'locate' });
      setNotice(msg);
    } finally {
      setLocating(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-light text-phantom-text tracking-tight">Map</h1>
          <p className="text-phantom-muted text-sm mt-1">
            Where your devices have been, and where they are now.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-phantom-faint">
          <StatusDot online={status === 'connected'} />
          <span>{status === 'connected' ? 'Live' : 'Reconnecting…'}</span>
        </div>
      </div>

      {error && <AlertBanner title="Couldn't load the map" message={error} variant="danger" />}
      {notice && <AlertBanner title={notice} variant="info" onDismiss={() => setNotice(null)} />}

      {devices.length === 0 ? (
        <EmptyState
          icon="📱"
          title="No devices yet"
          sub="Install PhantomShield on your phone and sign in to see it here."
        />
      ) : (
        <>
          {/* Device + time-window controls */}
          <div className="flex flex-wrap items-center gap-2">
            {devices.map((d) => (
              <button
                key={d.deviceId}
                onClick={() => setSelected(d.deviceId)}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-all ${
                  d.deviceId === selected
                    ? 'bg-phantom-accent/10 text-phantom-accent border border-phantom-accent/20'
                    : 'text-phantom-muted hover:text-phantom-text border border-transparent'
                }`}
              >
                <StatusDot online={d.isOnline} />
                {d.model}
              </button>
            ))}

            <div className="ml-auto flex items-center gap-1">
              {WINDOWS.map((w) => (
                <button
                  key={w.hours}
                  onClick={() => setHours(w.hours)}
                  className={`rounded-lg px-3 py-1.5 text-xs transition-all ${
                    hours === w.hours
                      ? 'bg-phantom-accent/10 text-phantom-accent border border-phantom-accent/20'
                      : 'text-phantom-muted hover:text-phantom-text border border-transparent'
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          <DeviceMap pings={pings} />

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <SectionHeader title="Last known position" />
              {latest ? (
                <div className="space-y-2 text-sm">
                  <p className="text-phantom-text">
                    {formatDistanceToNow(new Date(latest.recordedAt), { addSuffix: true })}
                  </p>
                  <p className="text-xs text-phantom-faint font-mono">
                    {latest.lat.toFixed(5)}, {latest.lng.toFixed(5)} · ±{Math.round(latest.accuracy)}m
                  </p>
                  {typeof latest.battery === 'number' && (
                    <Badge variant={latest.battery < 0.15 ? 'danger' : 'default'}>
                      Battery {Math.round(latest.battery * 100)}%
                    </Badge>
                  )}
                  <a
                    className="block text-xs text-phantom-accent hover:underline"
                    href={`https://www.openstreetmap.org/?mlat=${latest.lat}&mlon=${latest.lng}#map=17/${latest.lat}/${latest.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open in a full map ↗
                  </a>
                </div>
              ) : (
                <p className="text-sm text-phantom-muted">
                  This device hasn&apos;t reported a position yet. Turn on <strong>Find My Phone</strong> in
                  the app&apos;s settings, or ask it to report now.
                </p>
              )}
            </Card>

            <Card>
              <SectionHeader title="Ask the phone where it is" />
              <p className="text-sm text-phantom-muted mb-4">
                Sends a locate request. An online phone answers within seconds; an offline one
                answers the moment it reconnects.
              </p>
              <Button loading={locating} onClick={requestLocate} disabled={!selected}>
                📍 Request location now
              </Button>
              {device && !device.isOnline && (
                <p className="text-xs text-phantom-faint mt-3">
                  {device.model} was last seen{' '}
                  {formatDistanceToNow(new Date(device.lastSeenAt), { addSuffix: true })} — the
                  request is queued.
                </p>
              )}
            </Card>
          </div>

          <p className="text-xs text-phantom-faint">
            {pings.length} position{pings.length === 1 ? '' : 's'} in the last{' '}
            {hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`}. History length depends on your plan.
          </p>
        </>
      )}
    </div>
  );
}
