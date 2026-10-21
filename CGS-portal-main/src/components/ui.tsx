import Link from "next/link";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/constants";

const TONES: Record<Tone, string> = {
  neutral: "border-subtle-border bg-white/10 text-charcoal",
  info: "border-sky-400/30 bg-sky-400/10 text-sky-200",
  success: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  warning: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  danger: "border-red-400/30 bg-red-400/10 text-red-300",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

/** Badge for a status value looked up in one of the maps in lib/constants. */
export function StatusBadge({ map, value }: { map: Record<string, { label: string; tone: Tone }>; value: string }) {
  const entry = map[value];
  return <Badge tone={entry?.tone}>{entry?.label ?? value}</Badge>;
}

export interface Crumb {
  label: string;
  href?: string;
}

export function PageHeader({
  title,
  description,
  crumbs,
  actions,
}: {
  title: string;
  description?: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 text-xs text-muted-grey">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href="/dashboard" className="hover:text-primary-green">
                Dashboard
              </Link>
            </li>
            {crumbs.map((crumb) => (
              <li key={crumb.label} className="flex items-center gap-1">
                <span aria-hidden="true">/</span>
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-primary-green">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-charcoal">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold text-heading">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-muted-grey">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Card({ title, actions, children, pad = true }: { title?: string; actions?: ReactNode; children: ReactNode; pad?: boolean }) {
  return (
    <section className="card">
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-subtle-border px-4 py-3 sm:px-5">
          <h2 className="section-title">{title}</h2>
          {actions}
        </div>
      )}
      <div className={pad ? "card-pad" : ""}>{children}</div>
    </section>
  );
}

export function StatCard({ label, value, hint, href }: { label: string; value: ReactNode; hint?: string; href?: string }) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-grey">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold tabular-nums text-heading">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-grey">{hint}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="card card-pad block hover:border-sage">
      {body}
    </Link>
  ) : (
    <div className="card card-pad">{body}</div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium text-charcoal">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted-grey">{children}</div>}
    </div>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded bg-subtle-border" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-primary-green" style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-grey">{value}%</span>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint block">{hint}</span>}
    </label>
  );
}

/** Label / value pairs for detail views. */
export function DetailList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-grey">{label}</dt>
          <dd className="mt-0.5 text-sm text-charcoal">{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Marks functionality that is planned but not part of this release. */
export function UnderDevelopment({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="alert alert-info">
      <p className="font-medium">{title} — under development</p>
      <p className="mt-1 text-muted-grey">{children}</p>
    </div>
  );
}
