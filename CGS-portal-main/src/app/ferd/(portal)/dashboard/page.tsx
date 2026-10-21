import Link from "next/link";
import { ArrowRight, Lock, Unlock } from "lucide-react";
import { Card, EmptyState } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/format";
import { CONTENT_TYPES, OPPORTUNITY_TYPES, typesIn } from "@/modules/ferd/constants";
import { entitledProducts, liveContent, TierBadge, type ContentRow } from "@/modules/ferd/content";
import { requireModule } from "@/modules/ferd/portal";

function Rows({ rows, entitled, staff, empty, date }: { rows: ContentRow[]; entitled: Set<string>; staff: boolean; empty: string; date?: (row: ContentRow) => string | null }) {
  if (rows.length === 0) return <EmptyState title={empty} />;
  return (
    <ul className="divide-y divide-subtle-border">
      {rows.map((row) => (
        <li key={row.id} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
          <span className="min-w-0">
            <Link href={`/ferd/content/${row.id}`} className="block truncate text-sm font-medium text-white hover:underline">{row.title}</Link>
            <span className="block truncate text-xs text-muted-grey">
              {CONTENT_TYPES[row.type]?.label}
              {date?.(row) ? ` · ${date(row)}` : ""}
            </span>
          </span>
          <TierBadge row={row} unlocked={row.tier !== "premium" || staff || entitled.has(row.product_id)} />
        </li>
      ))}
    </ul>
  );
}

/** Department dashboard. Its identity, focus areas and every list come from the department's own data. */
export default async function FerdDashboardPage() {
  const { supabase, user, student, role, department, profile } = await requireModule("dashboard");
  const [announcements, events, learning, opportunities, entitled, { data: products }, { count: courses }] = await Promise.all([
    liveContent(supabase, department.id, { types: ["announcement"], limit: 4 }),
    liveContent(supabase, department.id, { types: ["event"], limit: 4 }),
    liveContent(supabase, department.id, { types: typesIn("learning", "manual"), limit: 5 }),
    liveContent(supabase, department.id, { types: OPPORTUNITY_TYPES, limit: 5, order: "deadline" }),
    entitledProducts(supabase, user.id),
    supabase.from("ferd_products").select("id, slug, name, price_kes, is_active").eq("department_id", department.id).order("name"),
    supabase.from("ferd_courses").select("id", { count: "exact", head: true }).eq("department_id", department.id).eq("is_active", true),
  ]);
  const staff = !!role;
  const library = (products ?? []).filter((p) => p.is_active || entitled.has(p.id));

  return (
    <div className="space-y-6">
      <section className="card relative overflow-hidden p-6 sm:p-8" style={{ backgroundImage: `radial-gradient(ellipse 70% 90% at 100% 0%, ${department.accent}33, transparent 70%)` }}>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ferd-accent)]">Department of {department.name}</p>
        <h1 className="mt-2 text-3xl font-bold leading-tight text-white sm:text-4xl">Welcome, {(student?.full_name ?? profile.full_name).split(" ")[0]}</h1>
        {department.tagline && <p className="mt-2 max-w-2xl text-base text-charcoal">{department.tagline}</p>}
        {department.description && <p className="mt-1 max-w-2xl text-sm text-muted-grey">{department.description}</p>}
        <form action="/ferd/search" method="get" role="search" className="mt-5 flex max-w-xl gap-2">
          <label className="sr-only" htmlFor="ferd-search">Search notes, manuals and files</label>
          <input id="ferd-search" name="q" type="search" required minLength={2} maxLength={80} className="input" placeholder="Search notes, manuals, files and opportunities" />
          <button type="submit" className="btn btn-primary shrink-0">Search</button>
        </form>
        {department.focus_areas.length > 0 && (
          <div className="mt-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-grey">Browse by focus area</p>
            <p className="mt-2 flex flex-wrap gap-2">
              {department.focus_areas.map((area) => (
                <Link key={area} href={`/ferd/resources?tag=${encodeURIComponent(area)}`} className="rounded-full border border-subtle-border bg-white/5 px-3 py-1 text-xs text-charcoal hover:border-[var(--ferd-accent)]">
                  {area}
                </Link>
              ))}
            </p>
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Units", courses ?? 0, "/ferd/courses"],
          ["Latest resources", learning.length, "/ferd/resources"],
          ["Open opportunities", opportunities.length, "/ferd/opportunities"],
          ["Upcoming events", events.length, "/ferd/events"],
        ].map(([label, value, href]) => (
          <Link key={String(label)} href={String(href)} className="card card-pad block hover:border-[var(--ferd-accent)]">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-grey">{label}</p>
            <p className="mt-1 font-display text-3xl font-bold tabular-nums text-white">{value}</p>
          </Link>
        ))}
      </div>

      {library.length > 0 && (
        <Card title="Premium libraries">
          <ul className="space-y-3">
            {library.map((product) => {
              const owned = entitled.has(product.id) || staff;
              return (
                <li key={product.id} className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm text-white">
                    {owned ? <Unlock className="h-4 w-4 text-[var(--ferd-accent)]" aria-hidden="true" /> : <Lock className="h-4 w-4 text-amber-200" aria-hidden="true" />}
                    {product.name}
                  </span>
                  {owned ? (
                    <Link href="/ferd/manuals" className="btn btn-secondary btn-sm">Open library</Link>
                  ) : (
                    <Link href={`/ferd/checkout/${product.slug}`} className="btn btn-accent btn-sm">Unlock for KSh {formatNumber(product.price_kes)}</Link>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Announcements" pad={false} actions={<Link href="/ferd/community" className="link text-xs">All <ArrowRight className="inline h-3 w-3" /></Link>}>
          <Rows rows={announcements} entitled={entitled} staff={staff} empty="No announcements" date={(row) => formatDate(row.publish_at ?? row.created_at)} />
        </Card>
        <Card title="Events and fieldwork" pad={false} actions={<Link href="/ferd/events" className="link text-xs">All <ArrowRight className="inline h-3 w-3" /></Link>}>
          <Rows rows={events} entitled={entitled} staff={staff} empty="No events announced" date={(row) => (row.meta?.starts_at ? formatDate(row.meta.starts_at) : null)} />
        </Card>
        <Card title="Latest learning resources" pad={false} actions={<Link href="/ferd/resources" className="link text-xs">All <ArrowRight className="inline h-3 w-3" /></Link>}>
          <Rows rows={learning} entitled={entitled} staff={staff} empty="No resources available" date={(row) => formatDate(row.publish_at ?? row.created_at)} />
        </Card>
        <Card title="Opportunities closing soonest" pad={false} actions={<Link href="/ferd/opportunities" className="link text-xs">All <ArrowRight className="inline h-3 w-3" /></Link>}>
          <Rows rows={opportunities} entitled={entitled} staff={staff} empty="No open opportunities" date={(row) => (row.expires_at ? `Deadline ${formatDate(row.expires_at)}` : null)} />
        </Card>
      </div>
    </div>
  );
}
