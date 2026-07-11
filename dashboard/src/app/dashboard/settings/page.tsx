'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/hooks/useAuthStore';
import { Card, Button, Badge, SectionHeader, Spinner, AlertBanner } from '@/components/ui';

const PLAN_STYLE: Record<string, 'default' | 'plan-guard' | 'plan-elite'> = {
  free: 'default', guard: 'plan-guard', elite: 'plan-elite',
};

export default function SettingsPage() {
  const { user, logout } = useAuthStore();
  const [toast, setToast] = useState<{ msg: string; variant: 'info' | 'danger' | 'success' } | null>(null);

  const showToast = (msg: string, variant: 'info' | 'danger' | 'success' = 'success') => {
    setToast({ msg, variant });
    setTimeout(() => setToast(null), 4000);
  };

  const handleDeleteAccount = async () => {
    if (!confirm('This will permanently delete your account and ALL data (activity logs, intruder photos, device records). This cannot be undone. Continue?')) return;
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
          <Row label="Email"   value={user.email} />
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
            Permanently delete your account and all associated data including activity logs, intruder photos, and device records.
          </p>
          <Button variant="danger" onClick={handleDeleteAccount}>Delete My Account</Button>
        </div>
      </Card>
    </div>
  );
}

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex justify-between items-center py-2 border-b border-phantom-border/50 last:border-0">
    <span className="text-phantom-faint">{label}</span>
    <span className="text-phantom-text">{value}</span>
  </div>
);
