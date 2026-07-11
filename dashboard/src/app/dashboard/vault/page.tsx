'use client';
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { api, IntruderEvent } from '@/lib/api';
import { Card, Badge, Button, EmptyState, Spinner, AlertBanner } from '@/components/ui';

export default function VaultPage() {
  const [events, setEvents] = useState<IntruderEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [selected, setSelected] = useState<IntruderEvent | null>(null);

  useEffect(() => {
    api.sync.intruder()
      .then(r => setEvents(r.events))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div className="space-y-8 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-light text-phantom-text tracking-tight">Intruder Vault</h1>
          <p className="text-phantom-muted text-sm mt-1">{events.length} captured event(s)</p>
        </div>
      </div>

      {error && <AlertBanner title="Error" message={error} variant="danger" />}

      {/* Disclosure notice */}
      <Card className="border-phantom-accent/10 bg-phantom-accent/5">
        <p className="text-xs text-phantom-muted leading-relaxed">
          <span className="text-phantom-accent font-semibold">Transparency notice:</span> Photos in this vault are captured only when an incorrect PIN is entered on your device.
          This feature is opt-in and disclosed to the device owner during setup. Images are encrypted before upload — PhantomShield servers store ciphertext only.
        </p>
      </Card>

      {events.length === 0 ? (
        <EmptyState
          icon="📸"
          title="No intruder events"
          sub="When someone enters the wrong PIN (if snapshot is enabled), their photo will appear here."
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {events.map((event, i) => (
            <div
              key={event.eventId ?? i}
              className="bg-phantom-surface border border-phantom-border rounded-2xl overflow-hidden cursor-pointer hover:border-phantom-danger/40 transition-colors group"
              onClick={() => setSelected(event)}
            >
              {/* Photo area */}
              <div className="aspect-[3/4] bg-phantom-card flex items-center justify-center relative overflow-hidden">
                {event.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={event.photoUrl}
                    alt="Intruder snapshot"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-4xl opacity-20">👤</span>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-phantom-bg/80 to-transparent" />
                <div className="absolute bottom-2 left-2 right-2">
                  <Badge variant="danger">Attempt #{event.failedAttempt}</Badge>
                </div>
              </div>

              {/* Meta */}
              <div className="p-3 space-y-1">
                <p className="text-xs text-phantom-text font-medium">
                  {format(new Date(event.timestamp), 'MMM d, h:mm a')}
                </p>
                <p className="text-xs text-phantom-muted capitalize">PIN: {event.pinLayer}</p>
                {event.location && (
                  <p className="text-xs text-phantom-faint truncate">
                    📍 {event.location.lat.toFixed(4)}, {event.location.lng.toFixed(4)}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 bg-phantom-bg/90 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <Card className="max-w-md w-full space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-light text-phantom-text">Intruder Detail</h2>
              <button onClick={() => setSelected(null)} className="text-phantom-muted hover:text-phantom-text">✕</button>
            </div>

            <div className="aspect-[4/3] bg-phantom-card rounded-xl flex items-center justify-center">
              <span className="text-6xl opacity-20">👤</span>
            </div>

            <div className="space-y-2 text-sm">
              <Row label="Time"    value={format(new Date(selected.timestamp), 'MMMM d, yyyy — h:mm:ss a')} />
              <Row label="PIN Layer" value={selected.pinLayer} />
              <Row label="Attempt" value={`#${selected.failedAttempt}`} />
              {selected.location && (
                <Row label="Location" value={`${selected.location.lat.toFixed(6)}, ${selected.location.lng.toFixed(6)}`} />
              )}
              {selected.location && (
                <Row label="Accuracy" value={`±${Math.round(selected.location.accuracy)}m`} />
              )}
              <Row label="Photo" value={selected.photoUrl ? 'Captured (encrypted)' : 'Not captured'} />
            </div>

            {selected.location && (
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => window.open(`https://maps.google.com/?q=${selected.location!.lat},${selected.location!.lng}`, '_blank')}
              >
                📍 View on Google Maps
              </Button>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between items-start gap-4">
    <span className="text-phantom-faint shrink-0">{label}</span>
    <span className="text-phantom-text text-right font-mono text-xs">{value}</span>
  </div>
);
