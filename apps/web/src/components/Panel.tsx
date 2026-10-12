import type { ReactNode } from "react";

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
  bodyClassName = "p-4",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`cp-panel ${className}`}>
      {(title || subtitle || actions) && (
        <header className="cp-panel-header">
          <div className="min-w-0">
            {title && <h2 className="truncate text-sm font-semibold text-paper">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "up" | "down" | "warn";
}) {
  const toneClass =
    tone === "up"
      ? "text-long"
      : tone === "down"
        ? "text-short"
        : tone === "warn"
          ? "text-warn"
          : "text-paper";
  return (
    <div className="rounded-md border border-line bg-ink-900/60 px-3 py-3">
      <div className="cp-label">{label}</div>
      <div className={`cp-mono mt-1.5 text-lg font-semibold ${toneClass}`}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line-soft py-2.5 last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-right text-sm text-paper">{children}</span>
    </div>
  );
}
