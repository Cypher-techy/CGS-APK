import Link from "next/link";
import { MONITORING_LIST_COLUMNS, MonitoringTable, PROJECT_LIST_COLUMNS, ProjectTable } from "@/components/lists";
import { Card, EmptyState, PageHeader, StatCard, StatGrid, StatusBadge } from "@/components/ui";
import { DEVELOPMENT_STAGES, INTEREST_KINDS, INTEREST_STATUS, OBSERVATION_TYPES, SCHEDULE_FREQUENCIES } from "@/lib/constants";
import { formatDate, formatDateTime, formatNumber, isOverdue } from "@/lib/format";
import type { Supabase } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { WorkspaceEarth } from "@/modules/geo/WorkspaceEarth";

 
type Row = Record<string, any>;
const head = { count: "exact", head: true } as const;

export async function GisDashboard({ supabase }: { supabase: Supabase }) {
  const [{ data: projects }, { data: boundaries }, { count: observations }, { count: datasets }] = await Promise.all([
    supabase.from("projects").select(PROJECT_LIST_COLUMNS + ", area_ha, latitude").order("name"),
    supabase.from("project_boundaries").select("project_id, area_ha, updated_at"),
    supabase.from("monitoring_records").select("id", head).not("latitude", "is", null),
    supabase.from("documents").select("id", head).eq("category", "map_dataset"),
  ]);
  const all = (projects ?? []) as Row[];
  const mapped = new Set((boundaries ?? []).map((b) => b.project_id));
  const unmapped = all.filter((p) => !mapped.has(p.id));
  const area = (boundaries ?? []).reduce((total, b) => total + Number(b.area_ha), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="GIS analyst dashboard"
        description="Spatial data of the projects you are assigned to."
        actions={<Link href="/dashboard/gis" className="btn btn-primary">Open Earth & GIS</Link>}
      />
      <WorkspaceEarth supabase={supabase} />
      <StatGrid>
        <StatCard label="Assigned projects" value={all.length} href="/dashboard/projects" />
        <StatCard label="Boundaries mapped" value={mapped.size} href="/dashboard/gis" />
        <StatCard label="Awaiting a boundary" value={unmapped.length} />
        <StatCard label="Total mapped area" value={`${formatNumber(area, 2)} ha`} hint="From boundary geometry" />
        <StatCard label="Without declared coordinates" value={all.filter((p) => p.latitude === null).length} />
        <StatCard label="Georeferenced observations" value={observations ?? 0} />
        <StatCard label="Spatial datasets on file" value={datasets ?? 0} href="/dashboard/documents" hint="Documents in the Map / GIS category" />
      </StatGrid>
      <Card title="Projects without a mapped boundary" pad={false}>
        {unmapped.length === 0 ? (
          <EmptyState title={all.length === 0 ? "You are not assigned to any project yet." : "Every assigned project has a boundary."}>
            {all.length === 0 && "A project manager adds GIS analysts to a project from its Team tab."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-subtle-border">
            {unmapped.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm sm:px-5">
                <span>
                  {p.name} <span className="text-xs text-muted-grey">· {p.code} · {p.county}</span>
                </span>
                <Link href={`/dashboard/projects/${p.id}?tab=map`} className="btn btn-secondary btn-sm">Map boundary</Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Assigned projects" pad={false}>
        <ProjectTable projects={all} empty="No assigned projects." />
      </Card>
    </div>
  );
}

export async function MrvDashboard({ supabase }: { supabase: Supabase }) {
  const count = (status?: string) => {
    const query = supabase.from("monitoring_records").select("id", head);
    return status ? query.eq("review_status", status) : query;
  };
  const [projects, total, approved, awaiting, noGps, estimated, estimates, { data: schedules }, { data: recent }, { data: listings }] = await Promise.all([
    supabase.from("projects").select("id", head),
    count(),
    count("approved"),
    count("submitted"),
    supabase.from("monitoring_records").select("id", head).is("latitude", null),
    supabase.from("monitoring_records").select("id", head).eq("value_basis", "estimated"),
    supabase.from("carbon_estimates").select("id", head),
    supabase.from("monitoring_schedules").select("id, observation_type, frequency, next_due, project_id, project:projects(name)").order("next_due").limit(6),
    supabase.from("monitoring_records").select(MONITORING_LIST_COLUMNS).order("created_at", { ascending: false }).limit(6),
    supabase.from("marketplace_listings").select("project_id, development_stage, standard, project:projects(name)").limit(20),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="MRV specialist dashboard"
        description="Monitoring, reporting and verification records of your assigned projects. Portal review is internal and is not independent verification."
        actions={<Link href="/dashboard/mrv" className="btn btn-primary">MRV records</Link>}
      />
      <WorkspaceEarth supabase={supabase} />
      <StatGrid>
        <StatCard label="Assigned projects" value={projects.count ?? 0} href="/dashboard/projects" />
        <StatCard label="Field observations" value={total.count ?? 0} href="/dashboard/monitoring" />
        <StatCard label="Reviewed and approved" value={approved.count ?? 0} />
        <StatCard label="Awaiting review" value={awaiting.count ?? 0} href="/dashboard/monitoring?status=submitted" />
        <StatCard label="Without GPS coordinates" value={noGps.count ?? 0} hint="Data quality check" />
        <StatCard label="Based on estimates" value={estimated.count ?? 0} hint="Not measured in the field" />
        <StatCard label="Carbon estimation records" value={estimates.count ?? 0} href="/dashboard/mrv" />
        <StatCard label="Scheduled monitoring" value={(schedules ?? []).length} hint="Next entries shown below" />
      </StatGrid>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Monitoring schedule" pad={false}>
          {(schedules ?? []).length === 0 ? (
            <EmptyState title="No monitoring has been scheduled." />
          ) : (
            <ul className="divide-y divide-subtle-border">
              {((schedules ?? []) as Row[]).map((s) => (
                <li key={s.id} className="flex flex-wrap justify-between gap-2 px-4 py-2.5 text-sm sm:px-5">
                  <Link href={`/dashboard/projects/${s.project_id}?tab=mrv`} className="link">
                    {OBSERVATION_TYPES[s.observation_type]?.label} · {s.project?.name}
                  </Link>
                  <span className={isOverdue(s.next_due, false) ? "font-medium text-red-300" : "text-muted-grey"}>
                    {SCHEDULE_FREQUENCIES[s.frequency]} · {formatDate(s.next_due)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Validation and verification status" pad={false}>
          {(listings ?? []).length === 0 ? (
            <EmptyState title="None of your projects has a marketplace listing with a development stage." />
          ) : (
            <ul className="divide-y divide-subtle-border">
              {((listings ?? []) as Row[]).map((l) => (
                <li key={l.project_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm sm:px-5">
                  <Link href={`/dashboard/projects/${l.project_id}?tab=marketplace`} className="link">{l.project?.name}</Link>
                  <span className="flex items-center gap-2">
                    {l.standard && <span className="text-xs text-muted-grey">{l.standard}</span>}
                    <StatusBadge map={DEVELOPMENT_STAGES} value={l.development_stage} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Latest field observations" pad={false}>
        <MonitoringTable records={recent ?? []} empty="No field observations have been recorded for your projects." />
      </Card>
    </div>
  );
}

export async function InvestorDashboard({ supabase, profile }: { supabase: Supabase; profile: Profile }) {
  const [{ data: listings }, { data: saved }, { data: interests }] = await Promise.all([
    supabase.rpc("marketplace_browse"),
    supabase.from("marketplace_saved").select("project_id"),
    supabase.from("marketplace_interests").select("id, kind, status, created_at, updated_at, project_id").eq("investor_id", profile.id).order("updated_at", { ascending: false }),
  ]);
  const all = (listings ?? []) as Row[];
  const names = new Map(all.map((l) => [l.project_id, l.name]));
  const mine = interests ?? [];
  const inStatus = (...statuses: string[]) => mine.filter((i) => statuses.includes(i.status)).length;
  const latest = [...all].sort((a, b) => String(b.published_at).localeCompare(String(a.published_at))).slice(0, 5);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Investor and project developer dashboard"
        description="Discover listed environmental projects and follow your partnership enquiries. No carbon credits are traded and no payments are processed in the portal."
        actions={<Link href="/dashboard/marketplace" className="btn btn-primary">Browse marketplace</Link>}
      />
      <StatGrid>
        <StatCard label="Listed projects" value={all.length} href="/dashboard/marketplace" />
        <StatCard label="Saved projects" value={(saved ?? []).length} href="/dashboard/marketplace?saved=1" />
        <StatCard label="Enquiries sent" value={mine.length} href="/dashboard/marketplace/enquiries" />
        <StatCard label="Submitted / under review" value={inStatus("submitted", "under_review")} />
        <StatCard label="In due diligence" value={inStatus("due_diligence")} />
        <StatCard label="In negotiation" value={inStatus("negotiation")} />
        <StatCard label="Agreements reached" value={inStatus("agreement")} />
        <StatCard label="Declined / withdrawn" value={inStatus("declined", "withdrawn")} />
      </StatGrid>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Recently listed projects" pad={false}>
          {latest.length === 0 ? (
            <EmptyState title="No projects are listed yet." />
          ) : (
            <ul className="divide-y divide-subtle-border">
              {latest.map((l) => (
                <li key={l.project_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm sm:px-5">
                  <span>
                    <Link href={`/dashboard/marketplace/${l.project_id}`} className="link">{l.name}</Link>
                    <span className="text-xs text-muted-grey"> · {l.category} · {l.county}</span>
                  </span>
                  <StatusBadge map={DEVELOPMENT_STAGES} value={l.development_stage} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="My enquiries" pad={false} actions={<Link href="/dashboard/marketplace/enquiries" className="link text-xs">View all</Link>}>
          {mine.length === 0 ? (
            <EmptyState title="You have not sent an enquiry yet." />
          ) : (
            <ul className="divide-y divide-subtle-border">
              {mine.slice(0, 5).map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm sm:px-5">
                  <span>
                    {names.get(i.project_id) ?? "Listing no longer published"}
                    <span className="block text-xs text-muted-grey">{INTEREST_KINDS[i.kind]} · updated {formatDateTime(i.updated_at)}</span>
                  </span>
                  <StatusBadge map={INTEREST_STATUS} value={i.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

export async function CommunityDashboard({ supabase, profile }: { supabase: Supabase; profile: Profile }) {
  const now = new Date().toISOString();
  const [{ data: projects }, { data: announcements }, { data: meetings }, { data: grievances }, { data: monitoring }] = await Promise.all([
    supabase.from("projects").select(PROJECT_LIST_COLUMNS).order("name"),
    supabase.from("project_announcements").select("id, title, created_at, project_id, project:projects(name)").order("created_at", { ascending: false }).limit(5),
    supabase.from("project_meetings").select("id, title, scheduled_at, location, project_id, project:projects(name)").gte("scheduled_at", now).order("scheduled_at").limit(5),
    supabase.from("grievances").select("id, status").eq("submitted_by", profile.id),
    supabase.from("monitoring_records").select(MONITORING_LIST_COLUMNS).order("observation_date", { ascending: false }).limit(5),
  ]);
  const mine = grievances ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Community dashboard"
        description="Projects your community takes part in, their announcements, meetings and reviewed progress updates."
        actions={<Link href="/dashboard/community" className="btn btn-primary">Send feedback</Link>}
      />
      <StatGrid>
        <StatCard label="Participating projects" value={(projects ?? []).length} href="/dashboard/projects" />
        <StatCard label="Upcoming meetings" value={(meetings ?? []).length} href="/dashboard/community" />
        <StatCard label="My feedback and grievances" value={mine.length} href="/dashboard/community" />
        <StatCard label="Awaiting a response" value={mine.filter((g) => g.status === "open" || g.status === "in_review").length} />
      </StatGrid>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Latest announcements" pad={false} actions={<Link href="/dashboard/community" className="link text-xs">View all</Link>}>
          {(announcements ?? []).length === 0 ? (
            <EmptyState title="No announcements yet." />
          ) : (
            <ul className="divide-y divide-subtle-border">
              {((announcements ?? []) as Row[]).map((a) => (
                <li key={a.id} className="px-4 py-2.5 text-sm sm:px-5">
                  <Link href={`/dashboard/projects/${a.project_id}?tab=community`} className="link">{a.title}</Link>
                  <span className="block text-xs text-muted-grey">{a.project?.name} · {formatDateTime(a.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Upcoming meetings" pad={false}>
          {(meetings ?? []).length === 0 ? (
            <EmptyState title="No meetings are scheduled." />
          ) : (
            <ul className="divide-y divide-subtle-border">
              {((meetings ?? []) as Row[]).map((m) => (
                <li key={m.id} className="px-4 py-2.5 text-sm sm:px-5">
                  <span className="font-medium">{m.title}</span>
                  <span className="block text-xs text-muted-grey">
                    {m.project?.name} · {formatDateTime(m.scheduled_at)} (EAT){m.location ? ` · ${m.location}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Participating projects" pad={false}>
        <ProjectTable projects={projects ?? []} empty="You have not been added to a project yet. A project manager adds community members to a project." />
      </Card>
      <Card title="Reviewed progress updates" pad={false}>
        <MonitoringTable records={monitoring ?? []} empty="No reviewed monitoring reports are available yet." />
      </Card>
    </div>
  );
}
