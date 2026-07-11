'use client';
import { useEffect, useState, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { api, Device } from '@/lib/api';
import { Card, Button, Badge, SectionHeader, EmptyState, Spinner, AlertBanner, StatusDot } from '@/components/ui';

export default function DevicesPage() {
  const [devices, setDevices]   = useState<Device[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [acting, setActing]     = useState<string | null>(null);
  const [toast, setToast]       = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(() => {
    setLoading(true);
    api.devices.list()
      .then(r => setDevices(r.devices))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const doAction = async (deviceId: string, action: () => Promise<unknown>, label: string) => {
    setActing(deviceId + label);
    try {
      await action();
      showToast(`${label} sent successfully.`);
      load();
    } catch (e: any) {
      showToast(`Failed: ${e.message}`);
    } finally {
      setActing(null);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div className="space-y-8 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-light text-phantom-text tracking-tight">Devices</h1>
          <p className="text-phantom-muted text-sm mt-1">{devices.length} registered device(s)</p>
        </div>
        <Button variant="secondary" onClick={load}>↻ Refresh</Button>
      </div>

      {toast && (
        <AlertBanner title={toast} variant="info" onDismiss={() => setToast(null)} />
      )}
      {error && <AlertBanner title="Error" message={error} variant="danger" />}

      {devices.length === 0 ? (
        <EmptyState icon="📱" title="No devices registered" sub="Download PhantomShield on your phone to register a device." />
      ) : (
        <div className="grid gap-4">
          {devices.map(device => (
            <Card key={device.deviceId} className="animate-fade-in">
              <div className="flex flex-col sm:flex-row sm:items-start gap-4">

                {/* Device info */}
                <div className="flex items-start gap-4 flex-1 min-w-0">
                  <div className="w-12 h-12 rounded-2xl bg-phantom-card border border-phantom-border flex items-center justify-center shrink-0 text-2xl">
                    {device.platform === 'ios' ? '🍎' : '🤖'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-2 mb-1">
                      <p className="text-phantom-text font-medium truncate">{device.model}</p>
                      <StatusDot online={device.isOnline} />
                      <span className="text-xs text-phantom-faint">{device.isOnline ? 'Online' : 'Offline'}</span>
                      {device.isLocked && <Badge variant="danger">Locked</Badge>}
                      {!device.trackingEnabled && <Badge variant="warning">Tracking Off</Badge>}
                    </div>
                    <p className="text-xs text-phantom-muted">
                      {device.platform.toUpperCase()} {device.osVersion} · App v{device.appVersion}
                    </p>
                    <p className="text-xs text-phantom-faint mt-0.5">
                      Last seen {formatDistanceToNow(new Date(device.lastSeenAt), { addSuffix: true })}
                    </p>
                    <p className="text-xs text-phantom-faint font-mono mt-0.5 truncate">{device.deviceId}</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 shrink-0">
                  {device.isLocked ? (
                    <Button
                      variant="secondary"
                      loading={acting === device.deviceId + 'unlock'}
                      onClick={() => doAction(device.deviceId, () => api.devices.unlock(device.deviceId), 'Unlock')}
                    >
                      🔓 Unlock
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      loading={acting === device.deviceId + 'lock'}
                      onClick={() => doAction(device.deviceId, () => api.devices.lock(device.deviceId), 'Lock')}
                    >
                      🔒 Lock App
                    </Button>
                  )}

                  <Button
                    variant="secondary"
                    loading={acting === device.deviceId + 'alert'}
                    onClick={() => doAction(device.deviceId, () => api.devices.alert(device.deviceId), 'Alert')}
                  >
                    🔔 Alert
                  </Button>

                  <Button
                    variant="danger"
                    loading={acting === device.deviceId + 'wipe'}
                    onClick={() => {
                      if (confirm('Wipe all activity logs for this device? This cannot be undone.')) {
                        doAction(device.deviceId, () => api.devices.wipeLogs(device.deviceId), 'wipe');
                      }
                    }}
                  >
                    🗑 Wipe Logs
                  </Button>

                  <Button
                    variant="ghost"
                    loading={acting === device.deviceId + 'remove'}
                    onClick={() => {
                      if (confirm(`Remove device "${device.model}"? It will be logged out immediately.`)) {
                        doAction(device.deviceId, () => api.devices.remove(device.deviceId), 'remove');
                      }
                    }}
                  >
                    ✕ Remove
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Info card */}
      <Card className="border-phantom-accent/10 bg-phantom-accent/5">
        <p className="text-xs text-phantom-muted leading-relaxed">
          <span className="text-phantom-accent font-semibold">Remote commands</span> are queued and delivered the next time the device connects.
          Lock commands are also stored in the app on-device.
          Wipe Logs permanently deletes server-side activity history for that device and queues a local wipe on next sync.
        </p>
      </Card>
    </div>
  );
}
