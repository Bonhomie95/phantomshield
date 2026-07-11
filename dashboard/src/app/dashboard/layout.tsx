'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { AlertBanner } from '@/components/ui';
import { useAuthStore } from '@/hooks/useAuthStore';
import { useWebSocket, WSEvent } from '@/hooks/useWebSocket';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, loadUser } = useAuthStore();
  const router = useRouter();
  const [alerts, setAlerts] = useState<Array<{ id: number; title: string; msg: string; variant: 'danger' | 'warning' | 'info' }>>([]);

  useEffect(() => { loadUser(); }, []);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/auth/login');
  }, [isLoading, isAuthenticated, router]);

  const handleWsEvent = useCallback((event: WSEvent) => {
    const id = Date.now();
    if (event.type === 'intruder_alert') {
      setAlerts(a => [...a, { id, title: '🚨 Intruder Alert', msg: `Wrong PIN on ${(event.payload as any).pinLayer}`, variant: 'danger' }]);
    }
    if (event.type === 'anomaly_alert') {
      setAlerts(a => [...a, { id, title: '⚠ Anomaly Detected', msg: `${(event.payload as any).count} anomalous event(s)`, variant: 'warning' }]);
    }
    // Auto-dismiss after 8s
    setTimeout(() => setAlerts(a => a.filter(al => al.id !== id)), 8000);
  }, []);

  const { isConnected } = useWebSocket(handleWsEvent);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-phantom-bg flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-phantom-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-phantom-bg flex">
      <Sidebar wsConnected={isConnected} />

      <main className="flex-1 ml-64 flex flex-col min-h-screen">
        {/* Live alerts */}
        {alerts.length > 0 && (
          <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
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

        <div className="flex-1 px-8 py-8 max-w-7xl w-full mx-auto animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}
