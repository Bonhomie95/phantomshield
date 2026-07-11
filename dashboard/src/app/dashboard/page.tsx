'use client';
import { useEffect, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, BarChart, Bar,
} from 'recharts';
import { api, DashboardOverview } from '@/lib/api';
import { StatCard, Card, SectionHeader, Badge, EmptyState, Spinner, AlertBanner } from '@/components/ui';

const fmtMs = (ms: number) => {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

export default function OverviewPage() {
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

  const { totals, today, weekTrend, recentAnomalies, recentIntruders } = data;

  const chartData = weekTrend.map(d => ({
    date:      format(new Date(d._id), 'MMM d'),
    events:    d.events,
    anomalies: d.anomalies,
    unlocks:   d.unlocks,
  }));

  return (
    <div className="space-y-8 animate-slide-up">

      {/* Page title */}
      <div>
        <h1 className="text-3xl font-light text-phantom-text tracking-tight">Overview</h1>
        <p className="text-phantom-muted text-sm mt-1">
          {format(new Date(), 'EEEE, MMMM d, yyyy')}
        </p>
      </div>

      {/* Today stats */}
      <div>
        <SectionHeader title="Today" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Screen Time"  value={today.screenTime > 0 ? fmtMs(today.screenTime) : '—'} icon="⏱" accent />
          <StatCard label="Unlocks"      value={today.unlocks}    icon="🔓" />
          <StatCard label="Anomalies"    value={today.anomalies}  icon="⚠" danger={today.anomalies > 0} />
          <StatCard label="Total Events" value={today.totalEvents} icon="📋" />
        </div>
      </div>

      {/* All-time stats */}
      <div>
        <SectionHeader title="All Time" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Events Recorded"   value={totals.totalEvents.toLocaleString()}   icon="≡" />
          <StatCard label="Anomalies Flagged" value={totals.totalAnomalies.toLocaleString()} icon="⚠" danger={totals.totalAnomalies > 0} />
          <StatCard label="Intruder Alerts"   value={totals.totalIntruders.toLocaleString()} icon="📸" danger={totals.totalIntruders > 0} />
          <StatCard label="Devices"           value={totals.deviceCount}                    icon="📱" />
        </div>
      </div>

      {/* 7-day charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Activity trend */}
        <Card>
          <SectionHeader title="7-Day Activity" />
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="eventsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#00D4FF" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#00D4FF" stopOpacity={0}   />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E2D45" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#445577', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#445577', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #1E2D45', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#EEF2FF' }}
                itemStyle={{ color: '#00D4FF' }}
              />
              <Area type="monotone" dataKey="events" stroke="#00D4FF" fill="url(#eventsGrad)" strokeWidth={2} name="Events" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        {/* Anomalies */}
        <Card>
          <SectionHeader title="7-Day Anomalies" />
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E2D45" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#445577', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#445577', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #1E2D45', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#EEF2FF' }}
                itemStyle={{ color: '#FF4757' }}
              />
              <Bar dataKey="anomalies" fill="#FF4757" opacity={0.7} radius={[4, 4, 0, 0]} name="Anomalies" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Recent anomalies + intruders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Recent anomalies */}
        <Card>
          <SectionHeader title="Recent Anomalies" action="View All" onAction={() => window.location.href = '/dashboard/activity?anomalous=true'} />
          {recentAnomalies.length === 0 ? (
            <EmptyState icon="✓" title="No anomalies" sub="Your device activity looks normal." />
          ) : (
            <div className="space-y-2">
              {recentAnomalies.map((e, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/15">
                  <span className="text-amber-400 mt-0.5">⚠</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-phantom-text font-medium truncate">
                      {e.appName ?? e.type}
                    </p>
                    <p className="text-xs text-phantom-muted">{e.anomalyReason}</p>
                    <p className="text-xs text-phantom-faint mt-0.5">
                      {formatDistanceToNow(new Date(e.timestamp), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent intruders */}
        <Card>
          <SectionHeader title="Intruder Alerts" action="View Vault" onAction={() => window.location.href = '/dashboard/vault'} />
          {recentIntruders.length === 0 ? (
            <EmptyState icon="🛡" title="No intruder events" sub="No unauthorized access attempts recorded." />
          ) : (
            <div className="space-y-2">
              {recentIntruders.map((e, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-red-500/5 border border-red-500/15">
                  <span className="text-phantom-danger mt-0.5">🚨</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-phantom-text font-medium">
                      Wrong PIN on <span className="text-phantom-danger">{e.pinLayer}</span>
                    </p>
                    <p className="text-xs text-phantom-muted">Attempt #{e.failedAttempt}</p>
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
    </div>
  );
}
