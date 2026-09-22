'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Guardian } from '@phantomshield/shared';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/hooks/useAuthStore';
import { Card, Button, Badge, SectionHeader, Spinner, AlertBanner, INPUT_CLS } from '@/components/ui';

const PLAN_STYLE: Record<string, 'default' | 'plan-starter' | 'plan-pro'> = {
  free: 'default', starter: 'plan-starter', pro: 'plan-pro',
};

export default function SettingsPage() {
  const { user, logout } = useAuthStore();
  const [toast, setToast] = useState<{ msg: string; variant: 'info' | 'danger' | 'success' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Stable identity: the Guardians section loads in an effect that depends on it.
  const showToast = useCallback((msg: string, variant: 'info' | 'danger' | 'success' = 'success') => {
    setToast({ msg, variant });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const handleDeleteAccount = async () => {
    if (!confirm('This will permanently delete your account and ALL data (intruder photos, locations, guardians, device records). This cannot be undone.\n\nIf you have a subscription, cancel it in the App Store or Google Play — deleting your account does not stop billing.\n\nContinue?')) return;
    try {
      await api.dashboard.deleteAccount();
      await logout();
    } catch (e: any) {
      showToast(e.message, 'danger');
    }
  };

  if (!user) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div className="space-y-8 animate-slide-up max-w-2xl">
      <div>
        <h1 className="text-3xl font-light text-phantom-text tracking-tight">Settings</h1>
        <p className="text-phantom-muted text-sm mt-1">Manage your account and security.</p>
      </div>

      {toast && <AlertBanner title={toast.msg} variant={toast.variant} onDismiss={() => setToast(null)} />}

      {/* Account */}
      <Card>
        <SectionHeader title="Account" />
        <div className="space-y-3 text-sm">
          <Row label="Email"   value={user.email ?? 'Hidden by Apple'} />
          <Row label="Sign-in" value={<Badge variant="default">{user.provider === 'apple' ? 'Apple' : 'Google'}</Badge>} />
          <Row label="Plan"    value={<Badge variant={PLAN_STYLE[user.plan] ?? 'default'}>{user.plan}</Badge>} />
          <Row label="Member since" value={new Date(user.createdAt).toLocaleDateString()} />
        </div>
      </Card>

      {/* Security */}
      <Card>
        <SectionHeader title="Security" />
        <p className="text-sm text-phantom-muted">
          Your account is protected by your {user.provider === 'apple' ? 'Apple' : 'Google'} sign-in.
          Manage two-factor authentication and password from your{' '}
          {user.provider === 'apple' ? 'Apple ID' : 'Google account'} settings — PhantomShield never
          stores a password for you.
        </p>
      </Card>

      <Guardians showToast={showToast} />

      {/* Push notifications test */}
      <Card>
        <SectionHeader title="Notifications" />
        <div className="space-y-3">
          <p className="text-sm text-phantom-muted">Send a test push notification to all registered devices.</p>
          <Button variant="secondary" onClick={async () => {
            try { await api.push.test(); showToast('Test notification sent.', 'success'); }
            catch (e: any) { showToast(e.message, 'danger'); }
          }}>
            🔔 Send Test Notification
          </Button>
        </div>
      </Card>

      {/* Danger zone */}
      <Card className="border-phantom-danger/20">
        <SectionHeader title="Danger Zone" />
        <div className="space-y-3">
          <p className="text-sm text-phantom-muted">
            Permanently delete your account and all associated data including intruder photos, locations, guardians, and device records.
          </p>
          <Button variant="danger" onClick={handleDeleteAccount}>Delete My Account</Button>
        </div>
      </Card>
    </div>
  );
}

type Toast = (msg: string, variant?: 'info' | 'danger' | 'success') => void;

/** People emailed a private live-location link when the phone looks stolen. */
function Guardians({ showToast }: { showToast: Toast }) {
  const [guardians, setGuardians] = useState<Guardian[] | null>(null);
  const [limit, setLimit] = useState(0);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [alertOnGuard, setAlertOnGuard] = useState(true);
  const [adding, setAdding] = useState(false);
  const [upgrade, setUpgrade] = useState<string | null>(null);

  const load = useCallback(() => {
    api.guardians.list()
      .then(r => { setGuardians(r.guardians); setLimit(r.limit); })
      .catch(e => showToast(e.message, 'danger'));
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setUpgrade(null);
    try {
      await api.guardians.add(name.trim(), email.trim(), alertOnGuard);
      setName(''); setEmail(''); setAlertOnGuard(true);
      showToast('Guardian added. We emailed them to let them know.', 'success');
      load();
    } catch (err) {
      // 403 = plan limit reached; the backend explains the limit in `message`.
      if (err instanceof ApiError && err.status === 403) setUpgrade(`You've reached your plan's guardian limit (${limit}).`);
      else showToast(err instanceof Error ? err.message : 'Could not add guardian.', 'danger');
    } finally {
      setAdding(false);
    }
  };

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    try { await fn(); if (done) showToast(done, 'success'); load(); }
    catch (err) { showToast(err instanceof Error ? err.message : 'Request failed.', 'danger'); }
  };

  return (
    <Card>
      <SectionHeader title="Guardians" />
      <div className="space-y-4">
        <p className="text-sm text-phantom-muted">
          Guardians get an email with a private link showing where your phone is when it looks stolen (SIM swapped or
          removed, or Guard Mode tripped if you allow it). They don&apos;t need the app.
        </p>

        {guardians === null ? <Spinner size="sm" /> : (
          <>
            <p className="text-xs text-phantom-faint">{guardians.length} of {limit} guardian(s)</p>
            {guardians.map(g => (
              <div key={g.id} className="flex items-center gap-3 py-2 border-b border-phantom-border/50 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-phantom-text truncate">{g.name}</p>
                  <p className="text-xs text-phantom-faint truncate">{g.email}</p>
                  <label className="flex items-center gap-2 text-xs text-phantom-muted mt-1">
                    <input
                      type="checkbox"
                      checked={g.alertOnGuard}
                      onChange={e => run(() => api.guardians.update(g.id, e.target.checked))}
                    />
                    Also alert when Guard Mode is triggered
                  </label>
                </div>
                <Button variant="ghost" onClick={() => {
                  if (confirm(`Remove ${g.name} as a guardian?`)) run(() => api.guardians.remove(g.id), 'Guardian removed.');
                }}>
                  ✕ Remove
                </Button>
              </div>
            ))}
          </>
        )}

        {upgrade && <AlertBanner title={upgrade} message="Upgrade your plan in the app to add more guardians." variant="warning" onDismiss={() => setUpgrade(null)} />}

        <form onSubmit={add} className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input className={INPUT_CLS} placeholder="Name" aria-label="Guardian name" maxLength={60} required value={name} onChange={e => setName(e.target.value)} />
            <input className={INPUT_CLS} placeholder="Email" aria-label="Guardian email" type="email" maxLength={254} required value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-xs text-phantom-muted">
            <input type="checkbox" checked={alertOnGuard} onChange={e => setAlertOnGuard(e.target.checked)} />
            Also alert when Guard Mode is triggered
          </label>
          <Button type="submit" loading={adding}>+ Add guardian</Button>
        </form>

        <div className="pt-3 border-t border-phantom-border/50 space-y-2">
          <p className="text-xs text-phantom-faint">Links already sent expire after 24 hours. Found your phone? Turn them off now.</p>
          <Button variant="danger" onClick={() => {
            if (!confirm('Turn off every location link already sent to your guardians? They will no longer be able to see where your phone is.')) return;
            run(async () => {
              const r = await api.guardians.revokeLinks();
              showToast(r.revoked > 0 ? `Turned off ${r.revoked} link(s).` : 'There were no active links.', 'success');
            });
          }}>
            Turn off all shared location links
          </Button>
        </div>
      </div>
    </Card>
  );
}

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex justify-between items-center py-2 border-b border-phantom-border/50 last:border-0">
    <span className="text-phantom-faint">{label}</span>
    <span className="text-phantom-text">{value}</span>
  </div>
);
