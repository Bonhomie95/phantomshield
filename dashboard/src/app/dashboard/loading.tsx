export default function DashboardLoading() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-phantom-border border-t-phantom-accent"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}
