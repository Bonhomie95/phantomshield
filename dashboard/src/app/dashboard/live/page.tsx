'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { api, IntruderEvent, Device } from '@/lib/api';
import { useWebSocket, WSEvent } from '@/hooks/useWebSocket';
import {
  Card, Badge, Button, SectionHeader, EmptyState, Spinner, AlertBanner, StatusDot,
} from '@/components/ui';
import { trackWeb } from '@/lib/analytics';
import { THEFT_SIGNAL_LABEL, type TheftSignalType } from '@phantomshield/shared';

/**
 * The "my phone isn't with me" screen.
 *
 * This is the surface that has to work when the device is gone: a live feed of
 * every security event as it happens, plus the controls to act on it. Events
 * arrive over the WebSocket the instant the phone reports them — no refresh,
 * no polling delay — and the list is seeded from history on load so there is
 * something to read even if nothing happens while you watch.
 */

interface LiveEvent {
  key: string;
  at: number;
  kind: 'intruder' | 'device' | 'theft';
  title: string;
  detail?: string;
  pinLayer?: string;
  attempt?: number;
  hasPhoto?: boolean;
  location?: { lat: number; lng: number; accuracy: number };
  live: boolean;
}

const KIND_STYLE: Record<LiveEvent['kind'], { icon: string; cls: string }> = {
  intruder: { icon: '🚨', cls: 'border-phantom-danger/30 bg-red-500/5' },
  device:   { icon: '🔒', cls: 'border-phantom-accent/30 bg-phantom-accent/5' },
  // The loudest thing on the page: an OS-level indication the phone may have
  // changed hands.
  theft:    { icon: '📵', cls: 'border-phantom-danger/50 bg-red-500/10' },
};

export default function LivePage() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const seq = useRef(0);

  const loadHistory = useCallback(async () => {
    setError(null);
    try {
      const [vault, devs] = await Promise.all([
        api.sync.intruder(),
        api.devices.list().catch(() => ({ devices: [] as Device[] })),
      ]);
      setDevices(devs.devices);
      setEvents(
        vault.events.map((e: IntruderEvent, i: number) => ({
          key: e.eventId ?? `hist_${i}`,
          at: new Date(e.timestamp).getTime(),
          kind: (THEFT_SIGNAL_LABEL[e.pinLayer as TheftSignalType] ? 'theft' : 'intruder') as LiveEvent['kind'],
          title:
            THEFT_SIGNAL_LABEL[e.pinLayer as TheftSignalType] ??
            (e.pinLayer === 'guard'
              ? 'Guard Mode recorded activity'
              : e.pinLayer === 'locate'
              ? 'Device reported its location'
              : `Wrong PIN on ${e.pinLayer}`),
          detail:
            e.pinLayer === 'locate' || THEFT_SIGNAL_LABEL[e.pinLayer as TheftSignalType]
              ? undefined
              : `Attempt #${e.failedAttempt}`,
          pinLayer: e.pinLayer,
          attempt: e.failedAttempt,
          hasPhoto: !!e.hasPhoto,
          location: e.location,
          live: false,
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your timeline.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { trackWeb('live_page_viewed'); }, []);

  // Prepend anything arriving over the socket, flagged as live.
  const onEvent = useCallback((evt: WSEvent) => {
    const p = evt.payload as Record<string, unknown>;
    const id = `live_${seq.current++}`;

    if (evt.type === 'intruder_alert') {
      setEvents((prev) => [{
        key: id,
        at: typeof p.timestamp === 'number' ? p.timestamp : Date.now(),
        kind: 'intruder',
        title:
          p.pinLayer === 'guard' ? 'Guard Mode recorded activity'
          : p.pinLayer === 'locate' ? 'Device reported its location'
          : `Wrong PIN on ${String(p.pinLayer ?? 'a locked area')}`,
        detail: p.pinLayer === 'locate' ? undefined : `Attempt #${String(p.failedAttempt ?? 1)}`,
        pinLayer: typeof p.pinLayer === 'string' ? p.pinLayer : undefined,
        hasPhoto: !!p.hasPhoto,
        location: p.location as LiveEvent['location'],
        live: true,
      }, ...prev]);
    } else if (evt.type === 'theft_signal') {
      setEvents((prev) => [{
        key: id,
        at: Date.now(),
        kind: 'theft',
        title: THEFT_SIGNAL_LABEL[p.signal as TheftSignalType] ?? 'Possible theft signal',
        detail: typeof p.detail === 'string' ? p.detail : undefined,
        location: p.location as LiveEvent['location'],
        live: true,
      }, ...prev]);
    } else if (evt.type === 'device_locked') {
      setEvents((prev) => [{
        key: id,
        at: Date.now(),
        kind: 'device',
        title: 'Device command delivered',
        detail: typeof p.action === 'string' ? String(p.action) : undefined,
        live: true,
      }, ...prev]);
    }
  }, []);

  const { status } = useWebSocket(onEvent);

  const command = async (label: string, fn: () => Promise<unknown>) => {
    setActing(label);
    setNotice(null);
    try {
      await fn();
      setNotice(`${label} sent. It runs the moment the device is reachable.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : `${label} failed.`;
      // A 403 here is the clearest upgrade signal the product has: someone
      // tried to act on their own missing phone and couldn't.
      if (/upgrade|plan/i.test(msg)) {
        trackWeb('remote_command_blocked', { command: label });
      }
      setNotice(msg);
    } finally {
      setActing(null);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  const primary = devices[0];

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-light text-phantom-text tracking-tight">Live</h1>
          <p className="text-phantom-muted text-sm mt-1">
            Everything your phone reports, as it happens.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-phantom-faint">
          <StatusDot online={status === 'connected'} />
          <span>
            {status === 'connected' ? 'Live — listening'
              : status === 'connecting' ? 'Connecting…'
              : 'Reconnecting…'}
          </span>
        </div>
      </div>

      {error && <AlertBanner title="Couldn't load your timeline" message={error} variant="danger" />}
      {notice && <AlertBanner title={notice} variant="info" onDismiss={() => setNotice(null)} />}

      {/* Remote controls for the device most recently seen. */}
      {primary && (
        <Card>
          <SectionHeader title="If your phone is missing" />
          <div className="flex items-center gap-3 mb-4">
            <StatusDot online={primary.isOnline} />
            <div className="min-w-0">
              <p className="text-sm text-phantom-text">{primary.model}</p>
              <p className="text-xs text-phantom-faint">
                {primary.isOnline
                  ? 'Online now — commands apply immediately'
                  : `Last seen ${formatDistanceToNow(new Date(primary.lastSeenAt), { addSuffix: true })} — commands are queued`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              loading={acting === 'Locate'}
              onClick={() => command('Locate', () => api.devices.locate(primary.deviceId))}
            >📍 Locate</Button>
            <Button
              loading={acting === 'Alarm'}
              onClick={() => command('Alarm', () => api.devices.alert(primary.deviceId))}
            >🔔 Sound alarm</Button>
            <Button
              loading={acting === 'Lock'}
              onClick={() => command('Lock', () => api.devices.lock(primary.deviceId))}
            >🔒 Lock app</Button>
          </div>
          <p className="text-xs text-phantom-faint mt-3">
            Remote control is a Starter feature. On Free you can still see everything below.
          </p>
        </Card>
      )}

      <div>
        <SectionHeader title="Timeline" action="Refresh" onAction={loadHistory} />
        {events.length === 0 ? (
          <EmptyState
            icon="🛡"
            title="Nothing reported yet"
            sub="When someone touches your phone, it shows up here within seconds."
          />
        ) : (
          <div className="space-y-2">
            {events.map((e) => {
              const style = KIND_STYLE[e.kind];
              return (
                <div key={e.key} className={`flex items-start gap-3 p-3 rounded-xl border ${style.cls}`}>
                  <span className="mt-0.5 shrink-0" aria-hidden="true">{style.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm text-phantom-text font-medium">{e.title}</p>
                      {e.live && <Badge variant="accent">Live</Badge>}
                      {e.hasPhoto && <Badge variant="danger">Photo</Badge>}
                    </div>
                    {e.detail && <p className="text-xs text-phantom-muted mt-0.5">{e.detail}</p>}
                    {e.location && (
                      <a
                        className="text-xs text-phantom-accent hover:underline"
                        href={`https://maps.google.com/?q=${e.location.lat},${e.location.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        📍 {e.location.lat.toFixed(5)}, {e.location.lng.toFixed(5)}
                      </a>
                    )}
                    <p className="text-xs text-phantom-faint mt-0.5">
                      {format(new Date(e.at), 'MMM d, h:mm:ss a')}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
