'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { AlertBanner } from '@/components/ui';
import { useAuthStore } from '@/hooks/useAuthStore';
import { useWebSocket, WSEvent } from '@/hooks/useWebSocket';

interface LiveAlert { id: string; title: string; msg: string; variant: 'danger' | 'warning' | 'info' }

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, loadUser } = useAuthStore();
  const router = useRouter();
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const alertSeq = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => { loadUser(); }, [loadUser]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/auth/login');
  }, [isLoading, isAuthenticated, router]);

  // Clear any pending auto-dismiss timers on unmount.
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const handleWsEvent = useCallback((event: WSEvent) => {
    const id = `alert_${alertSeq.current++}`;
    const payload = event.payload as Record<string, unknown>;
    if (event.type === 'intruder_alert') {
      setAlerts(a => [...a, { id, title: '🚨 Intruder Alert', msg: `Wrong PIN on ${String(payload.pinLayer ?? 'a PIN layer')}`, variant: 'danger' }]);
    } else {
      return;
    }
    const t = setTimeout(() => setAlerts(a => a.filter(al => al.id !== id)), 8000);
    timers.current.push(t);
  }, []);

  const { status } = useWebSocket(handleWsEvent);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-phantom-bg flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-phantom-accent border-t-transparent rounded-full" role="status" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-phantom-bg">
      {/* Desktop sidebar */}
      <aside className="hidden lg:block fixed inset-y-0 left-0 z-20">
        <Sidebar wsStatus={status} />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-phantom-bg/70 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 shadow-xl">
            <Sidebar wsStatus={status} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:ml-64 flex flex-col min-h-screen">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-4 py-3 bg-phantom-surface/95 backdrop-blur border-b border-phantom-border">
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation menu"
            className="text-phantom-text text-xl leading-none px-2 py-1 rounded-lg hover:bg-phantom-card"
          >
            <span aria-hidden="true">☰</span>
          </button>
          <span className="text-sm tracking-widest text-phantom-text">PHANTOMSHIELD</span>
        </header>

        {/* Live alerts */}
        {alerts.length > 0 && (
          <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100%-2rem)] sm:w-full">
            {alerts.map(al => (
              <AlertBanner
                key={al.id}
                title={al.title}
                message={al.msg}
                variant={al.variant}
                onDismiss={() => setAlerts(a => a.filter(x => x.id !== al.id))}
              />
            ))}
          </div>
        )}

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-7xl w-full mx-auto animate-fade-in">
          {children}
        </main>
      </div>
    </div>
  );
}
