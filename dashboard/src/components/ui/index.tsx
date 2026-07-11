'use client';
import React from 'react';
import { clsx } from 'clsx';

// ─── Card ─────────────────────────────────────────────────────────────────────

export const Card = ({
  children, className = '', hover = false, onClick,
}: {
  children: React.ReactNode; className?: string; hover?: boolean;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}) => (
  <div
    onClick={onClick}
    className={clsx(
      'bg-phantom-surface border border-phantom-border rounded-2xl p-5',
      hover && 'hover:border-phantom-accent/30 transition-colors cursor-pointer',
      className
    )}
  >
    {children}
  </div>
);

// ─── StatCard ─────────────────────────────────────────────────────────────────

export const StatCard = ({
  label, value, sub, icon, accent = false, danger = false, onClick,
}: {
  label: string; value: string | number; sub?: string;
  icon: string; accent?: boolean; danger?: boolean; onClick?: () => void;
}) => (
  <div
    onClick={onClick}
    className={clsx(
      'bg-phantom-surface border rounded-2xl p-5 flex flex-col gap-3',
      danger  ? 'border-phantom-danger/20 bg-red-950/10' :
      accent  ? 'border-phantom-accent/20' : 'border-phantom-border',
      onClick && 'cursor-pointer hover:border-phantom-accent/40 transition-colors'
    )}
  >
    <div className="flex items-center justify-between">
      <span className={clsx(
        'text-xs uppercase tracking-widest font-semibold',
        danger ? 'text-phantom-danger' : accent ? 'text-phantom-accent' : 'text-phantom-muted'
      )}>
        {label}
      </span>
      <span className="text-lg">{icon}</span>
    </div>
    <div className={clsx(
      'text-4xl font-light tracking-tight',
      danger ? 'text-phantom-danger' : accent ? 'text-phantom-accent' : 'text-phantom-text'
    )}>
      {value}
    </div>
    {sub && <p className="text-xs text-phantom-faint">{sub}</p>}
  </div>
);

// ─── Badge ────────────────────────────────────────────────────────────────────

type BadgeVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'plan-guard' | 'plan-elite';

const BADGE_STYLES: Record<BadgeVariant, string> = {
  default:     'bg-phantom-border/60 text-phantom-muted',
  accent:      'bg-phantom-accent/10 text-phantom-accent border border-phantom-accent/20',
  success:     'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  warning:     'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  danger:      'bg-red-500/10 text-phantom-danger border border-red-500/20',
  'plan-guard':'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  'plan-elite':'bg-purple-500/10 text-purple-400 border border-purple-500/20',
};

export const Badge = ({
  children, variant = 'default', className = '', title,
}: { children: React.ReactNode; variant?: BadgeVariant; className?: string; title?: string }) => (
  <span title={title} className={clsx(
    'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider',
    BADGE_STYLES[variant], className
  )}>
    {children}
  </span>
);

// ─── Button ───────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BTN_STYLES: Record<ButtonVariant, string> = {
  primary:   'bg-phantom-accent text-phantom-bg hover:bg-phantom-dim font-semibold',
  secondary: 'bg-phantom-card border border-phantom-border text-phantom-text hover:border-phantom-accent/40',
  ghost:     'text-phantom-muted hover:text-phantom-text',
  danger:    'bg-phantom-danger/10 border border-phantom-danger/30 text-phantom-danger hover:bg-phantom-danger/20',
};

export const Button = ({
  children, variant = 'secondary', className = '', loading = false, disabled = false, onClick, type = 'button',
}: {
  children: React.ReactNode; variant?: ButtonVariant; className?: string;
  loading?: boolean; disabled?: boolean; onClick?: () => void; type?: 'button' | 'submit';
}) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled || loading}
    className={clsx(
      'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm transition-all duration-150',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      BTN_STYLES[variant], className
    )}
  >
    {loading && (
      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
    )}
    {children}
  </button>
);

// ─── Alert Banner ─────────────────────────────────────────────────────────────

export const AlertBanner = ({
  title, message, variant = 'warning', onDismiss,
}: { title: string; message?: string; variant?: 'warning' | 'danger' | 'success' | 'info'; onDismiss?: () => void }) => {
  const styles = {
    warning: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
    danger:  'bg-red-500/10 border-phantom-danger/30 text-phantom-danger',
    success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    info:    'bg-phantom-accent/10 border-phantom-accent/30 text-phantom-accent',
  };
  const icons = { warning: '⚠', danger: '🚨', success: '✓', info: 'ℹ' };

  return (
    <div className={clsx('flex items-start gap-3 px-4 py-3 rounded-xl border text-sm', styles[variant])}>
      <span className="mt-0.5 shrink-0">{icons[variant]}</span>
      <div className="flex-1">
        <p className="font-semibold">{title}</p>
        {message && <p className="text-xs opacity-80 mt-0.5">{message}</p>}
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="opacity-60 hover:opacity-100 shrink-0">✕</button>
      )}
    </div>
  );
};

// ─── Section Header ───────────────────────────────────────────────────────────

export const SectionHeader = ({
  title, action, onAction,
}: { title: string; action?: string; onAction?: () => void }) => (
  <div className="flex items-center justify-between mb-4">
    <h2 className="text-xs uppercase tracking-widest text-phantom-faint font-semibold">{title}</h2>
    {action && (
      <button onClick={onAction} className="text-xs text-phantom-accent hover:underline">{action}</button>
    )}
  </div>
);

// ─── Online Indicator ─────────────────────────────────────────────────────────

export const StatusDot = ({ online }: { online: boolean }) => (
  <span className={clsx(
    'inline-block w-2 h-2 rounded-full',
    online ? 'bg-phantom-success status-pulse' : 'bg-phantom-faint'
  )} />
);

// ─── Empty State ──────────────────────────────────────────────────────────────

export const EmptyState = ({ icon, title, sub }: { icon: string; title: string; sub?: string }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
    <span className="text-5xl">{icon}</span>
    <p className="text-phantom-muted font-medium">{title}</p>
    {sub && <p className="text-phantom-faint text-sm max-w-xs">{sub}</p>}
  </div>
);

// ─── Spinner ──────────────────────────────────────────────────────────────────

export const Spinner = ({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) => {
  const sz = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-10 h-10' }[size];
  return (
    <svg className={clsx('animate-spin text-phantom-accent', sz)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
};
