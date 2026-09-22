import type { Metadata } from 'next';
import { format, formatDistanceToNow } from 'date-fns';
import type { SharedLocationView } from '@phantomshield/shared';
import { BACKEND } from '@/lib/server/backend';
import { ShareMap } from './ShareMap';

/**
 * Public page behind the private link emailed to a guardian. No sign-in: the
 * token in the URL is the only credential, and the backend decides what it
 * may see (the phone's location around the alert — nothing else).
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Shared location',
  robots: { index: false, follow: false },
};

async function load(token: string): Promise<SharedLocationView | null> {
  const res = await fetch(`${BACKEND}/public/share/${encodeURIComponent(token)}`, { cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return null;
  return res.json().catch(() => null);
}

export default async function SharedLocationPage({ params }: { params: { token: string } }) {
  const view = await load(params.token);

  if (!view) {
    return (
      <Shell>
        <h1 className="text-2xl font-light text-phantom-text">This link isn&apos;t available</h1>
        <p className="text-sm text-phantom-muted mt-2">
          It has expired or was turned off by the phone&apos;s owner. Location links only last 24 hours.
          If you&apos;re still worried, contact them another way.
        </p>
      </Shell>
    );
  }

  const { last } = view;
  // DeviceMap wants newest-first pings; trail points carry no accuracy of their own.
  const pings = last
    ? [
        { lat: last.lat, lng: last.lng, accuracy: last.accuracy, battery: last.battery, recordedAt: last.recordedAt },
        ...view.trail.slice(1).map((p) => ({ ...p, accuracy: 0 })),
      ]
    : [];

  return (
    <Shell>
      <h1 className="text-2xl font-light text-phantom-text">{view.ownerName}&apos;s phone may have been taken</h1>
      <p className="text-sm text-phantom-danger mt-2">{view.reason}</p>
      <p className="text-xs text-phantom-faint mt-1">
        {view.device.model} · alerted {formatDistanceToNow(new Date(view.createdAt), { addSuffix: true })}
      </p>

      <div className="mt-6 space-y-4">
        {last ? (
          <>
            <ShareMap pings={pings} />
            <div className="rounded-2xl border border-phantom-border bg-phantom-surface p-4 space-y-2 text-sm">
              <Row label="Last known location" value={`${last.lat.toFixed(5)}, ${last.lng.toFixed(5)}`} />
              <Row label="Accuracy" value={`±${Math.round(last.accuracy)}m`} />
              {typeof last.battery === 'number' && <Row label="Battery" value={`${Math.round(last.battery * 100)}%`} />}
              <Row label="Updated" value={formatDistanceToNow(new Date(last.recordedAt), { addSuffix: true })} />
            </div>
            <div className="flex flex-wrap gap-2">
              <MapLink href={`https://www.google.com/maps?q=${last.lat},${last.lng}`}>Open in Google Maps</MapLink>
              <MapLink href={`https://maps.apple.com/?q=${last.lat},${last.lng}`}>Open in Apple Maps</MapLink>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-phantom-border bg-phantom-surface p-4 text-sm text-phantom-muted">
            The phone hasn&apos;t reported a location yet. Reload this page in a few minutes.
          </div>
        )}

        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          Please contact {view.ownerName} another way. Don&apos;t try to recover the phone yourself.
        </div>

        <p className="text-xs text-phantom-faint">
          This link stops working {format(new Date(view.expiresAt), "MMM d 'at' h:mm a")}.
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-phantom-bg text-phantom-text">
      <header className="border-b border-phantom-border">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-2">
          <span className="text-phantom-accent text-xl" aria-hidden="true">⬡</span>
          <span className="tracking-widest text-sm">PHANTOMSHIELD</span>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between items-start gap-4">
    <span className="text-phantom-faint shrink-0">{label}</span>
    <span className="text-phantom-text text-right font-mono text-xs">{value}</span>
  </div>
);

const MapLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl text-sm bg-phantom-card border border-phantom-border text-phantom-text hover:border-phantom-accent/40"
  >
    📍 {children}
  </a>
);
