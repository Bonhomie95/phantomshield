'use client';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="text-5xl">🛡️</span>
      <h2 className="text-xl font-light text-phantom-text">Something went wrong</h2>
      <p className="text-sm text-phantom-muted max-w-sm">
        {error.message || 'The dashboard failed to load. Please try again.'}
      </p>
      <button
        onClick={reset}
        className="mt-2 rounded-full bg-phantom-accent/10 border border-phantom-accent/30 px-6 py-2 text-sm text-phantom-accent hover:bg-phantom-accent/20 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
