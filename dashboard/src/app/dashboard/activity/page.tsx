'use client';
import { useEffect, useState, useCallback } from 'react';
import { format } from 'date-fns';
import { api, ActivityEvent, Pagination } from '@/lib/api';
import { Card, Badge, Button, SectionHeader, EmptyState, Spinner } from '@/components/ui';

const EVENT_ICONS: Record<string, string> = {
  screen_unlocked:  '🔓',
  screen_locked:    '🔒',
  app_opened:       '▶',
  app_closed:       '■',
  phantom_opened:   '⬡',
  anomaly_detected: '⚠',
};

const fmtDur = (ms?: number) => {
  if (!ms) return null;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

export default function ActivityPage() {
  const [events, setEvents]         = useState<ActivityEvent[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading]       = useState(true);
  const [page, setPage]             = useState(1);
  const [anomalousOnly, setAnomalousOnly] = useState(false);

  const load = useCallback(async (p: number, anomalous: boolean) => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(p), limit: '50' };
      if (anomalous) params.anomalous = 'true';
      const result = await api.dashboard.activity(params);
      setEvents(result.events);
      setPagination(result.pagination);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(page, anomalousOnly); }, [page, anomalousOnly, load]);

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-light text-phantom-text tracking-tight">Activity Log</h1>
          <p className="text-phantom-muted text-sm mt-1">
            {pagination ? `${pagination.total.toLocaleString()} events` : 'Loading...'}
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setAnomalousOnly(false); setPage(1); }}
            className={`px-4 py-2 rounded-xl text-sm transition-all ${!anomalousOnly ? 'bg-phantom-accent/10 text-phantom-accent border border-phantom-accent/20' : 'text-phantom-muted hover:text-phantom-text'}`}
          >
            All Events
          </button>
          <button
            onClick={() => { setAnomalousOnly(true); setPage(1); }}
            className={`px-4 py-2 rounded-xl text-sm transition-all ${anomalousOnly ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-phantom-muted hover:text-phantom-text'}`}
          >
            ⚠ Anomalies Only
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : events.length === 0 ? (
        <EmptyState icon="📋" title="No events found" sub={anomalousOnly ? 'No anomalous events in this period.' : 'No activity recorded yet.'} />
      ) : (
        <>
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-phantom-border">
                    <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-phantom-faint font-semibold">Event</th>
                    <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-phantom-faint font-semibold">App</th>
                    <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-phantom-faint font-semibold">Duration</th>
                    <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-phantom-faint font-semibold">Time</th>
                    <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-phantom-faint font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-phantom-border/50">
                  {events.map((e, i) => (
                    <tr
                      key={e.eventId ?? i}
                      className={`hover:bg-phantom-card/50 transition-colors ${e.isAnomalous ? 'bg-amber-500/5' : ''}`}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span>{EVENT_ICONS[e.type] ?? '•'}</span>
                          <span className="text-phantom-muted text-xs font-mono">{e.type}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-phantom-text">{e.appName ?? '—'}</td>
                      <td className="px-5 py-3 text-phantom-muted font-mono text-xs">
                        {fmtDur(e.duration) ?? '—'}
                      </td>
                      <td className="px-5 py-3 text-phantom-muted text-xs">
                        {format(new Date(e.timestamp), 'MMM d, h:mm a')}
                      </td>
                      <td className="px-5 py-3">
                        {e.isAnomalous ? (
                          <Badge variant="warning" className="block max-w-[180px] truncate" title={e.anomalyReason}>
                            ⚠ {e.anomalyReason ?? 'Anomaly'}
                          </Badge>
                        ) : (
                          <Badge variant="success">Normal</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Pagination */}
          {pagination && pagination.pages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-phantom-faint">
                Page {pagination.page} of {pagination.pages}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                >← Prev</Button>
                <Button
                  variant="secondary"
                  disabled={page >= pagination.pages}
                  onClick={() => setPage(p => p + 1)}
                >Next →</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
