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
    <div className="relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-[18px] border border-line/60 bg-ink-800 px-6 py-12 text-center shadow-panel before:pointer-events-none before:absolute before:-top-24 before:h-44 before:w-72 before:rounded-full before:bg-accent/10 before:blur-3xl">
      <span className="relative mb-1 grid h-10 w-10 place-items-center rounded-[12px] border border-accent/30 bg-accent/10 text-lg text-accent" aria-hidden>◇</span>
      <p className="relative text-[16px] font-bold tracking-[-.025em] text-paper">{title}</p>
      {message && <p className="relative max-w-md text-[13px] leading-5 text-muted">{message}</p>}
      {action}
    </div>
  );
}
