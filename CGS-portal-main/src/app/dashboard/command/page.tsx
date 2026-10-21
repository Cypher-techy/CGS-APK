import Link from "next/link";
import { CountBarChart } from "@/components/CountBarChart";
import { Card, PageHeader, StatCard, StatGrid } from "@/components/ui";
import { requireActive } from "@/lib/auth";
import { PROJECT_STATUS } from "@/lib/constants";
import { formatNumber } from "@/lib/format";
import { countBy, sum } from "@/modules/dashboard/queries";
import { MAP_UNAVAILABLE, projectIds, projectInsights, recentActivity, workspaceMap } from "@/modules/geo/data";
import { Earth } from "@/modules/geo/Earth";

const head = { count: "exact", head: true } as const;

/** Admin Global Command Center: the whole CGS ecosystem on one Earth. Administrators only. */
export default async function CommandCenterPage() {
  const { supabase } = await requireActive(["super_admin"]);
  const [{ features: collection, available }, insights, activity, statuses, { data: rows }, organizations, verified, users, awaitingReview] = await Promise.all([
    workspaceMap(supabase),
    projectInsights(supabase),
    recentActivity(supabase),
    countBy(supabase, "projects", "status", Object.keys(PROJECT_STATUS)),
    supabase.from("projects").select("id, country, county, latitude, status").limit(5000),
    supabase.from("organizations").select("id", head),
    supabase.from("organizations").select("id", head).eq("is_verified", true),
    supabase.from("profiles").select("id", head).eq("status", "active"),
    supabase.from("monitoring_records").select("id", head).eq("review_status", "submitted"),
  ]);
  const projects = rows ?? [];
  const placed = new Set(projectIds(collection));
  const unplaced = projects.filter((p) => !placed.has(p.id)).length;
  const tally = (key: "country" | "county") => {
    const counts = new Map<string, number>();
    projects.forEach((p) => counts.set(p[key], (counts.get(p[key]) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ label, value }));
  };
  const observations = Object.values(insights).reduce((total, i) => total + Number(i.observations), 0);
  const mappedArea = collection.features.filter((f) => f.properties?.kind === "boundary").reduce((total, f) => total + Number(f.properties?.area_ha ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Global Command Center"
        description="Every registered project, site and field record on one Earth. Select a continent, country or county to see what is happening there."
        actions={
          <>
            <Link href="/dashboard/admin/approvals" className="btn btn-secondary">Approvals ({statuses.pending_approval})</Link>
            <Link href="/dashboard/admin/activity" className="btn btn-secondary">Audit log</Link>
          </>
        }
      />
      <div className="space-y-5">
        {!available && <p className="alert alert-warning" role="status">{MAP_UNAVAILABLE}</p>}
        <Earth features={collection} mode="admin" variant="embedded" signedIn ownProjectIds={[...placed]} insights={insights} activity={activity} basePath="/dashboard/command" height="min(78vh, 48rem)" />

        <StatGrid>
          <StatCard label="Registered projects" value={sum(statuses)} href="/dashboard/projects" hint={!available ? "Map unavailable" : unplaced > 0 ? `${unplaced} not yet placed on the map` : "All placed on the map"} />
          <StatCard label="Active projects" value={statuses.active} />
          <StatCard label="Pending approval" value={statuses.pending_approval} href="/dashboard/admin/approvals" />
          <StatCard label="Countries covered" value={new Set(projects.map((p) => p.country)).size} hint={`${new Set(projects.map((p) => `${p.country}/${p.county}`)).size} counties or regions`} />
          <StatCard label="Organizations" value={organizations.count ?? 0} href="/dashboard/organizations" hint={`${verified.count ?? 0} verified`} />
          <StatCard label="Active users" value={users.count ?? 0} href="/dashboard/admin/users" />
          <StatCard label="Field records" value={formatNumber(observations)} hint={`${awaitingReview.count ?? 0} awaiting review`} href="/dashboard/monitoring" />
          <StatCard label="Mapped area" value={`${formatNumber(mappedArea)} ha`} hint="Derived from boundary geometry" />
        </StatGrid>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Eight status labels need the full width to stay legible. */}
          <div className="lg:col-span-2">
            <Card title="Projects by status">
              <CountBarChart data={Object.keys(PROJECT_STATUS).map((key) => ({ label: PROJECT_STATUS[key].label, value: statuses[key] ?? 0 }))} unit="Projects" />
            </Card>
          </div>
          <Card title="Projects by country">
            {projects.length === 0 ? <p className="py-8 text-center text-sm text-muted-grey">No project data available.</p> : <CountBarChart data={tally("country")} unit="Projects" />}
          </Card>
          <Card title="Projects by county (top 10)">
            {projects.length === 0 ? <p className="py-8 text-center text-sm text-muted-grey">No project data available.</p> : <CountBarChart data={tally("county")} unit="Projects" />}
          </Card>
        </div>
        <p className="text-xs text-muted-grey">All figures are counted live from the database. Nothing on this page is sample data.</p>
      </div>
    </>
  );
}
