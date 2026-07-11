'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { useAuthStore } from '@/hooks/useAuthStore';
import { Badge, StatusDot } from '@/components/ui';

const NAV = [
  { href: '/dashboard',          label: 'Overview',    icon: '⬡' },
  { href: '/dashboard/activity', label: 'Activity Log', icon: '≡' },
  { href: '/dashboard/vault',    label: 'Intruder Vault', icon: '◎' },
  { href: '/dashboard/devices',  label: 'Devices',     icon: '📱' },
  { href: '/dashboard/settings', label: 'Settings',    icon: '⚙' },
];

export const Sidebar = ({ wsConnected }: { wsConnected: boolean }) => {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  const planBadge: Record<string, 'default' | 'plan-guard' | 'plan-elite'> = {
    free: 'default', guard: 'plan-guard', elite: 'plan-elite',
  };

  return (
    <aside className="fixed inset-y-0 left-0 w-64 bg-phantom-surface border-r border-phantom-border flex flex-col z-20">

      {/* Brand */}
      <div className="px-6 py-6 border-b border-phantom-border">
        <div className="flex items-center gap-3">
          {/* Shield icon */}
          <div className="w-9 h-9 rounded-xl bg-phantom-accent/10 border border-phantom-accent/20 flex items-center justify-center">
            <span className="text-phantom-accent text-lg">⬡</span>
          </div>
          <div>
            <p className="text-sm font-semibold tracking-widest text-phantom-text">PHANTOM</p>
            <p className="text-[10px] text-phantom-faint tracking-widest">SHIELD</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV.map(item => {
          const active = pathname === item.href ||
            (item.href !== '/dashboard' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all',
                active
                  ? 'bg-phantom-accent/10 text-phantom-accent border border-phantom-accent/20'
                  : 'text-phantom-muted hover:text-phantom-text hover:bg-phantom-card'
              )}
            >
              <span className="text-base w-5 text-center">{item.icon}</span>
              <span className="font-medium">{item.label}</span>
              {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-phantom-accent" />}
            </Link>
          );
        })}
      </nav>

      {/* WS status */}
      <div className="px-4 py-2 border-t border-phantom-border/50">
        <div className="flex items-center gap-2 text-xs text-phantom-faint">
          <StatusDot online={wsConnected} />
          <span>{wsConnected ? 'Live connection active' : 'Reconnecting...'}</span>
        </div>
      </div>

      {/* User */}
      <div className="px-4 py-4 border-t border-phantom-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-phantom-card border border-phantom-border flex items-center justify-center shrink-0">
            <span className="text-xs text-phantom-muted">
              {user?.email?.[0]?.toUpperCase() ?? '?'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-phantom-text truncate">{user?.email}</p>
            <Badge variant={planBadge[user?.plan ?? 'free'] ?? 'default'} className="mt-0.5">
              {user?.plan ?? 'free'}
            </Badge>
          </div>
          <button
            onClick={logout}
            className="text-phantom-faint hover:text-phantom-danger text-xs transition-colors"
            title="Logout"
          >
            ⏻
          </button>
        </div>
      </div>
    </aside>
  );
};
