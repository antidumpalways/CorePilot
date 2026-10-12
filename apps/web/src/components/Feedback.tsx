import type { ReactNode } from "react";

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-hidden="true"
    />
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line bg-ink-900/40 px-6 py-10 text-center">
      <p className="text-sm font-medium text-paper">{title}</p>
      {message && <p className="max-w-md text-xs text-muted">{message}</p>}
      {action}
    </div>
  );
}
