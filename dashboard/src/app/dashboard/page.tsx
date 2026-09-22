'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format, formatDistanceToNow } from 'date-fns';
import { THEFT_SIGNAL_LABEL, type TheftSignalType } from '@phantomshield/shared';
import { api, DashboardOverview } from '@/lib/api';
import { StatCard, Card, SectionHeader, Badge, EmptyState, Spinner, AlertBanner } from '@/components/ui';

/** A readable one-line title for an intruder / Guard / theft-signal event. */
const eventTitle = (pinLayer: string) =>
  THEFT_SIGNAL_LABEL[pinLayer as TheftSignalType] ??
  (pinLayer === 'guard' ? 'Guard Mode was triggered'
    : pinLayer === 'locate' ? 'Device reported its location'
    : `Wrong PIN on ${pinLayer}`);

export default function OverviewPage() {
  const router = useRouter();
  const [data, setData]       = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    api.dashboard.overview()
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center h-64"><Spinner size="lg" /></div>
  );

  if (error) return (
    <AlertBanner title="Failed to load overview" message={error} variant="danger" />
  );

  if (!data) return null;

  const { totals, recentIntruders } = data;
  // Only the latest few events come back, so this is "recent", not all-time.
  const recentTheft = recentIntruders.filter((e) => e.pinLayer in THEFT_SIGNAL_LABEL).length;

  return (
    <div className="space-y-8 animate-slide-up">

      {/* Page title */}
      <div>
        <h1 className="text-3xl font-light text-phantom-text tracking-tight">Overview</h1>
        <p className="text-phantom-muted text-sm mt-1">
          {format(new Date(), 'EEEE, MMMM d, yyyy')}
        </p>
      </div>

      {/* Anti-theft at a glance */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Devices" value={totals.deviceCount} icon="📱" accent onClick={() => router.push('/dashboard/devices')} />
        <StatCard
          label="Security Events"
          value={totals.totalIntruders.toLocaleString()}
          sub="Wrong PINs, Guard Mode and theft signals"
          icon="📸"
          danger={totals.totalIntruders > 0}
          onClick={() => router.push('/dashboard/vault')}
        />
        <StatCard
          label="Theft Signals"
          value={recentTheft}
          sub="SIM swaps and similar, among recent events"
          icon="📵"
          danger={recentTheft > 0}
          onClick={() => router.push('/dashboard/live')}
        />
        <StatCard label="Find My Phone" value="Map" sub="Where your phones were last seen" icon="📍" onClick={() => router.push('/dashboard/map')} />
      </div>

      {/* Recent security events */}
      <Card>
        <SectionHeader title="Recent Security Events" action="View Vault" onAction={() => router.push('/dashboard/vault')} />
        {recentIntruders.length === 0 ? (
          <EmptyState icon="🛡" title="No security events" sub="Nothing suspicious has been reported by your phones." />
        ) : (
          <div className="space-y-2">
            {recentIntruders.map((e, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-red-500/5 border border-red-500/15">
                <span className="text-phantom-danger mt-0.5">🚨</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-phantom-text font-medium">{eventTitle(e.pinLayer)}</p>
                  {e.pinLayer !== 'locate' && !(e.pinLayer in THEFT_SIGNAL_LABEL) && (
                    <p className="text-xs text-phantom-muted">Attempt #{e.failedAttempt}</p>
                  )}
                  <p className="text-xs text-phantom-faint mt-0.5">
                    {formatDistanceToNow(new Date(e.timestamp), { addSuffix: true })}
                  </p>
                </div>
                {e.photoUrl && (
                  <Badge variant="danger">Photo</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
